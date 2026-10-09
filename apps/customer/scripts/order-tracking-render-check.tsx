/**
 * Renders the real OrderTrackingScreen through react-test-renderer.
 *
 *   pnpm order-tracking-render-check
 *
 * socket.io-client is replaced with a fake socket, so the REAL src/lib/socket.ts
 * still runs — the handshake options and the order:join payload shape are
 * checked here, which is the part most likely to silently mismatch the backend.
 * What this cannot prove is on the last lines of this file.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: {
  order: any;
  /** When set, every getOrder AFTER the first returns this instead. */
  refetchOrder: any;
  fetchThrow: string | null;
  refetchThrow: string | null;
  cancelThrow: string | null;
  token: string | null;
} = {
  order: null,
  refetchOrder: null,
  fetchThrow: null,
  refetchThrow: null,
  cancelThrow: null,
  token: 'id-token-123',
};

/*
 * The cancel fallback waits 8s, which no test should actually sit through.
 * Timers scheduled at exactly that delay are held here instead of running, so a
 * test can assert one is armed, assert it has NOT fired, and then fire it
 * deliberately. Every other timer — the harness's own waits, the rider ticker —
 * passes straight through.
 */
const FALLBACK_DELAY = 8000;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let heldFallback: { fn: Function } | null = null;

(globalThis as any).setTimeout = (fn: Function, delay?: number, ...args: any[]) => {
  if (delay === FALLBACK_DELAY) {
    heldFallback = { fn };
    return { __heldFallback: true } as any;
  }
  return (realSetTimeout as any)(fn, delay, ...args);
};

(globalThis as any).clearTimeout = (handle: any) => {
  if (handle && handle.__heldFallback) {
    heldFallback = null;
    return;
  }
  return (realClearTimeout as any)(handle);
};

const host = (name: string) => {
  const C = ({ children }: any) => React.createElement(name, null, children);
  Object.defineProperty(C, 'name', { value: name });
  return C;
};

