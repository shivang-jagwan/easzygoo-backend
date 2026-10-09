/**
 * Renders the real AddressListScreen through react-test-renderer.
 *
 *   pnpm address-list-render-check
 *
 * Same stubbing approach as scripts/render-check.tsx.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: { addresses: any[]; throwOn: string | null; deleteThrows: boolean } = {
  addresses: [],
  throwOn: null,
  deleteThrows: false,
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

let deleted: string[] = [];
const apiClientStub = {
  ApiError: StubApiError,
  deleteAddress: async (_client: unknown, id: string) => {
    if (control.deleteThrows) throw new StubApiError(409, 'Address is used by existing orders');
    deleted.push(id);
    control.addresses = control.addresses.filter((a: any) => a.id !== id);
    return { id, deleted: true };
  },
  myAddresses: async () => {
    if (control.throwOn === 'hang') return new Promise(() => {});
    if (control.throwOn === 'network') throw new StubApiError(0, 'Network request failed');
    if (control.throwOn === 'server') throw new StubApiError(500, 'Address lookup exploded');
    return control.addresses;
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
const AddressListScreen = require('../src/screens/AddressListScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

const navigated: Array<[string, unknown]> = [];
/** The screen re-reads the list whenever it regains focus. */
let focusListener: (() => void) | null = null;
const navigation = {
  navigate: (name: string, params?: unknown) => navigated.push([name, params]),
  addListener: (event: string, fn: () => void) => {
    if (event === 'focus') focusListener = fn;
    return () => {
      focusListener = null;
    };
  },
};

