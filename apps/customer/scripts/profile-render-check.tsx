/**
 * Renders the real ProfileScreen through react-test-renderer.
 *
 *   pnpm profile-render-check
 *
 * The theme is a REAL stub with state, so selecting a mode actually changes
 * what the selector reflects rather than being asserted against a frozen value.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: { phoneNumber: string | null; signOutThrows: boolean } = {
  phoneNumber: '+919876543210',
  signOutThrows: false,
};

let signOutCalls = 0;

const host = (name: string) => {
  const C = ({ children }: any) => React.createElement(name, null, children);
  Object.defineProperty(C, 'name', { value: name });
  return C;
};

const rnStub: any = new Proxy(
  {
    StyleSheet: { create: (o: any) => o, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'android', select: (o: any) => o.android },
    Modal: host('Modal'),
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

const COLORS = {
  background: '#FDFDFC', card: '#ECF3E1', primaryGreen: '#396C11', button: '#2F7D18',
  buttonText: '#FFFFFF', text: '#10200F', textSecondary: '#555555', border: '#E5E5E5',
  success: '#4BAE20', offerBackground: '#E8F5D8',
};

/** Real state, so the selector under test drives something that answers back. */
let currentMode = 'system';
let setModeSpy: string[] = [];
const themeStub = {
  useTheme: () => {
    const [mode, setModeState] = React.useState(currentMode);
    return {
      colors: COLORS,
      brand: { yellow: '#F9C900', blue: '#123D91', green: '#73A624' },
      mode,
      resolvedMode: mode === 'system' ? 'dark' : mode,
      setMode: (next: string) => {
        setModeSpy.push(next);
        currentMode = next;
        setModeState(next);
      },
    };
  },
};

const authStub = {
  useAuth: () => ({
    phoneNumber: control.phoneNumber,
    signOut: async () => {
      signOutCalls += 1;
      if (control.signOutThrows) throw new Error('network down');
    },
  }),
};

const stubs: Record<string, any> = {
  'react-native': rnStub,
  '../context/AuthContext': authStub,
  '../theme/ThemeContext': themeStub,
  '../components/ScreenHeader': { __esModule: true, default: host('ScreenHeader') },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const ProfileScreen = require('../src/screens/ProfileScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

const navigated: Array<[string, unknown]> = [];
const parentNavigated: Array<[string, unknown]> = [];
const navigation = {
  navigate: (name: string, params?: unknown) => navigated.push([name, params]),
  getParent: () => ({
    navigate: (name: string, params?: unknown) => parentNavigated.push([name, params]),
  }),
};

async function mount(mode = 'system') {
  navigated.length = 0;
  parentNavigated.length = 0;
  setModeSpy = [];
  signOutCalls = 0;
  currentMode = mode;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(ProfileScreen, { navigation, route: { params: undefined } }),
    );
    await wait(10);
  });
  return tree;
}

function find(tree: any, testID: string): any[] {
  return tree.root.findAll((n: any) => n.props && n.props.testID === testID);
}

async function press(tree: any, testID: string) {
  const [node] = find(tree, testID);
  if (!node) throw new Error(`no element with testID ${testID}`);
  await TestRenderer.act(async () => {
    node.props.onPress();
    await wait(10);
  });
}

/**
 * Flattened style of the node carrying this testID. Pressable takes a style
 * FUNCTION of { pressed }, so it has to be called before it is an array.
 */
function styleOf(tree: any, testID: string): any {
  const [node] = find(tree, testID);
  if (!node) return {};
  const raw = node.props.style;
  const style = typeof raw === 'function' ? raw({ pressed: false }) : raw;
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style ?? {};
}

const results: boolean[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail !== undefined) {
    console.log(`        got: ${String(JSON.stringify(detail)).slice(0, 300)}`);
  }
  results.push(ok);
}

