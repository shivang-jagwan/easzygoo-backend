/**
 * Exercises src/lib/notifications.ts and its AuthContext integration.
 *
 *   pnpm notifications-render-check
 *
 * @react-native-firebase/messaging is a native module, so it is replaced with a
 * fake whose handlers can be driven by hand. Everything else — the real lib,
 * the real AuthProvider — runs unmodified.
 *
 * NOTE: there was no AuthContext harness before this; this file is the first
 * thing to render AuthProvider outside a device.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

// ---------- fake @react-native-firebase/messaging ----------

const AuthorizationStatus = { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 };

const fcm: {
  permission: number;
  token: string;
  getTokenThrows: boolean;
  onMessageHandlers: Function[];
  onOpenedHandlers: Function[];
  onTokenRefreshHandlers: Function[];
  initialNotification: any;
  unsubscribed: string[];
  requestPermissionCalls: number;
} = {
  permission: AuthorizationStatus.AUTHORIZED,
  token: 'fcm-token-abc',
  getTokenThrows: false,
  onMessageHandlers: [],
  onOpenedHandlers: [],
  onTokenRefreshHandlers: [],
  initialNotification: null,
  unsubscribed: [],
  requestPermissionCalls: 0,
};

function messagingFn() {
  return {
    requestPermission: async () => {
      fcm.requestPermissionCalls += 1;
      return fcm.permission;
    },
    getToken: async () => {
      if (fcm.getTokenThrows) throw new Error('FCM unavailable');
      return fcm.token;
    },
    onTokenRefresh: (fn: Function) => {
      fcm.onTokenRefreshHandlers.push(fn);
      return () => fcm.unsubscribed.push('onTokenRefresh');
    },
    onMessage: (fn: Function) => {
      fcm.onMessageHandlers.push(fn);
      return () => fcm.unsubscribed.push('onMessage');
    },
    onNotificationOpenedApp: (fn: Function) => {
      fcm.onOpenedHandlers.push(fn);
      return () => fcm.unsubscribed.push('onNotificationOpenedApp');
    },
    getInitialNotification: async () => fcm.initialNotification,
  };
}
(messagingFn as any).AuthorizationStatus = AuthorizationStatus;

const messagingStub = { __esModule: true, default: messagingFn };

// ---------- fake api-client ----------

const registered: Array<{ token: string; platform?: string }> = [];
let verifyCalls = 0;
let verifyThrows = false;
/** The role argument of each verify() call, in order. undefined = sent no role. */
const verifyRoles: Array<string | undefined> = [];
/** What confirm() should report about the account it just signed in. */
let isNewUser = false;
/**
 * Whether the backend already has a User row for this UID. The real
 * POST /v1/auth/verify 404s a role-less call for an unknown UID and only
 * creates a row when a role is supplied — without modelling that, a harness
 * cannot tell the race apart from the happy path.
 */
let backendUserExists = true;
/**
 * Delay applied only to role-less verify() calls. The race is only damaging in
 * one interleaving — the listener's rejection landing AFTER confirmOtp has
 * already set the user — so the harness pins that ordering rather than
 * whichever one the event loop happens to pick.
 */
let rolelessVerifyDelayMs = 0;

const apiClientStub = {
  registerPushToken: async (_client: unknown, token: string, platform?: string) => {
    registered.push({ token, platform });
    return { id: 'pt1', userId: 'u1', token, platform: platform ?? null, createdAt: '' };
  },
  verify: async (_client: unknown, _token: string, role?: string) => {
    verifyCalls += 1;
    verifyRoles.push(role);
    if (verifyThrows) throw new Error('backend down');
    // Whether this call 404s is decided when the request LANDS, not when its
    // response is delivered. Two verifies race for one sign-in, and the
    // role-less one can be answered from a moment when no row existed yet —
    // deciding it after the delay would let the other call's write paper over
    // exactly the failure being tested for.
    const missing = !backendUserExists && role === undefined;
    if (role !== undefined) backendUserExists = true;
    if (role === undefined && rolelessVerifyDelayMs) {
      await new Promise((r) => setTimeout(r, rolelessVerifyDelayMs));
    }
    if (missing) throw new Error('no such user');
    return { id: 'u1', role: role ?? 'CUSTOMER', name: null };
  },
};

// ---------- fake react-native + firebase auth ----------

const host = (name: string) => {
  const C = ({ children }: any) => React.createElement(name, null, children);
  Object.defineProperty(C, 'name', { value: name });
  return C;
};