/** Mounts in 'manage' unless a mode is given, matching the param default. */
async function mount(mode?: 'select' | 'manage') {
  navigated.length = 0;
  deleted = [];
  focusListener = null;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(AddressListScreen, {
        navigation,
        route: { params: mode ? { mode } : undefined },
      }),
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

const ADDRESSES = [
  {
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
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'a2',
    userId: 'u1',
    label: null,
    line1: '9 Sector 4',
    line2: null,
    city: 'Navi Mumbai',
    pincode: '400703',
    latitude: 19.03,
    longitude: 73.02,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

(async () => {
  // 1. loading
  {
    control.throwOn = 'hang';
    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(AddressListScreen, { navigation, route: {} }),
      );
    });
    check(
      'loading -> ActivityIndicator',
      JSON.stringify(tree.toJSON()).includes('"type":"ActivityIndicator"'),
      tree.toJSON(),
    );
  }

  // 2. error
  {
    control.throwOn = 'server';
    const tree = await mount();
    checkText(tree, 'fetch fails -> toUserMessage copy + Retry', [
      'Could not load your addresses',
      'Address lookup exploded',
      'Retry',
    ]);
  }

  // 2b. network error
  {
    control.throwOn = 'network';
    const tree = await mount();
    checkText(
      tree,
      'ApiError status 0 -> connection copy, not the raw message',
      ['Could not load your addresses', 'Check your connection and try again.'],
      ['Network request failed'],
    );
  }

  // 3. empty
  {
    control.throwOn = null;
    control.addresses = [];
    const tree = await mount();
    checkText(
      tree,
      'no addresses -> empty state, still offers Add new address',
      ['No saved addresses yet', 'Add new address'],
      ['Default'],
    );
  }

  // 4. populated
  {
    control.addresses = ADDRESSES;
    const tree = await mount();
    checkText(tree, 'populated -> label, lines, city+pincode, Default badge', [
      'Home',
      '12 Rose Villa',
      'Near the water tank',
      'Mumbai 400001',
      'Address', // a2 has no label
      '9 Sector 4',
      'Navi Mumbai 400703',
      'Default',
      'Add new address',
    ]);
    check(
      'only the default address carries the badge',
      texts(tree.toJSON()).filter((t) => t === 'Default').length === 1,
      texts(tree.toJSON()),
    );
    check(
      'the address with no line2 renders no blank line',
      !texts(tree.toJSON()).some((t) => t.trim() === ''),
      texts(tree.toJSON()),
    );
  }

  // 5. select mode: the card is the choice
  {
    control.addresses = ADDRESSES;
    const tree = await mount('select');
    check(
      'select mode -> no per-row Edit/Delete actions',
      find(tree, 'edit-a1').length === 0 && find(tree, 'delete-a1').length === 0,
      { edit: find(tree, 'edit-a1').length, del: find(tree, 'delete-a1').length },
    );
    checkText(tree, 'select mode titles the screen for the job', ['Delivery address'], [
      'Saved addresses',
    ]);

    await press(tree, 'address-a2');
    check(
      'select mode tap -> nested navigate back to Checkout with the id',
      navigated.length === 1 &&
        navigated[0][0] === 'Main' &&
        JSON.stringify(navigated[0][1]) ===
          JSON.stringify({
            screen: 'Cart',
            params: { screen: 'Checkout', params: { selectedAddressId: 'a2' } },
          }),
      navigated,
    );
  }

  // 5b. manage mode: per-row actions, no selection
  {
    control.addresses = ADDRESSES;
    const tree = await mount('manage');
    checkText(tree, 'manage mode -> Edit and Delete per row', ['Saved addresses', 'Edit', 'Delete'], [
      'Delivery address',
    ]);
    check(
      'manage mode -> the card itself is inert',
      find(tree, 'address-a1')[0].props.onPress === undefined,
      Object.keys(find(tree, 'address-a1')[0].props),
    );
    check(
      'every row gets its own actions',
      find(tree, 'edit-a1').length === 1 &&
        find(tree, 'delete-a1').length === 1 &&
        find(tree, 'edit-a2').length === 1,
    );

    await press(tree, 'edit-a2');
    check(
      'Edit -> AddAddress with editingAddressId and the mode carried through',
      navigated.length === 1 &&
        navigated[0][0] === 'AddAddress' &&
        JSON.stringify(navigated[0][1]) ===
          JSON.stringify({ editingAddressId: 'a2', mode: 'manage' }),
      navigated,
    );
  }

  // 5c. omitting the mode behaves as manage
  {
    control.addresses = ADDRESSES;
    const tree = await mount();
    check(
      'no mode param -> manage, actions present',
      find(tree, 'edit-a1').length === 1,
      find(tree, 'edit-a1').length,
    );
  }

  // 5d. delete behind a confirmation
  {
    control.addresses = [...ADDRESSES];
    control.deleteThrows = false;
    const tree = await mount('manage');

    await press(tree, 'delete-a2');
    checkText(tree, 'Delete -> confirmation first', ['Delete this address?']);
    check('confirmation alone deletes nothing', deleted.length === 0, deleted);

    await press(tree, 'delete-cancel');
    check(
      'cancel -> nothing deleted, dialog gone',
      deleted.length === 0 && find(tree, 'delete-confirm').length === 0,
      deleted,
    );

    await press(tree, 'delete-a2');
    await press(tree, 'delete-confirm');
    check('confirm -> deleteAddress called with that id', deleted.join(',') === 'a2', deleted);
    check(
      'the list refetches, so the deleted row is gone',
      find(tree, 'address-a2').length === 0 && find(tree, 'address-a1').length === 1,
      { a2: find(tree, 'address-a2').length, a1: find(tree, 'address-a1').length },
    );
  }

  // 5e. a refused delete says why
  {
    control.addresses = [...ADDRESSES];
    control.deleteThrows = true;
    const tree = await mount('manage');
    await press(tree, 'delete-a2');
    await press(tree, 'delete-confirm');
    checkText(tree, 'delete refused -> the reason is shown, row stays', [
      'Address is used by existing orders',
    ]);
    check('the row is still there', find(tree, 'address-a2').length === 1);
    control.deleteThrows = false;
  }

  // 5f. returning to the screen refetches
  {
    control.addresses = [ADDRESSES[0]];
    const tree = await mount('manage');
    check('one address on first load', find(tree, 'address-a2').length === 0);

    control.addresses = ADDRESSES;
    await TestRenderer.act(async () => {
      focusListener!();
      await wait(20);
    });
    check(
      'regaining focus re-reads the list, showing what changed elsewhere',
      find(tree, 'address-a2').length === 1,
      find(tree, 'address-a2').length,
    );
  }

  // 6. add new
  {
    control.addresses = ADDRESSES;
    const tree = await mount('select');
    await press(tree, 'add-new');
    check(
      'Add new address -> AddAddress carrying the current mode',
      navigated.length === 1 &&
        navigated[0][0] === 'AddAddress' &&
        JSON.stringify(navigated[0][1]) === JSON.stringify({ mode: 'select' }),
      navigated,
    );
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} address list states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