function checkText(tree: any, label: string, expected: string[], absent: string[] = []) {
  const found = texts(tree.toJSON());
  const ok =
    expected.every((e) => found.some((f) => f.includes(e))) &&
    absent.every((a) => !found.some((f) => f.includes(a)));
  check(label, ok, found);
  if (ok) console.log(`        ${JSON.stringify(found).slice(0, 175)}`);
}

(async () => {
  // 1. user info + rows
  {
    const tree = await mount();
    checkText(tree, 'renders phone, both rows, theme options and sign out', [
      'Signed in as',
      '+919876543210',
      'Saved Addresses',
      'Order History',
      'Theme',
      'Light',
      'Dark',
      'System',
      'Sign Out',
    ]);
    check(
      'no debug cycle button left over',
      !texts(tree.toJSON()).some((t) => t.includes('Switch to')),
      texts(tree.toJSON()),
    );
  }

  // 1b. missing phone does not render an empty card
  {
    control.phoneNumber = null;
    const tree = await mount();
    checkText(tree, 'no phone available -> honest placeholder, not a blank line', [
      'Phone number unavailable',
    ]);
    control.phoneNumber = '+919876543210';
  }

  // 2. navigation
  {
    const tree = await mount();

    await press(tree, 'saved-addresses');
    check(
      'Saved Addresses -> parent navigate("AddressList", { mode: "manage" })',
      parentNavigated.length === 1 &&
        parentNavigated[0][0] === 'AddressList' &&
        JSON.stringify(parentNavigated[0][1]) === JSON.stringify({ mode: 'manage' }),
      parentNavigated,
    );

    await press(tree, 'order-history');
    check(
      'Order History -> navigate("OrderHistory") on this stack, unchanged',
      navigated.length === 1 && navigated[0][0] === 'OrderHistory',
      navigated,
    );
  }

  // 3. theme selector
  {
    const tree = await mount('system');
    check(
      'system selected -> System highlighted, Light and Dark are not',
      styleOf(tree, 'theme-system').backgroundColor === COLORS.button &&
        styleOf(tree, 'theme-light').backgroundColor === 'transparent' &&
        styleOf(tree, 'theme-dark').backgroundColor === 'transparent',
      {
        system: styleOf(tree, 'theme-system').backgroundColor,
        light: styleOf(tree, 'theme-light').backgroundColor,
      },
    );
    checkText(tree, 'system mode explains what it resolved to', ['Following your device']);

    await press(tree, 'theme-dark');
    check('tapping Dark calls setMode("dark")', setModeSpy.join(',') === 'dark', setModeSpy);
    check(
      'selection moves to Dark',
      styleOf(tree, 'theme-dark').backgroundColor === COLORS.button &&
        styleOf(tree, 'theme-system').backgroundColor === 'transparent',
      {
        dark: styleOf(tree, 'theme-dark').backgroundColor,
        system: styleOf(tree, 'theme-system').backgroundColor,
      },
    );
    check(
      'the device-follows note is only for system mode',
      find(tree, 'system-note').length === 0,
      find(tree, 'system-note').length,
    );
  }

  // 4. sign out
  {
    const tree = await mount();

    await press(tree, 'sign-out');
    checkText(tree, 'Sign Out -> confirmation first', [
      'Sign out of EaszyGoo?',
      'Stay signed in',
    ]);
    check('confirmation alone does not sign out', signOutCalls === 0, signOutCalls);

    await press(tree, 'sign-out-cancel');
    check(
      'cancel -> dialog gone, still signed in',
      signOutCalls === 0 && find(tree, 'sign-out-confirm').length === 0,
      signOutCalls,
    );

    await press(tree, 'sign-out');
    await press(tree, 'sign-out-confirm');
    check('confirm -> signOut called once', signOutCalls === 1, signOutCalls);
  }

  // 4b. a failing sign-out says so instead of looking like nothing happened
  {
    control.signOutThrows = true;
    const tree = await mount();
    await press(tree, 'sign-out');
    await press(tree, 'sign-out-confirm');
    checkText(tree, 'sign out failure surfaces an error', ['Could not sign out']);
    control.signOutThrows = false;
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} profile states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
