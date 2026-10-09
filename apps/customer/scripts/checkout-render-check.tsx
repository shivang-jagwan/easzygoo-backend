/**
 * Renders the real CheckoutScreen through react-test-renderer.
 *
 *   pnpm checkout-render-check
 *
 * The cart is NOT stubbed — the screen runs inside the real CartProvider (only
 * AsyncStorage faked), so "order placed clears the cart" is checked against the
 * actual cart, not a mock.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: {
  addresses: any[];
  addressThrow: string | null;
  /** null = success, otherwise the failure shape to throw from createOrder. */
  orderFailure: 'stock' | 'stock-race' | 'coupon-409' | 'coupon-400' | 'server' | 'network' | null;
} = { addresses: [], addressThrow: null, orderFailure: null };

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
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

const storage: Record<string, string> = {};
const asyncStorageStub = {
  __esModule: true,
  default: {
    getItem: async (k: string) => (k in storage ? storage[k] : null),
    setItem: async (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: async (k: string) => {
      delete storage[k];
    },
  },
};

/** Mirrors the real ApiError, including cause carrying the parsed payload. */
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

let orderRequest: any = null;

/** The exact payloads apps/backend/src/routes/orders.ts sends. */
function orderError(kind: string): StubApiError {
  switch (kind) {
    case 'stock': {
      const payload = {
        error: 'insufficient stock',
        products: [
          {
            productId: 'p1',
            name: 'Tomato',
            reason: 'insufficient stock',
            requested: 4,
            available: 1,
          },
          { productId: 'p2', name: 'Onion', reason: 'inactive' },
        ],
      };
      return new StubApiError(409, payload.error, payload);
    }
    case 'stock-race': {
      const payload = {
        error: 'insufficient stock',
        products: [
          {
            productId: 'p1',
            name: 'Tomato',
            reason: 'stock changed while the order was being placed',
          },
        ],
      };
      return new StubApiError(409, payload.error, payload);
    }
    case 'coupon-409':
      return new StubApiError(409, 'coupon usage limit reached', {
        error: 'coupon usage limit reached',
      });
    case 'coupon-400':
      return new StubApiError(400, 'coupon has expired', { error: 'coupon has expired' });
    case 'server':
      return new StubApiError(500, 'Order service exploded', { error: 'Order service exploded' });
    default:
      return new StubApiError(0, 'Network request failed');
  }
}

const apiClientStub = {
  ApiError: StubApiError,
  myAddresses: async () => {
    if (control.addressThrow === 'server') throw new StubApiError(500, 'Address lookup exploded');
    return control.addresses;
  },
  createOrder: async (_client: unknown, body: any) => {
    orderRequest = body;
    if (control.orderFailure) throw orderError(control.orderFailure);
    return { id: 'ord-1', total: '146.50', status: 'PLACED', items: [] };
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
  '@react-native-async-storage/async-storage': asyncStorageStub,
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
const { CartProvider, useCart } = require('../src/context/CartContext');
const CheckoutScreen = require('../src/screens/CheckoutScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

let cart: any = null;
function CartProbe() {
  cart = useCart();
  return null;
}

const navigated: Array<[string, unknown]> = [];
/** Pushes onto the ROOT stack, where OrderTracking now lives. */
const parentNavigated: Array<[string, unknown]> = [];
const resets: unknown[] = [];
const navigation = {
  navigate: (name: string, params?: unknown) => navigated.push([name, params]),
  reset: (state: unknown) => resets.push(state),
  getParent: () => ({
    navigate: (name: string, params?: unknown) => parentNavigated.push([name, params]),
  }),
};

const ADDRESS = {
  id: 'a1',
  userId: 'u1',
  label: 'Home',
  line1: '12 Rose Villa',
  line2: 'Near the water tank',
  city: 'Mumbai',
  pincode: '400001',
  latitude: 19.076,
  longitude: 72.8777,
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const TOMATO = {
  id: 'p1',
  name: 'Tomato',
  price: '25.50',
  unit: 'KILOGRAM',
  unitValue: 1,
  vendor: { storeName: 'Shivang Fresh' },
};
const ONION = { id: 'p2', name: 'Onion', price: '18', unit: 'GRAM', unitValue: 500 };

function element(selectedAddressId?: string) {
  return React.createElement(
    CartProvider,
    null,
    React.createElement(CartProbe),
    React.createElement(CheckoutScreen, {
      navigation,
      route: { params: selectedAddressId ? { selectedAddressId } : undefined },
    }),
  );
}

/** Mounts with an empty cart; pass an id to arrive with an address selected. */
async function mount(selectedAddressId?: string) {
  delete storage['easzygoo:cart'];
  cart = null;
  navigated.length = 0;
  parentNavigated.length = 0;
  resets.length = 0;
  orderRequest = null;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element(selectedAddressId));
    await wait(20);
  });
  return tree;
}

async function seedCart() {
  await TestRenderer.act(async () => {
    cart.addItem('v1', TOMATO, 4);
    await wait(5);
  });
  await TestRenderer.act(async () => {
    cart.addItem('v1', ONION, 1);
    await wait(5);
  });
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

async function type(tree: any, testID: string, value: string) {
  const [node] = find(tree, testID);
  if (!node) throw new Error(`no input with testID ${testID}`);
  await TestRenderer.act(async () => {
    node.props.onChangeText(value);
  });
}

/** Rendered text of the one node carrying this testID. */
function textOf(tree: any, testID: string): string {
  const [node] = find(tree, testID);
  return node ? texts(node.children).join('') : '';
}

const results: boolean[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got: ${JSON.stringify(detail).slice(0, 300)}`);
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
  control.addresses = [ADDRESS];

  // 1. no address selected
  {
    const tree = await mount();
    await seedCart();
    checkText(
      tree,
      'no selectedAddressId -> prompt to choose an address',
      ['Select a delivery address', 'Choose address'],
      ['12 Rose Villa', 'Change'],
    );
    check(
      'no address -> Place Order disabled even with a full cart',
      find(tree, 'place-order')[0].props.disabled === true,
      find(tree, 'place-order')[0].props.disabled,
    );
    await press(tree, 'select-address');
    // AddressList moved to the root stack, so it opens through the parent, and
    // 'select' is what makes a tap come back here with the choice.
    check(
      'Choose address -> parent navigate("AddressList", { mode: "select" })',
      parentNavigated.length === 1 &&
        parentNavigated[0][0] === 'AddressList' &&
        JSON.stringify(parentNavigated[0][1]) === JSON.stringify({ mode: 'select' }),
      parentNavigated,
    );
  }

  // 2. address selected, cart populated
  {
    const tree = await mount('a1');
    await seedCart();
    checkText(tree, 'address selected -> resolved address, summary, subtotal', [
      'Home',
      '12 Rose Villa',
      'Near the water tank',
      'Mumbai 400001',
      'Change',
      'Shivang Fresh',
      'Tomato × 4',
      'Onion × 1',
      'Subtotal',
      'Place Order',
    ]);
    check(
      'subtotal 25.50x4 + 18 = ₹120, line totals ₹102 / ₹18',
      texts(tree.toJSON()).includes('₹120') &&
        textOf(tree, 'line-total-p1') === '₹102',
      texts(tree.toJSON()),
    );
    check(
      'cart + address -> Place Order enabled',
      find(tree, 'place-order')[0].props.disabled === false,
    );
    check(
      'summary is read-only: no steppers on this screen',
      find(tree, 'inc-p1').length === 0 && find(tree, 'dec-p1').length === 0,
    );

    await press(tree, 'change-address');
    check(
      'Change -> parent navigate("AddressList", { mode: "select" })',
      parentNavigated.length === 1 &&
        parentNavigated[0][0] === 'AddressList' &&
        JSON.stringify(parentNavigated[0][1]) === JSON.stringify({ mode: 'select' }),
      parentNavigated,
    );
  }

  // 2b. empty cart with an address still cannot order
  {
    const tree = await mount('a1');
    check(
      'empty cart -> Place Order disabled',
      find(tree, 'place-order')[0].props.disabled === true,
    );
  }

  // 3. successful placement
  {
    control.orderFailure = null;
    const tree = await mount('a1');
    await seedCart();
    await type(tree, 'coupon-input', ' save10 ');
    await press(tree, 'apply-coupon');
    checkText(tree, 'Apply -> coupon held, no discount preview', [
      'save10 will be applied when you place the order.',
    ]);

    await press(tree, 'place-order');
    check(
      'createOrder called with vendorId, addressId, items and trimmed coupon',
      orderRequest &&
        orderRequest.vendorId === 'v1' &&
        orderRequest.addressId === 'a1' &&
        orderRequest.couponCode === 'save10' &&
        JSON.stringify(orderRequest.items) ===
          JSON.stringify([
            { productId: 'p1', quantity: 4 },
            { productId: 'p2', quantity: 1 },
          ]),
      orderRequest,
    );
    check('success -> cart cleared', cart.items.length === 0 && cart.vendorId === null, cart.items);
  check(
      'success -> parent navigate("OrderTracking", { orderId }) at the root',
      parentNavigated.length === 1 &&
        parentNavigated[0][0] === 'OrderTracking' &&
        JSON.stringify(parentNavigated[0][1]) === JSON.stringify({ orderId: 'ord-1' }),
      parentNavigated,
    );
    check(
      'success -> the checkout flow is reset out from under it',
      JSON.stringify(resets) === JSON.stringify([{ index: 0, routes: [{ name: 'CartHome' }] }]),
      resets,
    );
  }

  // 3b. no coupon -> couponCode omitted, not ""
  {
    const tree = await mount('a1');
    await seedCart();
    await press(tree, 'place-order');
    check(
      'no coupon -> couponCode undefined, not an empty string',
      orderRequest.couponCode === undefined,
      orderRequest,
    );
  }

  // 4. insufficient stock 409
  {
    control.orderFailure = 'stock';
    const tree = await mount('a1');
    await seedCart();
    await press(tree, 'place-order');

    checkText(
      tree,
      'stock 409 -> per-product list with requested/available, not a generic string',
      [
        'Some items are no longer available',
        'Tomato — only 1 left, you asked for 4',
        'Onion — no longer sold here',
        'Review cart',
      ],
      ['Something went wrong'],
    );
    check(
      'stock failure renders in its own block, not the banner or the coupon slot',
      find(tree, 'stock-issues').length === 1 &&
        find(tree, 'error-banner').length === 0 &&
        find(tree, 'coupon-error').length === 0,
      {
        stock: find(tree, 'stock-issues').length,
        banner: find(tree, 'error-banner').length,
        coupon: find(tree, 'coupon-error').length,
      },
    );
    check('failed placement leaves the cart alone', cart.items.length === 2, cart.items);
    check('failed placement does not navigate', navigated.length === 0, navigated);

    await press(tree, 'review-cart');
    check(
      'Review cart -> navigate("CartHome")',
      navigated.length === 1 && navigated[0][0] === 'CartHome',
      navigated,
    );
  }

  // 4b. the mid-transaction race, which carries no requested/available
  {
    control.orderFailure = 'stock-race';
    const tree = await mount('a1');
    await seedCart();
    await press(tree, 'place-order');
    checkText(tree, 'stock race 409 -> reason shown without invented numbers', [
      'Tomato — stock changed while the order was being placed',
    ]);
  }

  // 5. coupon errors land inline
  {
    control.orderFailure = 'coupon-409';
    const tree = await mount('a1');
    await seedCart();
    await type(tree, 'coupon-input', 'SAVE10');
    await press(tree, 'apply-coupon');
    await press(tree, 'place-order');

    check(
      'coupon 409 -> inline beside the coupon field, no banner, no stock block',
      find(tree, 'coupon-error').length === 1 &&
        find(tree, 'error-banner').length === 0 &&
        find(tree, 'stock-issues').length === 0 &&
        textOf(tree, 'coupon-error') === 'coupon usage limit reached',
      {
        coupon: find(tree, 'coupon-error').length,
        banner: find(tree, 'error-banner').length,
        text: textOf(tree, 'coupon-error'),
      },
    );

    // A 400 coupon rejection lands in the same place.
    control.orderFailure = 'coupon-400';
    await press(tree, 'place-order');
    check(
      'coupon 400 -> also inline',
      find(tree, 'coupon-error').length === 1 &&
        textOf(tree, 'coupon-error') === 'coupon has expired',
      texts(tree.toJSON()),
    );
  }

  // 5b. a coupon-shaped message with no coupon applied is not the field's problem
  {
    control.orderFailure = 'coupon-409';
    const tree = await mount('a1');
    await seedCart();
    await press(tree, 'place-order');
    check(
      'coupon message with no coupon entered -> banner, not the inline slot',
      find(tree, 'error-banner').length === 1 && find(tree, 'coupon-error').length === 0,
      {
        banner: find(tree, 'error-banner').length,
        coupon: find(tree, 'coupon-error').length,
      },
    );
  }

  // 6. generic failures
  {
    control.orderFailure = 'server';
    const tree = await mount('a1');
    await seedCart();
    await press(tree, 'place-order');
    checkText(
      tree,
      '500 -> toUserMessage banner',
      ['Order service exploded'],
      ['Some items are no longer available'],
    );
    check(
      'generic failure uses the banner only',
      find(tree, 'error-banner').length === 1 &&
        find(tree, 'stock-issues').length === 0 &&
        find(tree, 'coupon-error').length === 0,
    );

    control.orderFailure = 'network';
    await press(tree, 'place-order');
    checkText(
      tree,
      'network failure -> connection copy, not the raw message',
      ['Check your connection and try again.'],
      ['Network request failed'],
    );
  }

  // 6b. the address fetch failing is its own retryable state
  {
    control.orderFailure = null;
    control.addressThrow = 'server';
    const tree = await mount('a1');
    await seedCart();
    checkText(tree, 'address fetch fails -> retryable message in the address slot', [
      'Could not load your addresses',
      'Address lookup exploded',
      'Retry',
    ]);
    control.addressThrow = null;
    await press(tree, 'retry-addresses');
    checkText(tree, 'retry -> the address resolves', ['12 Rose Villa', 'Change']);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checkout states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
