/**
 * Exercises the REAL vendor AuthProvider and the two auth screens.
 *
 *   pnpm auth-render-check
 *
 * Firebase Auth and the api-client are native/network edges, so they are faked
 * with something drivable by hand — the Firebase auth-state listener in
 * particular is captured so a sign-in can be delivered at a chosen moment,
 * which is the only way to reproduce the confirmOtp/listener race.
 *
 * Everything under test is real: AuthProvider, PhoneEntryScreen,
 * OtpVerifyScreen.
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

let appStateListener: ((s: string) => void) | null = null;

const rnStub: any = new Proxy(
  {
    StyleSheet: { create: (o: any) => o, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'android', select: (o: any) => o.android },
    useColorScheme: () => 'light',
    AppState: {
      currentState: 'active',
      addEventListener: (_event: string, fn: (s: string) => void) => {
        appStateListener = fn;
        return { remove: () => { appStateListener = null; } };
      },
    },
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

// ---------- fake @react-native-firebase/auth ----------

let authStateListener: ((user: any) => void) | null = null;
let currentUser: any = null;
let signOutCalls = 0;
let sendOtpCalls: string[] = [];
let sendOtpThrows: string | null = null;

const firebaseUser = (phone: string | null = '+919876543210') => ({
  phoneNumber: phone,
  getIdToken: async () => 'id-token-xyz',
});

const firebaseAuthStub = {
  onAuthStateChanged: (_auth: unknown, fn: (user: any) => void) => {
    authStateListener = fn;
    return () => {
      authStateListener = null;
    };
  },
  signInWithPhoneNumber: async (_auth: unknown, phone: string) => {
    sendOtpCalls.push(phone);
    if (sendOtpThrows) throw new Error(sendOtpThrows);
    return {
      confirm: async (code: string) => {
        if (code !== '123456') throw new Error('That code did not work');
        currentUser = firebaseUser();
        return {
          user: currentUser,
          additionalUserInfo: { isNewUser: control.isNewUser },
        };
      },
    };
  },
  signOut: async () => {
    signOutCalls += 1;
    currentUser = null;
  },
};

// ---------- fake @easzygoo/api-client ----------

type Control = {
  isNewUser: boolean;
  verifyThrows: boolean;
  vendorResponse: any;
  vendorThrows: string | null;
  vendorDelayMs: number;
};

const control: Control = {
  isNewUser: false,
  verifyThrows: false,
  vendorResponse: { onboarded: false },
  vendorThrows: null,
  vendorDelayMs: 0,
};

const verifyCalls: Array<string | undefined> = [];
let vendorCalls = 0;

const apiClientStub = {
  verify: async (_client: unknown, _token: string, role?: string) => {
    verifyCalls.push(role);
    if (control.verifyThrows) throw new Error('no such user');
    return { id: 'u1', role: role ?? 'VENDOR', name: null };
  },
  getMyVendor: async () => {
    vendorCalls += 1;
    const { vendorResponse, vendorThrows, vendorDelayMs } = control;
    if (vendorDelayMs) await new Promise((r) => setTimeout(r, vendorDelayMs));
    if (vendorThrows) throw new Error(vendorThrows);
    return vendorResponse;
  },
};

const stubs: Record<string, any> = {
  'react-native': rnStub,
  '@react-native-firebase/auth': firebaseAuthStub,
  '@easzygoo/api-client': apiClientStub,
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: { getItem: async () => null, setItem: async () => {} },
  },
  '../lib/firebase': {
    auth: {
      get currentUser() {
        return currentUser;
      },
    },
  },
  '../lib/api': { api: {} },
  '../../assets/easzygoo.jpeg': { __esModule: true, default: 1 },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const { AuthProvider, useAuth } = require('../src/context/AuthContext');
const { ThemeProvider } = require('../src/theme/ThemeContext');
const PhoneEntryScreen = require('../src/screens/PhoneEntryScreen').default;
const OtpVerifyScreen = require('../src/screens/OtpVerifyScreen').default;

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

function find(tree: any, testID: string): any[] {
  return tree.root.findAll((n: any) => n.props && n.props.testID === testID);
}

/**
 * The react-native stub builds each export as a wrapper component that drops
 * its props onto nothing, so the inner host element carries no props at all.
 * Matching on the wrapper (rnStub.TextInput) is what reaches the real props.
 */
function findByStub(tree: any, name: string): any[] {
  return tree.root.findAll((n: any) => n.type === rnStub[name]);
}

/** The one Pressable a screen renders as its primary action. */
function primaryButton(tree: any): any {
  const [button] = findByStub(tree, 'Pressable').filter((n: any) => typeof n.props.onPress === 'function');
  if (!button) throw new Error('no pressable button on screen');
  return button;
}

