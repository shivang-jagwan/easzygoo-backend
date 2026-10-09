/**
 * Renders the real VendorStorefrontScreen in every state through
 * react-test-renderer.
 *
 *   pnpm storefront-render-check
 *
 * Same stubbing approach as scripts/render-check.tsx, with one difference: the
 * cart is NOT stubbed. The screen renders inside the real CartProvider (with
 * only AsyncStorage faked), so Add / stepper / vendor-conflict are checked
 * against the actual cart rules rather than a mock's idea of them.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: {
  products: any[];
  categories: any[];
  throwOn: string | null;
} = { products: [], categories: [], throwOn: null };

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

/** Cart persistence, in memory. Cleared between cases so each starts empty. */
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

/** Mirrors the real ApiError shape from packages/api-client. */
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

const apiClientStub = {
  ApiError: StubApiError,
  listCategories: async () => control.categories,
  listVendorProducts: async () => {
    if (control.throwOn === 'hang') return new Promise(() => {}); // never settles
    if (control.throwOn === 'network') throw new StubApiError(0, 'Network request failed');
    if (control.throwOn === 'server') throw new StubApiError(500, 'Storefront lookup exploded');
    return control.products;
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
const VendorStorefrontScreen = require('../src/screens/VendorStorefrontScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

/** Grabs the live cart handle so cases can seed and inspect it. */
let cart: any = null;
function CartProbe() {
  cart = useCart();
  return null;
}

const ROUTE = { params: { vendorId: 'v1', storeName: 'Shivang Fresh' } };

function element() {
  return React.createElement(
    CartProvider,
    null,
    React.createElement(CartProbe),
    React.createElement(VendorStorefrontScreen, { navigation: { navigate: () => {} }, route: ROUTE }),
  );
}

/** Mounts with an empty cart and lets the fetch effects settle. */
async function mount() {
  delete storage['easzygoo:cart'];
  cart = null;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element());
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

const results: boolean[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got: ${JSON.stringify(detail).slice(0, 240)}`);
  results.push(ok);
}

function checkText(tree: any, label: string, expected: string[], absent: string[] = []) {
  const found = texts(tree.toJSON());
  const ok =
    expected.every((e) => found.some((f) => f.includes(e))) &&
    absent.every((a) => !found.some((f) => f.includes(a)));
  check(label, ok, found);
  if (ok) console.log(`        ${JSON.stringify(found).slice(0, 170)}`);
}

// ---------- fixtures ----------

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  vendorId: 'v1',
  categoryId: 'c1',
  name: 'Tomato',
  description: null,
  imageUrl: null,
  unit: 'KILOGRAM',
  unitValue: 1,
  price: '25.50',
  stockQty: 10,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const CATEGORIES = [
  { id: 'c1', name: 'Vegetables', imageUrl: null, sortOrder: 1 },
  { id: 'c2', name: 'Fruits', imageUrl: null, sortOrder: 2 },
];

const FULL_CATALOGUE = [
  product({ id: 'p2', name: 'Onion', price: '18', unit: 'GRAM', unitValue: 500 }),
  product({ id: 'p1', name: 'Tomato' }),
  product({ id: 'p3', name: 'Banana', categoryId: 'c2', price: '60', unit: 'PIECE', unitValue: 6 }),
];

(async () => {
  // 1. loading
  {
    control.throwOn = 'hang';
    control.products = [];
    control.categories = CATEGORIES;
    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(element());
    });
    const spinner = JSON.stringify(tree.toJSON()).includes('"type":"ActivityIndicator"');
    check('loading -> ActivityIndicator, store name already shown', spinner, tree.toJSON());
  }

  // 2. error
  {
    control.throwOn = 'server';
    const tree = await mount();
    checkText(tree, 'fetch fails -> toUserMessage copy + Retry', [
      'Could not load this store',
      'Storefront lookup exploded',
      'Retry',
    ]);
  }

  // 2b. network error goes through the same path with connection copy
  {
    control.throwOn = 'network';
    const tree = await mount();
    checkText(
      tree,
      'ApiError status 0 -> connection copy, not the raw message',
      ['Could not load this store', 'Check your connection and try again.'],
      ['Network request failed'],
    );
  }

  // 3. empty
  {
    control.throwOn = null;
    control.products = [];
    const tree = await mount();
    checkText(
      tree,
      'no products -> empty state',
      ['Shivang Fresh', 'This store hasn’t added any products yet.'],
      ['Add', 'Out of stock'],
    );
  }

  // 4. populated, grouped by category in sortOrder
  {
    control.products = FULL_CATALOGUE;
    const tree = await mount();
    checkText(tree, 'products -> category sections, units and prices', [
      'Shivang Fresh',
      'Vegetables',
      'Fruits',
      'Tomato',
      '1kg',
      '₹25.50',
      'Onion',
      '500g',
      '₹18',
      'Banana',
      '6 pieces',
      '₹60',
    ]);

    const found = texts(tree.toJSON());
    const order = ['Vegetables', 'Onion', 'Tomato', 'Fruits', 'Banana'].map((t) =>
      found.findIndex((f) => f.includes(t)),
    );
    const sorted = order.every((v, i) => i === 0 || (v > order[i - 1] && v !== -1));
    check('sections in sortOrder, products alphabetical inside them', sorted, { found, order });
  }

  // 5. out of stock and inactive rows
  {
    control.products = [
      product({ id: 'p1', name: 'Tomato' }),
      product({ id: 'p4', name: 'Sold Out Spinach', stockQty: 0 }),
      product({ id: 'p5', name: 'Withdrawn Kale', isActive: false }),
    ];
    const tree = await mount();
    checkText(tree, 'stockQty 0 / isActive false -> shown with Out of stock', [
      'Sold Out Spinach',
      'Withdrawn Kale',
      'Out of stock',
    ]);
    check(
      'no Add button on either sold-out row, only on the sellable one',
      find(tree, 'add-p4').length === 0 &&
        find(tree, 'add-p5').length === 0 &&
        find(tree, 'add-p1').length === 1,
      {
        p4: find(tree, 'add-p4').length,
        p5: find(tree, 'add-p5').length,
        p1: find(tree, 'add-p1').length,
      },
    );
  }

  // 6. add to cart, same vendor -> stepper
  {
    control.products = FULL_CATALOGUE;
    const tree = await mount();
    await press(tree, 'add-p1');
    const afterAdd = texts(tree.toJSON());
    check(
      'Add -> item in cart at this vendor, row swaps to a stepper',
      cart.vendorId === 'v1' &&
        cart.items.length === 1 &&
        cart.items[0].quantity === 1 &&
        find(tree, 'add-p1').length === 0 &&
        find(tree, 'inc-p1').length === 1 &&
        afterAdd.some((t) => t === '1'),
      { vendorId: cart.vendorId, items: cart.items },
    );

    await press(tree, 'inc-p1');
    check('stepper + -> quantity 2', cart.items[0].quantity === 2, cart.items);

    await press(tree, 'dec-p1');
    await press(tree, 'dec-p1');
    check(
      'stepper - to 0 -> row removed, cart empty, Add is back',
      cart.items.length === 0 && cart.vendorId === null && find(tree, 'add-p1').length === 1,
      { vendorId: cart.vendorId, items: cart.items },
    );
  }

  // 7. different-vendor conflict
  {
    control.products = FULL_CATALOGUE;
    const tree = await mount();

    // Seed a cart at another store, the way search would have.
    await TestRenderer.act(async () => {
      cart.addItem('v9', {
        id: 'x1',
        name: 'Spinach',
        price: '12',
        unit: 'BUNCH',
        unitValue: 1,
        vendor: { storeName: 'North Mart' },
      });
      await wait(10);
    });

    await press(tree, 'add-p1');
    checkText(tree, 'different vendor -> themed confirmation naming the other store', [
      'Start a new cart?',
      'Starting a new cart will remove items from North Mart. Continue?',
      'Cancel',
      'Continue',
    ]);

    await press(tree, 'switch-cancel');
    check(
      'cancel -> dialog closes, other cart untouched, nothing added',
      cart.vendorId === 'v9' &&
        cart.items.length === 1 &&
        find(tree, 'switch-confirm').length === 0 &&
        !texts(tree.toJSON()).some((t) => t.includes('Start a new cart?')),
      { vendorId: cart.vendorId, items: cart.items },
    );

    await press(tree, 'add-p1');
    await press(tree, 'switch-confirm');
    check(
      'confirm -> cart replaced with this vendor and this product only',
      cart.vendorId === 'v1' &&
        cart.items.length === 1 &&
        cart.items[0].productId === 'p1' &&
        find(tree, 'inc-p1').length === 1,
      { vendorId: cart.vendorId, items: cart.items },
    );
  }

  // 7b. unknown other-vendor name falls back to generic copy
  {
    control.products = FULL_CATALOGUE;
    const tree = await mount();
    await TestRenderer.act(async () => {
      // No vendor on the product, so the cart never learned a store name.
      cart.addItem('v9', { id: 'x1', name: 'Spinach', price: '12', unit: 'BUNCH', unitValue: 1 });
      await wait(10);
    });
    await press(tree, 'add-p1');
    checkText(tree, 'unknown other store -> "your other cart" fallback', [
      'Starting a new cart will remove items from your other cart. Continue?',
    ]);
  }

  // 8. invalid price -> inline row error, no dialog
  {
    control.products = [
      product({ id: 'p1', name: 'Tomato', price: 'not-a-number' }),
      product({ id: 'p2', name: 'Onion', price: '18' }),
    ];
    const tree = await mount();
    await press(tree, 'add-p1');
    const found = texts(tree.toJSON());
    check(
      'unparseable price -> inline row error, no dialog, nothing added',
      found.some((t) => t.includes('Unavailable right now')) &&
        !found.some((t) => t.includes('Start a new cart?')) &&
        cart.items.length === 0 &&
        cart.vendorId === null,
      { found, items: cart.items },
    );

    await press(tree, 'add-p2');
    check(
      'a good row still adds, and clears the other row’s error',
      cart.items.length === 1 &&
        cart.items[0].productId === 'p2' &&
        !texts(tree.toJSON()).some((t) => t.includes('Unavailable right now')),
      { items: cart.items, found: texts(tree.toJSON()) },
    );
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} storefront states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
