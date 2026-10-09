/**
 * Renders the real HomeScreen in every state through react-test-renderer.
 *
 *   pnpm render-check              normal run
 *   PIN_REACT=1 pnpm render-check  force a single React instance
 *
 * react-native / LocationContext / api-client are stubbed at the module loader,
 * so no device or native runtime is needed — the component's own hooks,
 * effects and branching all execute for real. This is the only way to verify
 * screen states while the emulator is unavailable.
 *
 * PIN_REACT exists only to work around a duplicated React in node_modules. If
 * it is ever needed again, node_modules is in a bad state — fix that, don't
 * set the flag.
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: {
  permission: string;
  /** Granted, but no fix available — LocationContext rethrows in that case. */
  locationThrows: boolean;
  categories: unknown[];
  vendors: unknown[];
  throwOn: string | null;
} = { permission: 'granted', locationThrows: false, categories: [], vendors: [], throwOn: null };

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

/**
 * Stands in for src/context/LocationContext. It is a real hook backed by real
 * state, so coords still arrive asynchronously after mount — the screen's
 * request-then-react effect pair is exercised, not bypassed.
 */
const locationContextStub = {
  useLocation: () => {
    const [coords, setCoords] = React.useState<any>(null);
    const [status, setStatus] = React.useState('idle');
    const requestLocation = React.useCallback(async () => {
      if (control.permission !== 'granted') {
        setStatus('denied');
        return;
      }
      if (control.locationThrows) {
        // Matches the real context: permission is fine, the fix is not.
        setStatus('granted');
        throw new Error('Current location is unavailable');
      }
      setCoords({ lat: 19.076, lng: 72.8777 });
      setStatus('granted');
    }, []);
    return { coords, status, requestLocation };
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
  nearbyVendors: async () => {
    if (control.throwOn === 'network') {
      throw new StubApiError(0, 'Network request failed', new TypeError('fetch failed'));
    }
    if (control.throwOn === 'server') throw new StubApiError(500, 'Vendor lookup exploded');
    if (control.throwOn === 'nonApi') throw new Error('location hardware unavailable');
    return control.vendors;
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
  '../context/LocationContext': locationContextStub,
  '@easzygoo/api-client': apiClientStub,
  '../lib/api': { api: {} },
  '../theme/ThemeContext': themeStub,
  '../components/ScreenHeader': { __esModule: true, default: host('ScreenHeader') },
};

if (process.env.PIN_REACT === '1') {
  stubs.react = React;
  console.log('(PIN_REACT=1 — forcing one React instance)');
}

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const HomeScreen = require('../src/screens/HomeScreen').default;

const flush = () => new Promise((r) => setTimeout(r, 0));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

async function renderCase(
  label: string,
  setup: () => void,
  expected: string[],
  absent: string[] = [],
): Promise<boolean> {
  setup();
  const navigation = { navigate: () => {} };
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(HomeScreen, { navigation, route: { params: undefined } }),
    );
    await flush(); await flush(); await flush();
  });
  const found = texts(tree.toJSON());
  const ok =
    expected.every((e) => found.some((f) => f.includes(e))) &&
    absent.every((a) => !found.some((f) => f.includes(a)));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`        ${JSON.stringify(found).slice(0, 165)}`);
  if (!ok) console.log(`        expected all of ${JSON.stringify(expected)}`);
  return ok;
}

(async () => {
  const results: boolean[] = [];

  {
    control.permission = 'granted'; control.locationThrows = false;
    control.categories = []; control.vendors = []; control.throwOn = null;
    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(HomeScreen, { navigation: { navigate: () => {} }, route: {} }),
      );
    });
    const spinner = JSON.stringify(tree.toJSON()).includes('"type":"ActivityIndicator"');
    console.log(`  ${spinner ? 'PASS' : 'FAIL'}  loading -> ActivityIndicator before effects resolve`);
    results.push(spinner);
  }

  results.push(await renderCase('location denied -> empty state + Try again',
    () => { control.permission = 'denied'; control.locationThrows = false; control.throwOn = null; },
    ['Enable location to see vendors near you', 'Try again']));

  results.push(await renderCase('ApiError status 0 -> connection copy, not raw cause',
    () => { control.permission = 'granted'; control.throwOn = 'network'; },
    ['Could not load your feed', 'Check your connection and try again.', 'Retry'],
    ['fetch failed', 'Network request failed']));

  results.push(await renderCase('ApiError status 500 -> backend message surfaced',
    () => { control.permission = 'granted'; control.throwOn = 'server'; },
    ['Could not load your feed', 'Vendor lookup exploded', 'Retry']));

  results.push(await renderCase('non-ApiError throw -> generic fallback',
    () => { control.permission = 'granted'; control.throwOn = 'nonApi'; },
    ['Could not load your feed', 'Something went wrong. Please try again.', 'Retry'],
    ['location hardware unavailable']));

  results.push(await renderCase('granted but no GPS fix -> error state, not the denied state',
    () => { control.permission = 'granted'; control.locationThrows = true; control.throwOn = null; },
    ['Could not load your feed', 'Something went wrong. Please try again.', 'Retry'],
    ['Enable location to see vendors near you', 'Current location is unavailable']));

  results.push(await renderCase('granted, 2 categories, 0 vendors -> empty vendors',
    () => {
      control.permission = 'granted'; control.locationThrows = false; control.throwOn = null;
      control.categories = [
        { id: 'c1', name: 'Vegetables', imageUrl: null, sortOrder: 1 },
        { id: 'c2', name: 'Fruits', imageUrl: null, sortOrder: 2 },
      ];
      control.vendors = [];
    },
    ['Vegetables', 'Fruits', 'Vendors near you', 'No vendors near you yet']));

  results.push(await renderCase('2 vendors -> cards with name + distance',
    () => {
      control.vendors = [
        { id: 'v1', storeName: 'Shivang Fresh', latitude: 19.07, longitude: 72.87, deliveryRadiusKm: 3, distanceKm: 0.4 },
        { id: 'v2', storeName: 'North Mart', latitude: 19.09, longitude: 72.87, deliveryRadiusKm: 3, distanceKm: 1.56 },
      ];
    },
    ['Shivang Fresh', 'North Mart', '0.4', '1.56', 'km away'],
    ['No vendors near you yet']));

  results.push(await renderCase('vendor with isOpen:false -> Closed badge',
    () => {
      control.vendors = [
        { id: 'v3', storeName: 'Shut Store', latitude: 19, longitude: 72, deliveryRadiusKm: 3, distanceKm: 2, isOpen: false },
      ];
    },
    ['Shut Store', 'Closed']));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} render states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
