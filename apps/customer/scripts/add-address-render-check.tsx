/**
 * Renders the real AddAddressScreen through react-test-renderer.
 *
 *   pnpm add-address-render-check
 *
 * LocationContext is stubbed with a real state-backed hook, so coords arrive
 * asynchronously the way they do on a device.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: {
  /** 'granted' | 'denied' | 'no-fix' | 'pending' (never resolves) */
  location: string;
  throwOn: string | null;
  /** The address an edit should prefill from. */
  existing: any;
} = { location: 'granted', throwOn: null, existing: null };

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

/** Mirrors src/context/LocationContext's contract, including the rethrow. */
const locationContextStub = {
  useLocation: () => {
    const [coords, setCoords] = React.useState<any>(null);
    const [status, setStatus] = React.useState('idle');
    const requestLocation = React.useCallback(async () => {
      setStatus('requesting');
      if (control.location === 'pending') return new Promise(() => {});
      if (control.location === 'denied') {
        setStatus('denied');
        return;
      }
      if (control.location === 'no-fix') {
        setStatus('granted');
        throw new Error('Current location is unavailable');
      }
      setCoords({ lat: 19.076, lng: 72.8777 });
      setStatus('granted');
    }, []);
    return { coords, status, requestLocation };
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

let created: any = null;
let updated: { id: string; body: any } | null = null;
const apiClientStub = {
  ApiError: StubApiError,
  myAddresses: async () => (control.existing ? [control.existing] : []),
  updateAddress: async (_client: unknown, id: string, body: any) => {
    updated = { id, body };
    if (control.throwOn === 'server') throw new StubApiError(409, 'Pincode not serviceable');
    return { id, ...body };
  },
  createAddress: async (_client: unknown, body: any) => {
    created = body;
    if (control.throwOn === 'network') throw new StubApiError(0, 'Network request failed');
    if (control.throwOn === 'server') throw new StubApiError(409, 'Pincode not serviceable');
    return { id: 'new-1', ...body, isDefault: true, userId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' };
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
  '../context/LocationContext': locationContextStub,
  '../lib/api': { api: {} },
  '../theme/ThemeContext': themeStub,
  '../components/ScreenHeader': { __esModule: true, default: host('ScreenHeader') },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const AddAddressScreen = require('../src/screens/AddAddressScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

const navigated: Array<[string, unknown]> = [];
let goBacks = 0;
const navigation = {
  navigate: (name: string, params?: unknown) => navigated.push([name, params]),
  goBack: () => {
    goBacks += 1;
  },
};

async function mount(params?: Record<string, unknown>) {
  navigated.length = 0;
  created = null;
  updated = null;
  goBacks = 0;
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(AddAddressScreen, { navigation, route: { params } }),
    );
    await wait(25);
  });
  return tree;
}

function find(tree: any, testID: string): any[] {
  return tree.root.findAll((n: any) => n.props && n.props.testID === testID);
}

async function type(tree: any, testID: string, value: string) {
  const [node] = find(tree, testID);
  if (!node) throw new Error(`no input with testID ${testID}`);
  await TestRenderer.act(async () => {
    node.props.onChangeText(value);
  });
}

async function press(tree: any, testID: string) {
  const [node] = find(tree, testID);
  if (!node) throw new Error(`no element with testID ${testID}`);
  await TestRenderer.act(async () => {
    node.props.onPress();
    await wait(15);
  });
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

async function fillValidForm(tree: any) {
  await type(tree, 'input-label', 'Home');
  await type(tree, 'input-line1', '12 Rose Villa');
  await type(tree, 'input-line2', 'Near the water tank');
  await type(tree, 'input-city', 'Mumbai');
  await type(tree, 'input-pincode', '400001');
}

(async () => {
  // 1. location pending
  {
    control.location = 'pending';
    const tree = await mount({ mode: 'select' });
    check(
      'coords pending -> themed loading state, no form yet',
      JSON.stringify(tree.toJSON()).includes('"type":"ActivityIndicator"') &&
        find(tree, 'input-line1').length === 0,
      texts(tree.toJSON()),
    );
    checkText(tree, 'loading state names what it is waiting for', ['Finding your location']);
  }

  // 2. location denied -> form visible, Save disabled
  {
    control.location = 'denied';
    const tree = await mount({ mode: 'select' });
    checkText(tree, 'denied -> enable-location messaging with retry', [
      'Enable location to see vendors near you',
      'We use your location only to find stores that deliver to you.',
      'Try again',
    ]);
    // Field passes testID through to its TextInput, so a rendered field is
    // two matching nodes, not one.
    check(
      'denied -> form still usable, Save disabled',
      find(tree, 'input-line1').length > 0 && find(tree, 'save')[0].props.disabled === true,
      { inputs: find(tree, 'input-line1').length, save: find(tree, 'save')[0].props.disabled },
    );

    // Retrying after the permission is granted unblocks Save.
    control.location = 'granted';
    await press(tree, 'retry-location');
    check(
      'retry after granting -> banner gone, Save enabled',
      find(tree, 'location-blocked').length === 0 && find(tree, 'save')[0].props.disabled === false,
      { blocked: find(tree, 'location-blocked').length, save: find(tree, 'save')[0].props.disabled },
    );
  }

  // 2b. granted but no fix -> same block, real message
  {
    control.location = 'no-fix';
    const tree = await mount({ mode: 'select' });
    checkText(tree, 'granted but no fix -> same block with the real reason', [
      'Enable location to see vendors near you',
      'Something went wrong. Please try again.',
    ]);
    check('no fix -> Save still disabled', find(tree, 'save')[0].props.disabled === true);
  }

  // 3. validation
  {
    control.location = 'granted';
    control.throwOn = null;
    const tree = await mount({ mode: 'select' });

    await press(tree, 'save');
    checkText(tree, 'empty required fields -> inline error under each one', [
      'Address line 1 is required',
      'City is required',
      'Pincode is required',
    ]);
    check('validation failure does not call the API', created === null, created);

    // Optional fields never complain.
    check(
      'label and line2 have no error rows',
      find(tree, 'error-label').length === 0 && find(tree, 'error-line2').length === 0,
    );

    await type(tree, 'input-line1', '12 Rose Villa');
    await type(tree, 'input-city', 'Mumbai');
    await press(tree, 'save');
    checkText(
      tree,
      'filling two of three -> only pincode still errors',
      ['Pincode is required'],
      ['Address line 1 is required', 'City is required'],
    );

    // Whitespace is not a value.
    await type(tree, 'input-pincode', '   ');
    await press(tree, 'save');
    checkText(tree, 'whitespace-only pincode -> still required', ['Pincode is required']);
    check('whitespace submit still never reached the API', created === null, created);
  }

  // 4. successful submit
  {
    control.location = 'granted';
    control.throwOn = null;
    const tree = await mount({ mode: 'select' });
    await fillValidForm(tree);
    await press(tree, 'save');

    check(
      'submit -> createAddress called with trimmed fields and the context coords',
      created !== null &&
        created.label === 'Home' &&
        created.line1 === '12 Rose Villa' &&
        created.line2 === 'Near the water tank' &&
        created.city === 'Mumbai' &&
        created.pincode === '400001' &&
        created.latitude === 19.076 &&
        created.longitude === 72.8777,
      created,
    );
    check(
      'select mode success -> nested navigate to Checkout with the new id',
      navigated.length === 1 &&
        navigated[0][0] === 'Main' &&
        JSON.stringify(navigated[0][1]) ===
          JSON.stringify({
            screen: 'Cart',
            params: { screen: 'Checkout', params: { selectedAddressId: 'new-1' } },
          }),
      navigated,
    );
  }

  // 4b. blank optional fields go up as null, not ""
  {
    const tree = await mount({ mode: 'select' });
    await type(tree, 'input-line1', '9 Sector 4');
    await type(tree, 'input-city', 'Navi Mumbai');
    await type(tree, 'input-pincode', '400703');
    await press(tree, 'save');
    check(
      'blank label/line2 -> null, matching the backend contract',
      created.label === null && created.line2 === null,
      created,
    );
  }

  // 5. submit error keeps the form
  {
    control.throwOn = 'server';
    const tree = await mount({ mode: 'select' });
    await fillValidForm(tree);
    await press(tree, 'save');

    checkText(tree, 'submit fails -> themed banner with the backend message', [
      'Pincode not serviceable',
    ]);
    check('failed submit does not navigate', navigated.length === 0, navigated);
    check(
      'form keeps every value after a failed submit',
      find(tree, 'input-line1')[0].props.value === '12 Rose Villa' &&
        find(tree, 'input-city')[0].props.value === 'Mumbai' &&
        find(tree, 'input-pincode')[0].props.value === '400001' &&
        find(tree, 'input-label')[0].props.value === 'Home' &&
        find(tree, 'input-line2')[0].props.value === 'Near the water tank',
      {
        line1: find(tree, 'input-line1')[0].props.value,
        city: find(tree, 'input-city')[0].props.value,
        pincode: find(tree, 'input-pincode')[0].props.value,
      },
    );

    // Retrying once the backend is happy goes through with the same values.
    control.throwOn = null;
    await press(tree, 'save');
    check(
      'retry after a failed submit succeeds and navigates',
      navigated.length === 1 &&
        navigated[0][0] === 'Main' &&
        JSON.stringify(navigated[0][1]) ===
          JSON.stringify({
            screen: 'Cart',
            params: { screen: 'Checkout', params: { selectedAddressId: 'new-1' } },
          }),
      navigated,
    );
  }

  // 5b. network failure uses the connection copy
  {
    control.throwOn = 'network';
    const tree = await mount({ mode: 'select' });
    await fillValidForm(tree);
    await press(tree, 'save');
    checkText(
      tree,
      'network failure -> connection copy, not the raw message',
      ['Check your connection and try again.'],
      ['Network request failed'],
    );
  }

  // ---------- manage mode ----------
  {
    control.location = 'granted';
    control.throwOn = null;
    const tree = await mount();
    await fillValidForm(tree);
    await press(tree, 'save');
    check(
      'manage mode success -> returns to the list instead of checkout',
      goBacks === 1 && navigated.length === 0 && created !== null,
      { goBacks, navigated },
    );
  }

  // ---------- edit mode ----------
  {
    control.existing = {
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
    control.throwOn = null;

    const tree = await mount({ editingAddressId: 'a1' });

    checkText(tree, 'edit mode -> titled and labelled as an edit', ['Edit address', 'Save changes'], [
      'Add address',
    ]);
    check(
      'every field prefilled from the saved address',
      find(tree, 'input-label')[0].props.value === 'Home' &&
        find(tree, 'input-line1')[0].props.value === '12 Rose Villa' &&
        find(tree, 'input-line2')[0].props.value === 'Near the water tank' &&
        find(tree, 'input-city')[0].props.value === 'Mumbai' &&
        find(tree, 'input-pincode')[0].props.value === '400001',
      {
        label: find(tree, 'input-label')[0].props.value,
        line1: find(tree, 'input-line1')[0].props.value,
        city: find(tree, 'input-city')[0].props.value,
      },
    );

    await type(tree, 'input-city', 'Pune');
    await press(tree, 'save');

    check(
      'saving an edit calls updateAddress, never createAddress',
      updated !== null && updated.id === 'a1' && updated.body.city === 'Pune' && created === null,
      { updated, created },
    );
    check(
      'edit in manage mode returns to the list',
      goBacks === 1 && navigated.length === 0,
      { goBacks, navigated },
    );
    control.existing = null;
  }

  // ---------- editing an address that has since gone ----------
  {
    control.existing = null;
    const tree = await mount({ editingAddressId: 'gone' });
    checkText(tree, 'editing a deleted address -> says so rather than a blank form', [
      'That address no longer exists.',
    ]);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} add address states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
