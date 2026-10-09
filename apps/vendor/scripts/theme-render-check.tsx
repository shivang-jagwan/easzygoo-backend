/**
 * Renders every Vendor screen through react-test-renderer, in both palettes.
 *
 *   pnpm theme-render-check
 *
 * The REAL ThemeProvider runs — including its AsyncStorage restore — so the
 * assertions are against tokens the app actually resolved, not a frozen copy of
 * them. Only the native edges are faked: react-native itself, AsyncStorage, the
 * logo JPEG (Node cannot require an image), and AuthContext.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

// ---------- fakes ----------

const host = (name: string) => {
  const C = ({ children }: any) => React.createElement(name, null, children);
  Object.defineProperty(C, 'name', { value: name });
  return C;
};

/** Drives ThemeProvider's `system` mode. */
let systemScheme: 'light' | 'dark' = 'light';

const rnStub: any = new Proxy(
  {
    StyleSheet: { create: (o: any) => o, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'android', select: (o: any) => o.android },
    useColorScheme: () => systemScheme,
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

const storage: Record<string, string> = {};
const asyncStorageStub = {
  __esModule: true,
  default: {
    getItem: async (k: string) => storage[k] ?? null,
    setItem: async (k: string, v: string) => {
      storage[k] = v;
    },
  },
};

const authControl: { vendorStatus: string | null; storeName: string | null } = {
  vendorStatus: 'PENDING',
  storeName: 'Green Basket',
};

const authStub = {
  useAuth: () => ({
    user: { id: 'u1', role: 'VENDOR', name: null },
    phoneNumber: '+919876543210',
    isLoading: false,
    pendingConfirmation: { confirm: async () => ({}) },
    setPendingConfirmation: () => {},
    vendorProfile: authControl.storeName
      ? { onboarded: true, vendor: { storeName: authControl.storeName, status: authControl.vendorStatus } }
      : { onboarded: false },
    vendorStatus: authControl.vendorStatus,
    vendorError: null,
    refreshVendor: async () => {},
    sendOtp: async () => ({}),
    confirmOtp: async () => {},
    signOut: async () => {},
  }),
};

const stubs: Record<string, any> = {
  'react-native': rnStub,
  '@react-native-async-storage/async-storage': asyncStorageStub,
  '../../assets/easzygoo.jpeg': { __esModule: true, default: 1 },
  '../context/AuthContext': authStub,
  '@react-navigation/native-stack': { createNativeStackNavigator: () => ({}) },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const { ThemeProvider } = require('../src/theme/ThemeContext');
const { light, dark } = require('../src/theme/colors');

const SCREENS: Array<{ name: string; module: string; props: any }> = [
  {
    name: 'PhoneEntry',
    module: '../src/screens/PhoneEntryScreen',
    props: { navigation: { navigate: () => {} }, route: { params: undefined } },
  },
  {
    name: 'OtpVerify',
    module: '../src/screens/OtpVerifyScreen',
    props: {
      navigation: { navigate: () => {}, goBack: () => {} },
      route: { params: { phoneNumber: '+919876543210' } },
    },
  },
  {
    name: 'StoreDetails',
    module: '../src/screens/StoreDetailsScreen',
    props: { navigation: { navigate: () => {} }, route: { params: undefined } },
  },
  {
    name: 'BankDetails',
    module: '../src/screens/BankDetailsScreen',
    props: { navigation: { navigate: () => {} }, route: { params: undefined } },
  },
  { name: 'PendingApproval', module: '../src/screens/PendingApprovalScreen', props: {} },
  { name: 'Orders', module: '../src/screens/OrdersScreen', props: {} },
  { name: 'Catalog', module: '../src/screens/CatalogScreen', props: {} },
  { name: 'Earnings', module: '../src/screens/EarningsScreen', props: {} },
  { name: 'StoreSettings', module: '../src/screens/StoreSettingsScreen', props: {} },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: boolean[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail !== undefined) {
    console.log(`        got: ${String(JSON.stringify(detail)).slice(0, 300)}`);
  }
  results.push(ok);
}

function flatten(raw: any): any {
  const style = typeof raw === 'function' ? raw({ pressed: false }) : raw;
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean));
  return style ?? {};
}

/** Every colour this tree paints, from every style prop in it. */
function paletteUsed(root: any): { backgrounds: string[]; colors: string[] } {
  const backgrounds: string[] = [];
  const colors: string[] = [];
  root.findAll(() => true).forEach((node: any) => {
    if (!node.props || node.props.style === undefined) return;
    const s = flatten(node.props.style);
    if (typeof s.backgroundColor === 'string') backgrounds.push(s.backgroundColor);
    if (typeof s.color === 'string') colors.push(s.color);
  });
  return { backgrounds, colors };
}

async function mount(module: string, props: any) {
  const Screen = require(module).default;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(ThemeProvider, null, React.createElement(Screen, props)),
    );
    await wait(10);
  });
  return tree;
}

/**
 * Colours that are allowed to sit outside the palette. Error red is deliberate
 * — it has to read as an error in both themes — and 'transparent' is not a
 * colour choice.
 */
const ALLOWED_OFF_PALETTE = new Set(['#D64545', 'transparent']);

(async () => {
  for (const scheme of ['light', 'dark'] as const) {
    systemScheme = scheme;
    const tokens: Record<string, string> = scheme === 'dark' ? dark : light;
    const tokenValues = new Set(Object.values(tokens));

    console.log(`\n--- ${scheme} ---`);

    for (const { name, module, props } of SCREENS) {
      const tree = await mount(module, props);
      const { backgrounds, colors } = paletteUsed(tree.root);

      check(
        `${name}: paints the themed background`,
        backgrounds.includes(tokens.background),
        backgrounds,
      );

      const strayBg = backgrounds.filter(
        (c) => !tokenValues.has(c) && !ALLOWED_OFF_PALETTE.has(c),
      );
      const strayText = colors.filter((c) => !tokenValues.has(c) && !ALLOWED_OFF_PALETTE.has(c));
      check(`${name}: every colour comes from the palette`, strayBg.length === 0 && strayText.length === 0, {
        strayBg,
        strayText,
      });

      check(
        `${name}: text is themed, never left to the platform default`,
        colors.includes(tokens.text) || colors.includes(tokens.textSecondary),
        colors,
      );

      // ScreenHeader renders the brand mark; its absence means a screen is
      // missing the shared chrome.
      const hasHeader = tree.root.findAll((n: any) => n.type === 'Image').length > 0;
      check(`${name}: has a ScreenHeader`, hasHeader);
    }
  }

  // The two palettes must actually differ, or "themed" means nothing.
  systemScheme = 'light';
  const lightTree = await mount('../src/screens/OrdersScreen', {});
  systemScheme = 'dark';
  const darkTree = await mount('../src/screens/OrdersScreen', {});
  check(
    'light and dark resolve to different backgrounds',
    paletteUsed(lightTree.root).backgrounds[0] !== paletteUsed(darkTree.root).backgrounds[0],
    {
      light: paletteUsed(lightTree.root).backgrounds[0],
      dark: paletteUsed(darkTree.root).backgrounds[0],
    },
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} theme states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