function reset() {
  authStateListener = null;
  appStateListener = null;
  currentUser = null;
  signOutCalls = 0;
  sendOtpCalls = [];
  sendOtpThrows = null;
  verifyCalls.length = 0;
  vendorCalls = 0;
  control.isNewUser = false;
  control.verifyThrows = false;
  control.vendorResponse = { onboarded: false };
  control.vendorThrows = null;
  control.vendorDelayMs = 0;
}

/** Mounts AuthProvider and hands back a live view of its context value. */
async function mountProvider(child?: any) {
  const seen: { ctx: any } = { ctx: null };
  function Probe() {
    seen.ctx = useAuth();
    return null;
  }
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(Probe, null),
          child ?? null,
        ),
      ),
    );
    await wait(10);
  });
  return { tree, seen };
}

/** Delivers a Firebase auth-state change and lets the effects settle. */
async function emitAuthState(user: any) {
  await TestRenderer.act(async () => {
    authStateListener?.(user);
    await wait(20);
  });
}

(async () => {
  // ---------- 1. cold start ----------
  console.log('\n--- cold start ---');

  {
    reset();
    const { seen } = await mountProvider();
    check('starts in the loading state', seen.ctx.isLoading === true);

    await emitAuthState(null);
    check('no Firebase session -> signed out, settled', seen.ctx.isLoading === false && seen.ctx.user === null);
    check('  ...and no profile was fetched for nobody', vendorCalls === 0, vendorCalls);
  }

  {
    reset();
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());
    check('restored session -> verify() called with NO role', verifyCalls.length === 1 && verifyCalls[0] === undefined, verifyCalls);
    check('  ...resolves the backend user', seen.ctx.user?.id === 'u1', seen.ctx.user);
    check('  ...and picks the phone number up from the credential', seen.ctx.phoneNumber === '+919876543210', seen.ctx.phoneNumber);
  }

  // ---------- 2. the stale-UID rule ----------
  console.log('\n--- stale UID: sign out, never self-heal ---');

  {
    reset();
    control.verifyThrows = true;
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());
    check('valid Firebase session with no backend row -> treated as signed out', seen.ctx.user === null, seen.ctx.user);
    check(
      '  ...and verify() was never retried with a role, so no account is re-created',
      verifyCalls.length === 1 && verifyCalls[0] === undefined,
      verifyCalls,
    );
    check('  ...and it stops loading rather than wedging', seen.ctx.isLoading === false);
    check('  ...and no vendor profile is fetched for a user we rejected', vendorCalls === 0, vendorCalls);
  }

  // ---------- 3. confirmOtp ----------
  console.log('\n--- confirmOtp ---');

  {
    reset();
    control.isNewUser = true;
    const { seen } = await mountProvider();
    await emitAuthState(null);

    const confirmation = await seen.ctx.sendOtp('+919876543210');
    await TestRenderer.act(async () => {
      await seen.ctx.confirmOtp(confirmation, '123456');
      await wait(20);
    });

    check('a brand-new vendor is created with role VENDOR', verifyCalls.includes('VENDOR'), verifyCalls);
    check('  ...and never as CUSTOMER', !verifyCalls.includes('CUSTOMER'), verifyCalls);
    check('  ...resolving the backend user', seen.ctx.user?.id === 'u1', seen.ctx.user);
  }

  {
    reset();
    control.isNewUser = false;
    const { seen } = await mountProvider();
    await emitAuthState(null);

    const confirmation = await seen.ctx.sendOtp('+919876543210');
    await TestRenderer.act(async () => {
      await seen.ctx.confirmOtp(confirmation, '123456');
      await wait(20);
    });

    check(
      'a returning account sends NO role, keeping whatever the backend stored',
      verifyCalls.length === 1 && verifyCalls[0] === undefined,
      verifyCalls,
    );
  }

  {
    reset();
    const { seen } = await mountProvider();
    await emitAuthState(null);
    const confirmation = await seen.ctx.sendOtp('+919876543210');

    let threw: string | null = null;
    await TestRenderer.act(async () => {
      try {
        await seen.ctx.confirmOtp(confirmation, '000000');
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      await wait(10);
    });
    check('a wrong code rejects and leaves the vendor signed out', threw !== null && seen.ctx.user === null, {
      threw,
      user: seen.ctx.user,
    });
  }

  // ---------- 4. the confirmOtp / listener race ----------
  console.log('\n--- signup race ---');

  {
    reset();
    control.isNewUser = true;
    const { seen } = await mountProvider();
    await emitAuthState(null);

    const confirmation = await seen.ctx.sendOtp('+919876543210');
    await TestRenderer.act(async () => {
      const pending = seen.ctx.confirmOtp(confirmation, '123456');
      // Firebase fires the listener the moment confirm() succeeds. Without the
      // in-flight guard this second, role-less verify() would find no backend
      // row for a brand-new vendor and sign them out mid-signup.
      authStateListener?.(firebaseUser());
      await pending;
      await wait(20);
    });

    check(
      'the listener does not race a second role-less verify() during signup',
      verifyCalls.length === 1 && verifyCalls[0] === 'VENDOR',
      verifyCalls,
    );
    check('  ...so the new vendor stays signed in', seen.ctx.user?.id === 'u1', seen.ctx.user);
  }

  // ---------- 5. the vendor profile ----------
  console.log('\n--- vendor profile ---');

  {
    reset();
    control.vendorResponse = { onboarded: true, vendor: { storeName: 'Green Basket', status: 'PENDING' } };
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());

    check('the profile is fetched once the user resolves', vendorCalls === 1, vendorCalls);
    check('  ...and stored', seen.ctx.vendorProfile?.onboarded === true, seen.ctx.vendorProfile);
    check('  ...with the status pulled out for the screens that need it', seen.ctx.vendorStatus === 'PENDING', seen.ctx.vendorStatus);
    check('  ...and no error', seen.ctx.vendorError === null, seen.ctx.vendorError);
  }

  {
    reset();
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());
    check(
      'a vendor with no store yet reports onboarded:false, and vendorStatus stays null',
      seen.ctx.vendorProfile?.onboarded === false && seen.ctx.vendorStatus === null,
      { profile: seen.ctx.vendorProfile, status: seen.ctx.vendorStatus },
    );
  }

  {
    reset();
    control.vendorThrows = 'Check your connection and try again.';
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());
    check('a failed fetch records the error', seen.ctx.vendorError === 'Check your connection and try again.', seen.ctx.vendorError);
    check(
      '  ...and leaves the profile null rather than inventing onboarded:false',
      seen.ctx.vendorProfile === null,
      seen.ctx.vendorProfile,
    );

    control.vendorThrows = null;
    control.vendorResponse = { onboarded: true, vendor: { storeName: 'Green Basket', status: 'APPROVED' } };
    await TestRenderer.act(async () => {
      await seen.ctx.refreshVendor();
      await wait(10);
    });
    check('refreshVendor recovers and clears the error', seen.ctx.vendorError === null && seen.ctx.vendorStatus === 'APPROVED', {
      error: seen.ctx.vendorError,
      status: seen.ctx.vendorStatus,
    });
  }

  // ---------- 6. foreground refresh ----------
  console.log('\n--- foreground refresh ---');

  {
    reset();
    control.vendorResponse = { onboarded: true, vendor: { storeName: 'Green Basket', status: 'PENDING' } };
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());
    check('one fetch so far', vendorCalls === 1, vendorCalls);

    // Approved while the app sat in the background.
    control.vendorResponse = { onboarded: true, vendor: { storeName: 'Green Basket', status: 'APPROVED' } };
    await TestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await wait(20);
    });

    check('returning to the foreground re-fetches', vendorCalls === 2, vendorCalls);
    check(
      '  ...so an approval that happened while the app was closed shows up',
      seen.ctx.vendorStatus === 'APPROVED',
      seen.ctx.vendorStatus,
    );

    const before = vendorCalls;
    await TestRenderer.act(async () => {
      appStateListener?.('active');
      await wait(10);
    });
    check('active -> active is not a return, so it does not re-fetch', vendorCalls === before, vendorCalls);
  }

  {
    reset();
    control.vendorResponse = { onboarded: true, vendor: { storeName: 'Old', status: 'PENDING' } };
    control.vendorDelayMs = 60;
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());

    // A slow first fetch, overtaken by a fast newer one.
    await TestRenderer.act(async () => {
      control.vendorDelayMs = 0;
      control.vendorResponse = { onboarded: true, vendor: { storeName: 'New', status: 'APPROVED' } };
      await seen.ctx.refreshVendor();
      await wait(120);
    });
    check(
      'a slow earlier fetch cannot overwrite a newer answer',
      seen.ctx.vendorStatus === 'APPROVED',
      seen.ctx.vendorStatus,
    );
  }

  // ---------- 7. sign out ----------
  console.log('\n--- sign out ---');

  {
    reset();
    control.vendorResponse = { onboarded: true, vendor: { storeName: 'Green Basket', status: 'APPROVED' } };
    const { seen } = await mountProvider();
    await emitAuthState(firebaseUser());

    await TestRenderer.act(async () => {
      await seen.ctx.signOut();
      await wait(10);
    });

    check('signs out of Firebase', signOutCalls === 1, signOutCalls);
    check(
      'clears the user, the phone number and the vendor profile together',
      seen.ctx.user === null && seen.ctx.phoneNumber === null && seen.ctx.vendorProfile === null,
      { user: seen.ctx.user, phone: seen.ctx.phoneNumber, profile: seen.ctx.vendorProfile },
    );
  }

  // ---------- 8. the auth screens ----------
  console.log('\n--- PhoneEntry / OtpVerify ---');

  {
    reset();
    const navigated: Array<[string, any]> = [];
    const navigation = { navigate: (n: string, p: any) => navigated.push([n, p]), goBack: () => {} };

    const { tree, seen } = await mountProvider(
      React.createElement(PhoneEntryScreen, { navigation, route: { params: undefined } }),
    );
    await emitAuthState(null);

    const found = texts(tree.toJSON());
    check(
      'PhoneEntry says which app this is',
      found.some((t) => t.includes('Enter your phone number')) &&
        found.some((t) => t.includes('manage your EaszyGoo store')),
      found,
    );

    const [input] = findByStub(tree, 'TextInput');
    check('the field is pre-seeded with +91', input.props.value === '+91', input.props.value);

    await TestRenderer.act(async () => {
      input.props.onChangeText('+919876543210');
      await wait(5);
    });
    const button = primaryButton(tree);
    await TestRenderer.act(async () => {
      button.props.onPress();
      await wait(20);
    });

    check('Send OTP calls Firebase with the typed number', sendOtpCalls[0] === '+919876543210', sendOtpCalls);
    check(
      'the live confirmation goes into context, not into route params',
      seen.ctx.pendingConfirmation !== null &&
        navigated.length === 1 &&
        navigated[0][0] === 'OtpVerify' &&
        JSON.stringify(navigated[0][1]) === JSON.stringify({ phoneNumber: '+919876543210' }),
      { navigated, pending: seen.ctx.pendingConfirmation !== null },
    );
  }

  {
    reset();
    sendOtpThrows = 'Too many requests';
    const navigated: Array<[string, any]> = [];
    const navigation = { navigate: (n: string, p: any) => navigated.push([n, p]), goBack: () => {} };
    const { tree } = await mountProvider(
      React.createElement(PhoneEntryScreen, { navigation, route: { params: undefined } }),
    );
    await emitAuthState(null);

    const [input] = findByStub(tree, 'TextInput');
    await TestRenderer.act(async () => {
      input.props.onChangeText('+919876543210');
      await wait(5);
    });
    const button = primaryButton(tree);
    await TestRenderer.act(async () => {
      button.props.onPress();
      await wait(20);
    });

    check(
      'a failed send shows the reason and does not navigate on',
      texts(tree.toJSON()).some((t) => t.includes('Too many requests')) && navigated.length === 0,
      { texts: texts(tree.toJSON()), navigated },
    );
  }

  {
    reset();
    // Entered without a live confirmation — the app was backgrounded long
    // enough to lose it, or the screen was reached directly.
    const goneBack: number[] = [];
    const navigation = { navigate: () => {}, goBack: () => goneBack.push(1) };
    const { tree } = await mountProvider(
      React.createElement(OtpVerifyScreen, {
        navigation,
        route: { params: { phoneNumber: '+919876543210' } },
      }),
    );
    await emitAuthState(null);

    check(
      'OtpVerify with no pending confirmation offers a way back, not a dead form',
      texts(tree.toJSON()).some((t) => t.includes('This code has expired')),
      texts(tree.toJSON()),
    );
  }

  {
    reset();
    control.isNewUser = true;
    const navigation = { navigate: () => {}, goBack: () => {} };
    const { tree, seen } = await mountProvider(
      React.createElement(OtpVerifyScreen, {
        navigation,
        route: { params: { phoneNumber: '+919876543210' } },
      }),
    );
    await emitAuthState(null);

    // Arrive the way PhoneEntry would have left it.
    const confirmation = await seen.ctx.sendOtp('+919876543210');
    await TestRenderer.act(async () => {
      seen.ctx.setPendingConfirmation(confirmation);
      await wait(10);
    });

    check(
      'with a pending confirmation the form is shown, addressed to that number',
      texts(tree.toJSON()).some((t) => t.includes('+919876543210')),
      texts(tree.toJSON()),
    );

    const [input] = findByStub(tree, 'TextInput');
    await TestRenderer.act(async () => {
      input.props.onChangeText('12ab34cd56');
      await wait(5);
    });
    check('the code field keeps digits only', input.props.value === '123456', input.props.value);

    const button = primaryButton(tree);
    await TestRenderer.act(async () => {
      button.props.onPress();
      await wait(30);
    });

    check('verifying signs the vendor in as VENDOR', verifyCalls.includes('VENDOR') && seen.ctx.user?.id === 'u1', {
      verifyCalls,
      user: seen.ctx.user,
    });
    check('  ...and clears the pending confirmation', seen.ctx.pendingConfirmation === null);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} auth states verified`);
  console.log(
    '\nNot coverable without a device: the real SMS round trip, Play Integrity /\n' +
      'reCAPTCHA verification, and the native google-services.json wiring.',
  );
  process.exit(passed === results.length ? 0 : 1);
})();
