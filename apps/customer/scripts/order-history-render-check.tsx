/**
 * Renders the real OrderHistoryScreen through react-test-renderer.
 *
 *   pnpm order-history-render-check
 *
 * Same stubbing approach as scripts/render-check.tsx. lib/orderStatus and
 * lib/format are NOT stubbed, so the badge wording, badge colour and date
 * formatting are the real ones.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: { orders: any[]; throwOn: string | null } = { orders: [], throwOn: null };

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
    RefreshControl: host('RefreshControl'),
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

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

let myOrdersCalls = 0;
const apiClientStub = {
  ApiError: StubApiError,
  myOrders: async () => {
    myOrdersCalls += 1;
    if (control.throwOn === 'hang') return new Promise(() => {});
    if (control.throwOn === 'network') throw new StubApiError(0, 'Network request failed');
    if (control.throwOn === 'server') throw new StubApiError(500, 'History lookup exploded');
    return control.orders;
  },
};

const COLORS = {
  background: '#FDFDFC', card: '#ECF3E1', primaryGreen: '#396C11', button: '#2F7D18',
  buttonText: '#FFFFFF', text: '#10200F', textSecondary: '#555555', border: '#E5E5E5',
  success: '#4BAE20', offerBackground: '#E8F5D8',
};

const themeStub = {
  useTheme: () => ({
    colors: COLORS,
    brand: { yellow: '#F9C900', blue: '#123D91', green: '#73A624' },
    mode: 'light', resolvedMode: 'light', setMode: () => {},
  }),
};

const stubs: Record<string, any> = {
  'react-native': rnStub,
  '@easzygoo/api-client': apiClientStub,
  '../lib/api': { api: {} },
  '../theme/ThemeContext': themeStub,
  '../components/ScreenHeader': { __esModule: true, default: host('ScreenHeader') },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const OrderHistoryScreen = require('../src/screens/OrderHistoryScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

const parentNavigated: Array<[string, unknown]> = [];
const navigation = {
  navigate: () => {},
  getParent: () => ({
    navigate: (name: string, params?: unknown) => parentNavigated.push([name, params]),
  }),
};

async function mount() {
  parentNavigated.length = 0;
  myOrdersCalls = 0;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(OrderHistoryScreen, { navigation, route: { params: undefined } }),
    );
    await wait(20);
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

function textOf(tree: any, testID: string): string {
  const [node] = find(tree, testID);
  return node ? texts(node.children).join('') : '';
}

/** The stroke colour the badge for this order was actually given. */
function badgeColor(tree: any, orderId: string): string | undefined {
  const [node] = find(tree, `badge-${orderId}`);
  if (!node) return undefined;
  const style = node.props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  return flat?.borderColor;
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

function summary(id: string, status: string, over: Record<string, unknown> = {}) {
  return {
    id,
    vendorId: 'v1',
    vendorName: 'Shivang Fresh',
    status,
    total: '145',
    placedAt: '2026-09-03T10:00:00.000Z',
    itemCount: 3,
    ...over,
  };
}

(async () => {
  // 1. loading
  {
    control.throwOn = 'hang';
    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(OrderHistoryScreen, { navigation, route: {} }),
      );
    });
    check(
      'loading -> ActivityIndicator',
      JSON.stringify(tree.toJSON()).includes('"type":"ActivityIndicator"'),
    );
  }

  // 2. error
  {
    control.throwOn = 'server';
    const tree = await mount();
    checkText(tree, 'fetch fails -> toUserMessage copy + Retry', [
      'Could not load your orders',
      'History lookup exploded',
      'Retry',
    ]);

    control.throwOn = null;
    control.orders = [summary('o1', 'PLACED')];
    await press(tree, 'retry');
    checkText(tree, 'Retry -> the list loads', ['Shivang Fresh', 'Placed']);
  }

  // 2b. network error
  {
    control.throwOn = 'network';
    const tree = await mount();
    checkText(
      tree,
      'ApiError status 0 -> connection copy, not the raw message',
      ['Could not load your orders', 'Check your connection and try again.'],
      ['Network request failed'],
    );
  }

  // 3. empty
  {
    control.throwOn = null;
    control.orders = [];
    const tree = await mount();
    checkText(
      tree,
      'no orders -> empty state pointing at Home',
      ['No orders yet', 'Browse stores on Home to place your first one.'],
      ['Retry'],
    );
  }

  // 4. populated
  {
    control.orders = [
      summary('o1', 'OUT_FOR_DELIVERY', { vendorName: 'North Mart', total: '146.50' }),
      summary('o2', 'DELIVERED', { placedAt: '2026-08-21T09:30:00.000Z', itemCount: 1 }),
      summary('o3', 'CANCELLED', { vendorName: 'Green Basket', total: '80' }),
    ];
    const tree = await mount();

    checkText(tree, 'populated -> vendor names, dates, item counts, totals', [
      'North Mart',
      'On the way',
      '3 Sep 2026 · 3 items',
      '₹146.50',
      'Shivang Fresh',
      'Delivered',
      '21 Aug 2026 · 1 item',
      'Green Basket',
      'Cancelled',
      '₹80',
    ]);

    check(
      'itemCount 1 is singular, 3 is plural',
      texts(tree.toJSON()).some((t) => t.includes('1 item') && !t.includes('1 items')),
      texts(tree.toJSON()),
    );
    check('total uses the backend figure', textOf(tree, 'total-o1') === '₹146.50', textOf(tree, 'total-o1'));

    // Badge colour comes from lib/orderStatus, shared with the tracking screen.
    check(
      'in-progress badge -> primaryGreen',
      badgeColor(tree, 'o1') === COLORS.primaryGreen,
      badgeColor(tree, 'o1'),
    );
    check(
      'DELIVERED badge -> success',
      badgeColor(tree, 'o2') === COLORS.success,
      badgeColor(tree, 'o2'),
    );
    check(
      'CANCELLED badge -> textSecondary, distinct from the other two',
      badgeColor(tree, 'o3') === COLORS.textSecondary &&
        badgeColor(tree, 'o3') !== badgeColor(tree, 'o1') &&
        badgeColor(tree, 'o3') !== badgeColor(tree, 'o2'),
      badgeColor(tree, 'o3'),
    );

    check(
      'order kept in backend order, not re-sorted',
      (() => {
        const found = texts(tree.toJSON());
        return (
          found.indexOf('North Mart') < found.indexOf('Shivang Fresh') &&
          found.indexOf('Shivang Fresh') < found.indexOf('Green Basket')
        );
      })(),
      texts(tree.toJSON()),
    );
  }

  // 5. every status renders a badge
  {
    const ALL = [
      ['PLACED', 'Placed'],
      ['ACCEPTED', 'Accepted'],
      ['PREPARING', 'Preparing'],
      ['READY_FOR_PICKUP', 'Ready'],
      ['OUT_FOR_DELIVERY', 'On the way'],
      ['DELIVERED', 'Delivered'],
      ['CANCELLED', 'Cancelled'],
    ];
    control.orders = ALL.map(([status], i) => summary(`s${i}`, status));
    const tree = await mount();
    const found = texts(tree.toJSON());
    check(
      'all seven statuses render their badge wording',
      ALL.every(([, label]) => found.includes(label)),
      found,
    );
  }

  // 6. tap to track
  {
    control.orders = [summary('o1', 'PLACED'), summary('o2', 'DELIVERED')];
    const tree = await mount();
    await press(tree, 'order-o2');
    check(
      'tapping a card -> parent navigate("OrderTracking", { orderId }) with that card id',
      parentNavigated.length === 1 &&
        parentNavigated[0][0] === 'OrderTracking' &&
        JSON.stringify(parentNavigated[0][1]) === JSON.stringify({ orderId: 'o2' }),
      parentNavigated,
    );
  }

  // 7. pull to refresh
  {
    control.orders = [summary('o1', 'PLACED')];
    const tree = await mount();
    check('one fetch on mount', myOrdersCalls === 1, myOrdersCalls);

    control.orders = [summary('o1', 'DELIVERED')];
    // RefreshControl is a ScrollView *prop*, not a child, so it never lands in
    // the rendered tree — reach its onRefresh through the ScrollView instead.
    const [scroll] = tree.root.findAllByType(rnStub.ScrollView);
    await TestRenderer.act(async () => {
      scroll.props.refreshControl.props.onRefresh();
      await wait(15);
    });
    check('pull-to-refresh -> refetches', myOrdersCalls === 2, myOrdersCalls);
    checkText(tree, 'refresh shows the updated status', ['Delivered'], ['Placed']);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} order history states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
