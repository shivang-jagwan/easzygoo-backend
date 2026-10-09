/**
 * Renders the real CartScreen through react-test-renderer.
 *
 *   pnpm cart-render-check
 *
 * As with the storefront harness, the cart itself is NOT stubbed: the screen
 * runs inside the real CartProvider (only AsyncStorage faked), so stepper,
 * remove and clear are checked against the actual cart rules.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

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
  '../theme/ThemeContext': themeStub,
  '../components/ScreenHeader': { __esModule: true, default: host('ScreenHeader') },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const { CartProvider, useCart } = require('../src/context/CartContext');
const CartScreen = require('../src/screens/CartScreen').default;

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

const navigated: string[] = [];
const navigation = { navigate: (name: string) => navigated.push(name) };

function element() {
  return React.createElement(
    CartProvider,
    null,
    React.createElement(CartProbe),
    React.createElement(CartScreen, { navigation, route: { params: undefined } }),
  );
}

async function mount() {
  delete storage['easzygoo:cart'];
  cart = null;
  navigated.length = 0;
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

/** The rendered text of the one node carrying this testID. */
function textOf(tree: any, testID: string): string {
  const [node] = find(tree, testID);
  if (!node) return '';
  return texts(node.toJSON ? node.toJSON() : node.children).join('');
}

const results: boolean[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got: ${JSON.stringify(detail).slice(0, 260)}`);
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

const TOMATO = {
  id: 'p1',
  name: 'Tomato',
  price: '25.50',
  unit: 'KILOGRAM',
  unitValue: 1,
  vendor: { storeName: 'Shivang Fresh' },
};
const ONION = { id: 'p2', name: 'Onion', price: '18', unit: 'GRAM', unitValue: 500 };

async function seed(tree: any) {
  await TestRenderer.act(async () => {
    cart.addItem('v1', TOMATO, 2);
    await wait(5);
  });
  await TestRenderer.act(async () => {
    cart.addItem('v1', ONION, 3);
    await wait(5);
  });
}

(async () => {
  // 1. empty
  {
    const tree = await mount();
    checkText(
      tree,
      'empty cart -> themed empty state, no checkout button',
      ['Your cart is empty', 'Browse a store to add vegetables.'],
      ['Subtotal', 'Checkout', 'Clear cart'],
    );
    check('empty cart renders no Checkout control', find(tree, 'checkout').length === 0);
  }

  // 2. populated
  {
    const tree = await mount();
    await seed(tree);
    checkText(tree, 'populated -> vendor name, rows, units, line totals, subtotal', [
      'Shivang Fresh',
      'Tomato',
      '1kg',
      '₹25.50 each',
      'Onion',
      '500g',
      '₹18 each',
      'Subtotal',
      'Delivery fee is calculated at checkout.',
      'Checkout',
      'Clear cart',
    ]);

    check(
      'line totals: 25.50x2 = ₹51, 18x3 = ₹54',
      textOf(tree, 'line-total-p1') === '₹51' && textOf(tree, 'line-total-p2') === '₹54',
      { p1: textOf(tree, 'line-total-p1'), p2: textOf(tree, 'line-total-p2') },
    );
    check(
      'subtotal = 51 + 54 = ₹105, labelled Subtotal not Total',
      textOf(tree, 'subtotal') === '₹105' &&
        !texts(tree.toJSON()).some((t) => t.trim() === 'Total'),
      { subtotal: textOf(tree, 'subtotal'), found: texts(tree.toJSON()) },
    );
  }

  // 3. stepper
  {
    const tree = await mount();
    await seed(tree);

    await press(tree, 'inc-p1');
    check(
      'stepper + -> quantity 3, line total ₹76.50, subtotal ₹130.50',
      cart.items[0].quantity === 3 &&
        textOf(tree, 'line-total-p1') === '₹76.50' &&
        textOf(tree, 'subtotal') === '₹130.50',
      {
        qty: cart.items[0].quantity,
        line: textOf(tree, 'line-total-p1'),
        subtotal: textOf(tree, 'subtotal'),
      },
    );

    await press(tree, 'dec-p1');
    await press(tree, 'dec-p1');
    check(
      'stepper - -> quantity 1, subtotal back to ₹79.50',
      cart.items[0].quantity === 1 && textOf(tree, 'subtotal') === '₹79.50',
      { qty: cart.items[0].quantity, subtotal: textOf(tree, 'subtotal') },
    );

    await press(tree, 'dec-p1');
    check(
      'stepping to 0 -> row gone, only Onion left',
      cart.items.length === 1 &&
        cart.items[0].productId === 'p2' &&
        find(tree, 'line-total-p1').length === 0,
      cart.items,
    );
  }

  // 4. explicit remove
  {
    const tree = await mount();
    await seed(tree);

    await press(tree, 'remove-p2');
    check(
      'Remove -> that row goes, the other stays, subtotal recalculated to ₹51',
      cart.items.length === 1 &&
        cart.items[0].productId === 'p1' &&
        textOf(tree, 'subtotal') === '₹51',
      { items: cart.items, subtotal: textOf(tree, 'subtotal') },
    );

    await press(tree, 'remove-p1');
    checkText(
      tree,
      'removing the last row -> empty state, vendor cleared',
      ['Your cart is empty'],
      ['Subtotal', 'Checkout'],
    );
    check('cart vendor cleared with the last item', cart.vendorId === null, cart.vendorId);
  }

  // 5. clear cart confirmation
  {
    const tree = await mount();
    await seed(tree);

    await press(tree, 'clear-cart');
    checkText(tree, 'Clear cart -> themed confirmation dialog', [
      'Clear cart?',
      'Remove all items from your cart?',
      'Cancel',
      'Clear',
    ]);

    await press(tree, 'clear-cancel');
    check(
      'cancel -> dialog closes, items untouched',
      cart.items.length === 2 &&
        find(tree, 'clear-confirm').length === 0 &&
        !texts(tree.toJSON()).some((t) => t.includes('Remove all items from your cart?')),
      { items: cart.items },
    );

    await press(tree, 'clear-cart');
    await press(tree, 'clear-confirm');
    checkText(
      tree,
      'confirm -> cart emptied, back to the empty state',
      ['Your cart is empty'],
      ['Subtotal', 'Remove all items from your cart?'],
    );
    check('cart really empty after confirm', cart.items.length === 0 && cart.vendorId === null, {
      items: cart.items,
      vendorId: cart.vendorId,
    });
  }

  // 6. checkout route
  {
    const tree = await mount();
    await seed(tree);
    await press(tree, 'checkout');
    check('Checkout -> navigates to the Checkout route', navigated.join(',') === 'Checkout', navigated);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} cart screen states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