const rnStub: any = new Proxy(
  {
    StyleSheet: { create: (o: any) => o, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'android', select: (o: any) => o.android },
    ActivityIndicator: host('ActivityIndicator'),
    Modal: host('Modal'),
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

// ---------- fake socket.io-client ----------

class FakeSocket {
  handlers = new Map<string, Function[]>();
  emitted: Array<[string, unknown]> = [];
  disconnected = false;

  on(event: string, fn: Function) {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }
  emit(event: string, payload?: unknown) {
    this.emitted.push([event, payload]);
    return this;
  }
  disconnect() {
    this.disconnected = true;
    return this;
  }
  /** Drives an inbound server event, the way a real connection would. */
  fire(event: string, payload?: unknown) {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }
}

let lastIoCall: { url: string; opts: any } | null = null;
let lastSocket: FakeSocket | null = null;

const socketIoStub = {
  io: (url: string, opts: any) => {
    lastIoCall = { url, opts };
    lastSocket = new FakeSocket();
    return lastSocket;
  },
};

class StubApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public override cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetworkError() {
    return this.status === 0;
  }
}

let cancelCalls = 0;
let getOrderCalls = 0;
const apiClientStub = {
  ApiError: StubApiError,
  getOrder: async () => {
    getOrderCalls += 1;
    if (getOrderCalls > 1) {
      if (control.refetchThrow === 'server') throw new StubApiError(500, 'Order lookup exploded');
      if (control.refetchOrder) return control.refetchOrder;
    }
    if (control.fetchThrow === 'hang') return new Promise(() => {});
    if (control.fetchThrow === 'server') throw new StubApiError(404, 'Order not found');
    return control.order;
  },
  cancelOrder: async () => {
    cancelCalls += 1;
    if (control.cancelThrow === 'conflict') {
      throw new StubApiError(409, 'Order can no longer be cancelled');
    }
    return { ...control.order, status: 'CANCELLED' };
  },
};

const themeStub = {
  useTheme: () => ({
    colors: {
      background: '#FDFDFC', card: '#ECF3E1', primaryGreen: '#396C11', button: '#2F7D18',
      buttonText: '#FFFFFF', text: '#10200F', textSecondary: '#555555', border: '#E5E5E5',
      success: '#4BAE20', offerBackground: '#E8F5D8',
    },
    brand: { yellow: '#F9C900', blue: '#123D91', green: '#73A624' },
    mode: 'light', resolvedMode: 'light', setMode: () => {},
  }),
};

const stubs: Record<string, any> = {
  'react-native': rnStub,
  'socket.io-client': socketIoStub,
  '@easzygoo/api-client': apiClientStub,
  // Requested as './api' from lib/socket.ts and '../lib/api' from the screen.
  './api': { apiBaseUrl: 'http://test.local:4000', api: {} },
  '../lib/api': { apiBaseUrl: 'http://test.local:4000', api: {} },
  '../context/AuthContext': { useAuth: () => ({ getIdToken: async () => control.token }) },
  '../theme/ThemeContext': themeStub,
  '../components/ScreenHeader': { __esModule: true, default: host('ScreenHeader') },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const OrderTrackingScreen = require('../src/screens/OrderTrackingScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

const navigated: Array<[string, unknown]> = [];
const resets: unknown[] = [];
const parentNavigated: string[] = [];
const navigation = {
  navigate: (name: string, params?: unknown) => navigated.push([name, params]),
  reset: (state: unknown) => resets.push(state),
  getParent: () => ({ navigate: (name: string) => parentNavigated.push(name) }),
};

function order(status: string, over: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    customerId: 'u1',
    vendorId: 'v1',
    riderId: null,
    addressId: 'a1',
    status,
    subtotal: '120',
    deliveryFee: '25',
    discount: '0',
    total: '145',
    couponCode: null,
    placedAt: '2026-09-03T10:00:00.000Z',
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    items: [
      {
        id: 'oi1',
        orderId: 'ord-1',
        productId: 'p1',
        quantity: 4,
        unitPrice: '25.50',
        lineTotal: '102',
        product: { id: 'p1', name: 'Tomato' },
      },
      {
        id: 'oi2',
        orderId: 'ord-1',
        productId: 'p2',
        quantity: 1,
        unitPrice: '18',
        lineTotal: '18',
        product: { id: 'p2', name: 'Onion' },
      },
    ],
    ...over,
  };
}

async function mount() {
  navigated.length = 0;
  resets.length = 0;
  parentNavigated.length = 0;
  cancelCalls = 0;
  getOrderCalls = 0;
  heldFallback = null;
  lastIoCall = null;
  lastSocket = null;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(OrderTrackingScreen, {
        navigation,
        route: { params: { orderId: 'ord-1' } },
      }),
    );
    await wait(25);
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
    await wait(15);
  });
}

/** Delivers a server event through the fake socket, inside act(). */
async function serverSends(event: string, payload: unknown) {
  await TestRenderer.act(async () => {
    lastSocket!.fire(event, payload);
    await wait(5);
  });
}

