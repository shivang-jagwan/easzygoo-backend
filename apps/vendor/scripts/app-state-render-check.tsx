/**
 * Exercises the computed vendorAppState — the thing that replaced the
 * hand-flipped constant in App.tsx.
 *
 *   pnpm app-state-render-check
 *
 * Three layers, from the inside out:
 *   1. resolveVendorAppState(), as a pure function, over every input shape
 *   2. RootNavigator, mounting the branch that state names
 *   3. PendingApprovalScreen, picking its wording from the vendor's status
 *
 * The REAL resolver, the REAL RootNavigator and the REAL PendingApprovalScreen
 * run. React Navigation is faked down to something whose mounted screen names
 * can be read back, since a real navigator needs a host platform.
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

let systemScheme: 'light' | 'dark' = 'light';

const rnStub: any = new Proxy(
  {
    StyleSheet: { create: (o: any) => o, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'android', select: (o: any) => o.android },
    useColorScheme: () => systemScheme,
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

const asyncStorageStub = {
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {} },
};

/** Records which screens the navigator actually mounted. */
const navStub = {
  NavigationContainer: ({ theme, children }: any) =>
    React.createElement('NavigationContainer', { theme }, children),
  DefaultTheme: { dark: false, colors: { primary: 'x', background: 'x', card: 'x', text: 'x', border: 'x', notification: 'x' } },
  DarkTheme: { dark: true, colors: { primary: 'x', background: 'x', card: 'x', text: 'x', border: 'x', notification: 'x' } },
};

const stackStub = {
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: any) => React.createElement('Navigator', null, children),
    Screen: ({ name }: any) => React.createElement('Screen', { name }),
  }),
};

const tabsStub = {
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: any) => React.createElement('TabNavigator', null, children),
    Screen: ({ name }: any) => React.createElement('TabScreen', { name }),
  }),
};

// ---------- the auth state under test ----------

type AuthControl = {
  user: unknown;
  isLoading: boolean;
  vendorProfile: any;
  vendorStatus: string | null;
  vendorError: string | null;
  refreshThrows: boolean;
  signOutThrows: boolean;
};

const control: AuthControl = {
  user: { id: 'u1', role: 'VENDOR', name: null },
  isLoading: false,
  vendorProfile: { onboarded: true, vendor: { storeName: 'Green Basket', status: 'APPROVED' } },
  vendorStatus: 'APPROVED',
  vendorError: null,
  refreshThrows: false,
  signOutThrows: false,
};

let refreshCalls = 0;
let signOutCalls = 0;

const authStub = {
  useAuth: () => ({
    user: control.user,
    phoneNumber: '+919876543210',
    isLoading: control.isLoading,
    pendingConfirmation: null,
    setPendingConfirmation: () => {},
    vendorProfile: control.vendorProfile,
    vendorStatus: control.vendorStatus,
    vendorError: control.vendorError,
    refreshVendor: async () => {
      refreshCalls += 1;
      if (control.refreshThrows) throw new Error('still down');
    },
    sendOtp: async () => ({}),
    confirmOtp: async () => {},
    signOut: async () => {
      signOutCalls += 1;
      if (control.signOutThrows) throw new Error('network down');
    },
  }),
};

const stubs: Record<string, any> = {
  'react-native': rnStub,
  '@react-native-async-storage/async-storage': asyncStorageStub,
  '@react-navigation/native': navStub,
  '@react-navigation/native-stack': stackStub,
  '@react-navigation/bottom-tabs': tabsStub,
  '../../assets/easzygoo.jpeg': { __esModule: true, default: 1 },
  '../context/AuthContext': authStub,
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const { resolveVendorAppState } = require('../src/lib/vendorAppState');
const { ThemeProvider } = require('../src/theme/ThemeContext');
const { light } = require('../src/theme/colors');
const RootNavigator = require('../src/navigation/RootNavigator').default;
const PendingApprovalScreen = require('../src/screens/PendingApprovalScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: boolean[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail !== undefined) {
    console.log(`        got: ${String(JSON.stringify(detail)).slice(0, 300)}`);
  }
  results.push(ok);
}

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => texts(n, out));
    return out;
  }
  if (node.children) texts(node.children, out);
  return out;
}

const vendor = (status: string) => ({
  onboarded: true,
  vendor: { storeName: 'Green Basket', status },
});
const USER = { id: 'u1', role: 'VENDOR', name: null };