const rnStub: any = new Proxy(
  {
    StyleSheet: { create: (o: any) => o, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'android', select: (o: any) => o.android },
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

let authStateListener: ((user: any) => void) | null = null;
const firebaseAuthStub = {
  onAuthStateChanged: (_auth: unknown, fn: (user: any) => void) => {
    authStateListener = fn;
    return () => {
      authStateListener = null;
    };
  },
  signInWithPhoneNumber: async () => ({
    confirm: async () => ({
      user: { phoneNumber: '+919876543210', getIdToken: async () => 'id-token' },
      additionalUserInfo: { isNewUser },
    }),
  }),
  signOut: async () => {},
};

const stubs: Record<string, any> = {
  'react-native': rnStub,
  '@react-native-firebase/messaging': messagingStub,
  '@react-native-firebase/auth': firebaseAuthStub,
  '@easzygoo/api-client': apiClientStub,
  '../lib/firebase': { auth: {} },
  '../lib/api': { api: {} },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const notifications = require('../src/lib/notifications');
const { AuthProvider, useAuth } = require('../src/context/AuthContext');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: boolean[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail !== undefined) {
    console.log(`        got: ${String(JSON.stringify(detail)).slice(0, 300)}`);
  }
  results.push(ok);
}

function reset() {
  fcm.permission = AuthorizationStatus.AUTHORIZED;
  fcm.token = 'fcm-token-abc';
  fcm.getTokenThrows = false;
  fcm.onMessageHandlers = [];
  fcm.onOpenedHandlers = [];
  fcm.onTokenRefreshHandlers = [];
  fcm.initialNotification = null;
  fcm.unsubscribed = [];
  fcm.requestPermissionCalls = 0;
  registered.length = 0;
  verifyCalls = 0;
  verifyThrows = false;
  verifyRoles.length = 0;
  isNewUser = false;
  backendUserExists = true;
  rolelessVerifyDelayMs = 0;
  authStateListener = null;
}

(async () => {
  // ---------- permission ----------

  {
    reset();
    fcm.permission = AuthorizationStatus.AUTHORIZED;
    check(
      'AUTHORIZED -> granted',
      (await notifications.requestNotificationPermission()) === true,
    );

    fcm.permission = AuthorizationStatus.PROVISIONAL;
    check(
      'PROVISIONAL (iOS quiet delivery) -> granted, still deliverable',
      (await notifications.requestNotificationPermission()) === true,
    );

    fcm.permission = AuthorizationStatus.DENIED;
    check('DENIED -> not granted', (await notifications.requestNotificationPermission()) === false);

    fcm.permission = AuthorizationStatus.NOT_DETERMINED;
    check(
      'NOT_DETERMINED -> not granted',
      (await notifications.requestNotificationPermission()) === false,
    );
  }

  // ---------- token registration ----------

  {
    reset();
    const token = await notifications.registerDeviceToken({});
    check(
      'registerDeviceToken -> posts the raw FCM token with the platform',
      token === 'fcm-token-abc' &&
        registered.length === 1 &&
        registered[0].token === 'fcm-token-abc' &&
        registered[0].platform === 'android',
      registered,
    );
    check(
      'the token is a raw FCM token, not an Expo-wrapped one',
      !registered[0].token.startsWith('ExponentPushToken'),
      registered[0].token,
    );
  }

  // ---------- token rotation ----------

  {
    reset();
    notifications.watchTokenRefresh({});
    check('watchTokenRefresh subscribes once', fcm.onTokenRefreshHandlers.length === 1);
    check('subscribing alone registers nothing', registered.length === 0, registered);

    await fcm.onTokenRefreshHandlers[0]('fcm-token-rotated');
    check(
      'a rotated token re-registers automatically',
      registered.length === 1 && registered[0].token === 'fcm-token-rotated',
      registered,
    );
  }

  // ---------- data payload -> orderId ----------

  {
    check(
      'orderId extracted from the data payload',
      notifications.orderIdFromMessage({ data: { orderId: 'ord-9', type: 'ORDER_UPDATE' } }) ===
        'ord-9',
    );
    check(
      'a notification with no orderId yields null',
      notifications.orderIdFromMessage({ data: { type: 'PROMO' } }) === null,
    );
    check('no data at all -> null', notifications.orderIdFromMessage({}) === null);
    check('null message -> null', notifications.orderIdFromMessage(null) === null);
    check(
      'an empty orderId is not an orderId',
      notifications.orderIdFromMessage({ data: { orderId: '' } }) === null,
    );
  }

  // ---------- handlers ----------

  {
    reset();
    const navigated: Array<[string, unknown]> = [];
    const navigationRef = {
      isReady: () => true,
      navigate: (name: string, params: unknown) => navigated.push([name, params]),
    };

    const teardown = notifications.setupNotificationHandlers(navigationRef);
    await wait(10); // getInitialNotification resolves on a microtask

    check(
      'all three entry points are wired',
      fcm.onMessageHandlers.length === 1 && fcm.onOpenedHandlers.length === 1,
      { message: fcm.onMessageHandlers.length, opened: fcm.onOpenedHandlers.length },
    );
    check('no initial notification -> no navigation', navigated.length === 0, navigated);

    // Foreground: banner, never navigation.
    const seen: any[] = [];
    const unsubscribe = notifications.onForegroundNotification((n: any) => seen.push(n));
    fcm.onMessageHandlers[0]({
      notification: { title: 'Order accepted', body: 'Shivang Fresh is preparing it' },
      data: { orderId: 'ord-9' },
    });
    check(
      'foreground message -> banner content published',
      seen.length === 1 &&
        seen[0].title === 'Order accepted' &&
        seen[0].body === 'Shivang Fresh is preparing it',
      seen,
    );
    check(
      'foreground message does NOT navigate, even carrying an orderId',
      navigated.length === 0,
      navigated,
    );

    // A data-only message has no title to show.
    fcm.onMessageHandlers[0]({ data: { orderId: 'ord-9' } });
    check('data-only foreground message shows no banner', seen.length === 1, seen);

    unsubscribe();
    fcm.onMessageHandlers[0]({ notification: { title: 'Ignored' } });
    check('unsubscribed listener stops receiving', seen.length === 1, seen);

    // Backgrounded, then tapped.
    fcm.onOpenedHandlers[0]({ data: { orderId: 'ord-9' } });
    check(
      'tapping a backgrounded notification -> navigate to OrderTracking',
      navigated.length === 1 &&
        navigated[0][0] === 'OrderTracking' &&
        JSON.stringify(navigated[0][1]) === JSON.stringify({ orderId: 'ord-9' }),
      navigated,
    );

    fcm.onOpenedHandlers[0]({ data: { type: 'PROMO' } });
    check('a tap with no orderId navigates nowhere', navigated.length === 1, navigated);

    teardown();
    check(
      'teardown unsubscribes both live listeners',
      fcm.unsubscribed.includes('onMessage') &&
        fcm.unsubscribed.includes('onNotificationOpenedApp'),
      fcm.unsubscribed,
    );
  }

  // ---------- cold start ----------

  {
    reset();
    const navigated: Array<[string, unknown]> = [];
    fcm.initialNotification = { data: { orderId: 'ord-cold' } };

    notifications.setupNotificationHandlers({
      isReady: () => true,
      navigate: (name: string, params: unknown) => navigated.push([name, params]),
    });
    await wait(10);

    check(
      'launched from a killed state by a notification -> navigates to that order',
      navigated.length === 1 &&
        navigated[0][0] === 'OrderTracking' &&
        JSON.stringify(navigated[0][1]) === JSON.stringify({ orderId: 'ord-cold' }),
      navigated,
    );
  }

  // ---------- cold start before the navigator mounts ----------

  {
    reset();
    const navigated: Array<[string, unknown]> = [];
    let ready = false;
    fcm.initialNotification = { data: { orderId: 'ord-early' } };

    notifications.setupNotificationHandlers({
      isReady: () => ready,
      navigate: (name: string, params: unknown) => navigated.push([name, params]),
    });
    await wait(10);
    check('navigator not ready yet -> nothing navigated, nothing dropped', navigated.length === 0);

    ready = true;
    await wait(200); // the readiness poll
    check(
      'once the navigator is ready the queued tap goes through',
      navigated.length === 1 && JSON.stringify(navigated[0][1]) === JSON.stringify({ orderId: 'ord-early' }),
      navigated,
    );
  }

  // ---------- AuthContext integration ----------

  /** Renders AuthProvider and returns its context value holder. */
  async function mountAuth() {
    const held: { current: any } = { current: null };
    function Probe() {
      held.current = useAuth();
      return null;
    }
    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(AuthProvider, null, React.createElement(Probe)));
      await wait(5);
    });
    return held;
  }

  {
    reset();
    fcm.permission = AuthorizationStatus.AUTHORIZED;
    const held = await mountAuth();

    await TestRenderer.act(async () => {
      authStateListener!({ getIdToken: async () => 'id-token' });
      await wait(20);
    });

    check('signed in -> backend user resolved', held.current.user?.id === 'u1', held.current.user);
    check(
      'permission granted -> device token registered',
      registered.length === 1 && registered[0].token === 'fcm-token-abc',
      registered,
    );
    check(
      'granted -> token rotation watched too',
      fcm.onTokenRefreshHandlers.length === 1,
      fcm.onTokenRefreshHandlers.length,
    );
  }

  {
    reset();
    fcm.permission = AuthorizationStatus.DENIED;
    const held = await mountAuth();

    await TestRenderer.act(async () => {
      authStateListener!({ getIdToken: async () => 'id-token' });
      await wait(20);
    });

    check(
      'permission DENIED -> login still completes, user is set',
      held.current.user?.id === 'u1' && held.current.isLoading === false,
      { user: held.current.user, isLoading: held.current.isLoading },
    );
    check('DENIED -> nothing registered', registered.length === 0, registered);
    check('DENIED -> no token refresh watcher', fcm.onTokenRefreshHandlers.length === 0);
    check('permission was actually asked for', fcm.requestPermissionCalls === 1);
  }

  {
    reset();
    fcm.permission = AuthorizationStatus.AUTHORIZED;
    fcm.getTokenThrows = true;
    const held = await mountAuth();

    await TestRenderer.act(async () => {
      authStateListener!({ getIdToken: async () => 'id-token' });
      await wait(20);
    });

    check(
      'FCM failing outright still does not break login',
      held.current.user?.id === 'u1' && held.current.isLoading === false,
      { user: held.current.user, isLoading: held.current.isLoading },
    );
    check('failed token fetch registers nothing', registered.length === 0, registered);
  }

  // ---------- the confirmOtp / auth-listener race ----------

  {
    reset();
    isNewUser = true;
    // A genuinely new signup: nothing in the backend until verify() is told
    // the role, which is exactly the window the race falls into.
    backendUserExists = false;
    rolelessVerifyDelayMs = 40;
    const held = await mountAuth();
    await TestRenderer.act(async () => {
      authStateListener!(null);
      await wait(10);
    });

    const confirmation = await held.current.sendOtp('+919876543210');
    await TestRenderer.act(async () => {
      const pending = held.current.confirmOtp(confirmation, '123456');
      // Firebase fires the auth-state listener the moment confirm() succeeds.
      // Without the in-flight guard this second, role-less verify() would find
      // no backend row for a brand-new customer and sign them out mid-signup.
      authStateListener!({ phoneNumber: '+919876543210', getIdToken: async () => 'id-token' });
      await pending;
      // Long enough for the delayed role-less verify to land and do its damage.
      await wait(120);
    });

    check(
      'signup: the listener does not race a second role-less verify()',
      verifyRoles.length === 1 && verifyRoles[0] === 'CUSTOMER',
      verifyRoles,
    );
    check(
      '  ...so the new customer stays signed in',
      held.current.user?.id === 'u1',
      held.current.user,
    );
  }

  {
    reset();
    isNewUser = false;
    const held = await mountAuth();
    await TestRenderer.act(async () => {
      authStateListener!(null);
      await wait(10);
    });

    const confirmation = await held.current.sendOtp('+919876543210');
    await TestRenderer.act(async () => {
      await held.current.confirmOtp(confirmation, '123456');
      await wait(20);
    });

    check(
      'a returning account still sends NO role, keeping what the backend stored',
      verifyRoles.length === 1 && verifyRoles[0] === undefined,
      verifyRoles,
    );
  }

  {
    // The guard must not blunt the stale-UID rule: a restored session whose
    // backend row is gone still signs out, and is never re-created.
    reset();
    verifyThrows = true;
    const held = await mountAuth();
    await TestRenderer.act(async () => {
      authStateListener!({ phoneNumber: null, getIdToken: async () => 'id-token' });
      await wait(20);
    });

    check(
      'stale UID still signs out rather than self-healing',
      held.current.user === null && held.current.isLoading === false,
      { user: held.current.user, isLoading: held.current.isLoading },
    );
    check(
      '  ...and verify() was never retried with a role',
      verifyRoles.length === 1 && verifyRoles[0] === undefined,
      verifyRoles,
    );
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} notification behaviours verified`);
  console.log(
    '\nNOT covered here (needs a device + EAS dev build):\n' +
      '  - the real POST_NOTIFICATIONS prompt on Android 13+\n' +
      '  - a real FCM token being issued and accepted by the backend\n' +
      '  - a push actually arriving from the BullMQ worker\n' +
      '  - the OS drawing a notification while backgrounded, and the tap that follows',
  );
  process.exit(passed === results.length ? 0 : 1);
})();