/** Runs the held 8s callback, as if the wait had elapsed with no socket event. */
async function elapseFallback() {
  if (!heldFallback) throw new Error('no fallback timer is armed');
  const held = heldFallback;
  await TestRenderer.act(async () => {
    held.fn();
    await wait(15);
  });
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

/** The mark rendered beside a step: ✓ done, ● current, ○ future. */
function markFor(tree: any, step: string): string {
  const [label] = find(tree, `step-${step}`);
  if (!label) return '';
  const row = label.parent;
  return texts(row.children).find((t) => ['✓', '●', '○'].includes(t)) ?? '';
}

(async () => {
  // 1. loading
  {
    control.fetchThrow = 'hang';
    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(OrderTrackingScreen, {
          navigation,
          route: { params: { orderId: 'ord-1' } },
        }),
      );
    });
    check(
      'loading -> ActivityIndicator',
      JSON.stringify(tree.toJSON()).includes('"type":"ActivityIndicator"'),
    );
  }

  // 2. fetch error
  {
    control.fetchThrow = 'server';
    const tree = await mount();
    checkText(tree, 'fetch fails -> toUserMessage + Retry + Back to Home', [
      'Could not load this order',
      'Order not found',
      'Retry',
      'Back to Home',
    ]);
  }

  // 3. PLACED
  {
    control.fetchThrow = null;
    control.order = order('PLACED');
    const tree = await mount();

    checkText(
      tree,
      'PLACED -> full timeline, summary from the fetched order',
      [
        'Order placed',
        'Accepted by the store',
        'Being prepared',
        'Ready for pickup',
        'Out for delivery',
        'Delivered',
        'Tomato × 4',
        'Onion × 1',
        'Total',
        '₹145',
        'Order ord-1',
      ],
      ['This order was cancelled', 'Rider location updated'],
    );
    check(
      'total is the backend figure, not subtotal recomputed',
      texts(tree.toJSON()).includes('₹145') && !texts(tree.toJSON()).includes('₹120'),
      texts(tree.toJSON()),
    );
    check(
      'PLACED -> current step marked ●, later steps ○',
      markFor(tree, 'PLACED') === '●' &&
        markFor(tree, 'ACCEPTED') === '○' &&
        markFor(tree, 'DELIVERED') === '○',
      {
        placed: markFor(tree, 'PLACED'),
        accepted: markFor(tree, 'ACCEPTED'),
      },
    );
      check('PLACED -> Cancel order offered', find(tree, 'cancel-order').length > 0);
  }

  // 4. socket wiring — the real src/lib/socket.ts ran to produce this
  {
    control.order = order('PLACED');
    const tree = await mount();

    check(
      'io() called with the api host and the ID token in the handshake',
      lastIoCall !== null &&
        lastIoCall.url === 'http://test.local:4000' &&
        lastIoCall.opts.auth.token === 'id-token-123',
      lastIoCall,
    );

    // The backend rejects anything that is not a bare string here.
    await serverSends('connect', undefined);
    check(
      'on connect -> emits order:join with the bare orderId string, not an object',
      lastSocket!.emitted.length === 1 &&
        lastSocket!.emitted[0][0] === 'order:join' &&
        lastSocket!.emitted[0][1] === 'ord-1',
      lastSocket!.emitted,
    );

    // 5. live status
    await serverSends('order:status', {
      orderId: 'ord-1',
      status: 'PREPARING',
      updatedAt: new Date().toISOString(),
    });
    check(
      'order:status -> timeline advances, earlier steps become ✓',
      markFor(tree, 'PLACED') === '✓' &&
        markFor(tree, 'ACCEPTED') === '✓' &&
        markFor(tree, 'PREPARING') === '●' &&
        markFor(tree, 'DELIVERED') === '○',
      {
        placed: markFor(tree, 'PLACED'),
        preparing: markFor(tree, 'PREPARING'),
      },
    );
    check(
      'no longer PLACED -> Cancel order withdrawn',
      find(tree, 'cancel-order').length === 0,
    );

    // An event for a different order must not move this screen.
    await serverSends('order:status', { orderId: 'other', status: 'DELIVERED' });
    check(
      'order:status for another order is ignored',
      markFor(tree, 'PREPARING') === '●',
      markFor(tree, 'PREPARING'),
    );

    // 6. rider location
    check('no rider line before any location event', find(tree, 'rider-location').length === 0);
    await serverSends('rider:location', {
      lat: 19.07,
      lng: 72.87,
      updatedAt: new Date().toISOString(),
    });
    checkText(tree, 'rider:location -> freshness line appears', ['Rider location updated']);

    // 7. unmount disconnects
    const socket = lastSocket!;
    await TestRenderer.act(async () => {
      tree.unmount();
    });
    check('unmount -> socket disconnected', socket.disconnected === true);
  }

  // 8. cancel flow
  {
    control.order = order('PLACED');
    control.cancelThrow = null;
    const tree = await mount();

    await press(tree, 'cancel-order');
    checkText(tree, 'Cancel order -> ConfirmDialog first', [
      'Cancel this order?',
      'The store will be told to stop preparing it. This cannot be undone.',
      'Keep it',
    ]);

    await press(tree, 'cancel-dismiss');
    check(
      'dismiss -> nothing cancelled, dialog gone',
      cancelCalls === 0 && find(tree, 'cancel-confirm').length === 0,
      cancelCalls,
    );

    await press(tree, 'cancel-order');
    await press(tree, 'cancel-confirm');
    check('confirm -> cancelOrder called once', cancelCalls === 1, cancelCalls);
    check(
      'cancel success does NOT set the status locally — the timeline still shows PLACED',
      markFor(tree, 'PLACED') === '●' && find(tree, 'cancelled-banner').length === 0,
      { placed: markFor(tree, 'PLACED'), banner: find(tree, 'cancelled-banner').length },
    );
    checkText(tree, 'pending cancellation is shown rather than a dead button', [
      'Cancellation requested',
    ]);

    check(
      'a fallback is armed at 8s and has NOT fetched anything yet',
      heldFallback !== null && getOrderCalls === 1,
      { armed: heldFallback !== null, getOrderCalls },
    );

    // Only the server's own event flips the UI.
    await serverSends('order:status', { orderId: 'ord-1', status: 'CANCELLED' });
    check(
      "the socket's CANCELLED drives the banner, replacing the timeline",
      find(tree, 'cancelled-banner').length === 1 && find(tree, 'timeline').length === 0,
      {
        banner: find(tree, 'cancelled-banner').length,
        timeline: find(tree, 'timeline').length,
      },
    );
    check(
      'socket event before 8s disarms the fallback — no second fetch, ever',
      heldFallback === null && getOrderCalls === 1,
      { armed: heldFallback !== null, getOrderCalls },
    );
  }

  // 8b. the socket never delivers -> the 8s fallback re-reads the order
  {
    control.order = order('PLACED');
    control.refetchOrder = order('CANCELLED');
    control.cancelThrow = null;
    const tree = await mount();

    await press(tree, 'cancel-order');
    await press(tree, 'cancel-confirm');
    check(
      'right after cancelling: waiting shown, fallback armed, no refetch yet',
      getOrderCalls === 1 &&
        heldFallback !== null &&
        texts(tree.toJSON()).some((t) => t.includes('Cancellation requested')),
      { getOrderCalls, armed: heldFallback !== null },
    );

    await elapseFallback();
    check('8s of silence -> exactly one fallback getOrder', getOrderCalls === 2, getOrderCalls);
    check(
      'fallback says CANCELLED -> banner, waiting line gone',
      find(tree, 'cancelled-banner').length === 1 &&
        find(tree, 'timeline').length === 0 &&
        find(tree, 'cancel-pending').length === 0,
      {
        banner: find(tree, 'cancelled-banner').length,
        pending: find(tree, 'cancel-pending').length,
      },
    );
  }

  // 8c. the vendor moved it on first — show what is true, not "waiting"
  {
    control.order = order('PLACED');
    control.refetchOrder = order('PREPARING');
    const tree = await mount();

    await press(tree, 'cancel-order');
    await press(tree, 'cancel-confirm');
    await elapseFallback();

    check(
      'fallback returns PREPARING -> timeline shows it, no cancelled banner',
      markFor(tree, 'PREPARING') === '●' &&
        markFor(tree, 'PLACED') === '✓' &&
        find(tree, 'cancelled-banner').length === 0,
      { preparing: markFor(tree, 'PREPARING'), placed: markFor(tree, 'PLACED') },
    );
    check(
      'stops claiming to be waiting once the real status is known',
      find(tree, 'cancel-pending').length === 0,
      find(tree, 'cancel-pending').length,
    );
  }

  // 8d. the fallback fetch itself failing must not invent an outcome
  {
    control.order = order('PLACED');
    control.refetchOrder = null;
    control.refetchThrow = 'server';
    const tree = await mount();

    await press(tree, 'cancel-order');
    await press(tree, 'cancel-confirm');
    await elapseFallback();

    checkText(tree, 'fallback fetch fails -> error shown, still waiting', [
      'Order lookup exploded',
      'Cancellation requested',
    ]);
    check(
      'failed fallback leaves the status untouched',
      markFor(tree, 'PLACED') === '●',
      markFor(tree, 'PLACED'),
    );
    control.refetchThrow = null;
  }

  // 8e. leaving the screen disarms the pending fallback
  {
    control.order = order('PLACED');
    control.refetchOrder = order('CANCELLED');
    const tree = await mount();

    await press(tree, 'cancel-order');
    await press(tree, 'cancel-confirm');
    check('fallback armed before unmount', heldFallback !== null);

    await TestRenderer.act(async () => {
      tree.unmount();
    });
    check(
      'unmount -> fallback cleared, so nothing fetches into a dead screen',
      heldFallback === null && getOrderCalls === 1,
      { armed: heldFallback !== null, getOrderCalls },
    );
    control.refetchOrder = null;
  }

  // 9. cancel rejected
  {
    control.order = order('PLACED');
    control.cancelThrow = 'conflict';
    const tree = await mount();
    await press(tree, 'cancel-order');
    await press(tree, 'cancel-confirm');
    checkText(tree, 'cancel rejected -> error shown, order untouched', [
      'Order can no longer be cancelled',
    ]);
    check(
      'rejected cancel leaves the timeline and the button alone',
      markFor(tree, 'PLACED') === '●' && find(tree, 'cancel-order').length > 0,
    );
  }

  // 10. an order that arrives already CANCELLED
  {
    control.cancelThrow = null;
    control.order = order('CANCELLED');
    const tree = await mount();
    checkText(
      tree,
      'CANCELLED on load -> banner instead of the timeline',
      ['This order was cancelled'],
      ['Out for delivery'],
    );
    check(
      'cancelled -> no timeline and no cancel button',
      find(tree, 'timeline').length === 0 && find(tree, 'cancel-order').length === 0,
    );
  }

  // 11. DELIVERED
  {
    control.order = order('DELIVERED');
    const tree = await mount();
    check(
      'DELIVERED -> every earlier step ✓, last one ●, no cancel',
      markFor(tree, 'PLACED') === '✓' &&
        markFor(tree, 'OUT_FOR_DELIVERY') === '✓' &&
        markFor(tree, 'DELIVERED') === '●' &&
        find(tree, 'cancel-order').length === 0,
      { delivered: markFor(tree, 'DELIVERED') },
    );
  }

  // 12. back to home
  {
    control.order = order('DELIVERED');
    const tree = await mount();
    await press(tree, 'back-home');
    // The screen sits on the root stack now, so home is a nested navigate
    // back into Main rather than a reset of a stack it no longer belongs to.
    check(
      'Back to Home -> navigate("Main", { screen: "Home" })',
      navigated.length === 1 &&
        navigated[0][0] === 'Main' &&
        JSON.stringify(navigated[0][1]) === JSON.stringify({ screen: 'Home' }),
      navigated,
    );
  }

  // 13. signed out / no token
  {
    control.token = null;
    control.order = order('PLACED');
    const tree = await mount();
    check(
      'no ID token -> no socket opened, screen still renders from the fetch',
      lastIoCall === null && find(tree, 'timeline').length === 1,
      { io: lastIoCall, timeline: find(tree, 'timeline').length },
    );
    control.token = 'id-token-123';
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} order tracking states verified`);
  console.log(
    '\nNOT covered here (needs a device + running backend):\n' +
      '  - a real websocket handshake being accepted by the backend io.use() guard\n' +
      '  - order:join actually joining the room, and the backend refusing an order\n' +
      '    the signed-in user is not a party to\n' +
      '  - order:status arriving from a real vendor/rider status change\n' +
      '  - rider:location arriving from a real rider app\n' +
      '  - reconnect behaviour after the connection drops',
  );
  process.exit(passed === results.length ? 0 : 1);
})();