async function mountRoot() {
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(ThemeProvider, null, React.createElement(RootNavigator, null)),
    );
    await wait(10);
  });
  return tree;
}

/** Names of the screens the root navigator actually mounted. */
function mountedScreens(tree: any): string[] {
  return tree.root
    .findAll((n: any) => n.type === 'Screen')
    .map((n: any) => n.props.name);
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

(async () => {
  // ---------- 1. the resolver, on its own ----------
  console.log('\n--- resolveVendorAppState ---');

  const cases: Array<[string, any, any]> = [
    [
      'auth still restoring -> loading, whatever else is set',
      { isAuthLoading: true, user: null, profile: null, profileError: false },
      { kind: 'loading' },
    ],
    [
      'no user -> loggedOut',
      { isAuthLoading: false, user: null, profile: null, profileError: false },
      { kind: 'ready', state: 'loggedOut' },
    ],
    [
      'user, profile still in flight -> loading (not onboarding)',
      { isAuthLoading: false, user: USER, profile: null, profileError: false },
      { kind: 'loading' },
    ],
    [
      'onboarded:false -> onboarding',
      { isAuthLoading: false, user: USER, profile: { onboarded: false }, profileError: false },
      { kind: 'ready', state: 'onboarding' },
    ],
    [
      'PENDING -> pendingApproval',
      { isAuthLoading: false, user: USER, profile: vendor('PENDING'), profileError: false },
      { kind: 'ready', state: 'pendingApproval' },
    ],
    [
      'REJECTED -> pendingApproval (blocked, different copy)',
      { isAuthLoading: false, user: USER, profile: vendor('REJECTED'), profileError: false },
      { kind: 'ready', state: 'pendingApproval' },
    ],
    [
      'SUSPENDED -> pendingApproval (blocked, different copy)',
      { isAuthLoading: false, user: USER, profile: vendor('SUSPENDED'), profileError: false },
      { kind: 'ready', state: 'pendingApproval' },
    ],
    [
      'APPROVED -> active',
      { isAuthLoading: false, user: USER, profile: vendor('APPROVED'), profileError: false },
      { kind: 'ready', state: 'active' },
    ],
    [
      'fetch failed -> error, NEVER onboarding',
      { isAuthLoading: false, user: USER, profile: null, profileError: true },
      { kind: 'error' },
    ],
    [
      'fetch failed after a profile was known -> still error, not stale data',
      { isAuthLoading: false, user: USER, profile: vendor('APPROVED'), profileError: true },
      { kind: 'error' },
    ],
    [
      'signed out wins over a leftover profile',
      { isAuthLoading: false, user: null, profile: vendor('APPROVED'), profileError: false },
      { kind: 'ready', state: 'loggedOut' },
    ],
  ];

  for (const [label, input, expected] of cases) {
    const actual = resolveVendorAppState(input);
    check(label, JSON.stringify(actual) === JSON.stringify(expected), actual);
  }

  // ---------- 2. RootNavigator mounts the matching branch ----------
  console.log('\n--- RootNavigator branches ---');

  const branches: Array<[string, Partial<AuthControl>, string]> = [
    ['loggedOut mounts only Auth', { user: null, vendorProfile: null }, 'Auth'],
    [
      'onboarding mounts only Onboarding',
      { user: USER, vendorProfile: { onboarded: false } },
      'Onboarding',
    ],
    [
      'PENDING mounts only PendingApproval',
      { user: USER, vendorProfile: vendor('PENDING') },
      'PendingApproval',
    ],
    [
      'SUSPENDED mounts only PendingApproval',
      { user: USER, vendorProfile: vendor('SUSPENDED') },
      'PendingApproval',
    ],
    ['APPROVED mounts only Main', { user: USER, vendorProfile: vendor('APPROVED') }, 'Main'],
  ];

  for (const [label, patch, expectedScreen] of branches) {
    Object.assign(control, { isLoading: false, vendorError: null }, patch);
    const tree = await mountRoot();
    const screens = mountedScreens(tree);
    check(label, screens.length === 1 && screens[0] === expectedScreen, screens);
  }

  // ---------- 3. the two non-flow gates ----------
  console.log('\n--- loading and error gates ---');

  {
    Object.assign(control, { isLoading: true, user: null, vendorProfile: null, vendorError: null });
    const tree = await mountRoot();
    check('auth restoring -> spinner, no navigator', find(tree, 'root-loading').length > 0);
    check('  ...and no flow is mounted yet', mountedScreens(tree).length === 0, mountedScreens(tree));
  }

  {
    Object.assign(control, {
      isLoading: false,
      user: USER,
      vendorProfile: null,
      vendorError: null,
    });
    const tree = await mountRoot();
    check(
      'signed in but profile still loading -> spinner, NOT the onboarding form',
      find(tree, 'root-loading').length > 0 && mountedScreens(tree).length === 0,
      mountedScreens(tree),
    );
  }

  {
    refreshCalls = 0;
    Object.assign(control, {
      isLoading: false,
      user: USER,
      vendorProfile: null,
      vendorError: 'Check your connection and try again.',
    });
    const tree = await mountRoot();
    const found = texts(tree.toJSON());
    check(
      'profile fetch failed -> says so and offers a retry',
      found.some((t) => t.includes('Could not load your store')) &&
        found.some((t) => t.includes('Try again')),
      found,
    );
    check(
      '  ...and mounts no flow at all, so nobody is walked back into onboarding',
      mountedScreens(tree).length === 0,
      mountedScreens(tree),
    );
    check(
      '  ...and shows the real reason, not a generic one',
      found.some((t) => t.includes('Check your connection')),
      found,
    );

    await press(tree, 'root-retry');
    check('Try again calls refreshVendor', refreshCalls === 1, refreshCalls);
  }

  // ---------- 4. the navigator gets our palette ----------
  {
    Object.assign(control, {
      isLoading: false,
      user: USER,
      vendorProfile: vendor('APPROVED'),
      vendorError: null,
    });
    systemScheme = 'light';
    const tree = await mountRoot();
    const [container] = tree.root.findAll((n: any) => n.type === 'NavigationContainer');
    check(
      'React Navigation gets our tokens, not its own defaults',
      container.props.theme.colors.background === light.background &&
        container.props.theme.colors.primary === light.primaryGreen &&
        container.props.theme.dark === false,
      container.props.theme.colors,
    );
  }

  // ---------- 5. PendingApproval says something different per status ----------
  console.log('\n--- PendingApproval copy ---');

  async function mountPending(status: string | null) {
    control.vendorStatus = status;
    refreshCalls = 0;
    signOutCalls = 0;
    let tree: any;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(ThemeProvider, null, React.createElement(PendingApprovalScreen, null)),
      );
      await wait(10);
    });
    return tree;
  }

  const seen: Record<string, string> = {};
  for (const status of ['PENDING', 'REJECTED', 'SUSPENDED']) {
    const tree = await mountPending(status);
    const [title] = find(tree, 'status-title');
    const [body] = find(tree, 'status-body');
    seen[status] = `${texts(title.children).join('')}|${texts(body.children).join('')}`;
    check(`${status}: renders a title and a body`, seen[status].length > 20, seen[status]);
  }

  check(
    'all three statuses say something different',
    new Set(Object.values(seen)).size === 3,
    Object.keys(seen).map((k) => seen[k].slice(0, 60)),
  );
  check(
    'PENDING is the only one that says "under review"',
    seen.PENDING.includes('under review') &&
      !seen.REJECTED.includes('under review') &&
      !seen.SUSPENDED.includes('under review'),
    seen,
  );
  check(
    'REJECTED does not tell someone to keep waiting',
    seen.REJECTED.includes('not approved') && seen.REJECTED.includes('support'),
    seen.REJECTED,
  );
  check(
    'SUSPENDED names the suspension rather than a review',
    seen.SUSPENDED.includes('suspended'),
    seen.SUSPENDED,
  );

  {
    const tree = await mountPending(null);
    check(
      'missing status -> falls back to the neutral PENDING wording, not a blank screen',
      texts(tree.toJSON()).some((t) => t.includes('under review')),
      texts(tree.toJSON()),
    );
  }

  {
    const tree = await mountPending('PENDING');
    await press(tree, 'check-again');
    check('Check again re-fetches the profile', refreshCalls === 1, refreshCalls);

    await press(tree, 'sign-out');
    check(
      'a blocked vendor can sign out rather than being stuck here',
      signOutCalls === 1,
      signOutCalls,
    );
  }

  {
    control.signOutThrows = true;
    const tree = await mountPending('REJECTED');
    await press(tree, 'sign-out');
    check(
      'a failing sign-out surfaces the error instead of doing nothing',
      texts(tree.toJSON()).some((t) => t.includes('network down')),
      texts(tree.toJSON()),
    );
    control.signOutThrows = false;
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} app-state cases verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
