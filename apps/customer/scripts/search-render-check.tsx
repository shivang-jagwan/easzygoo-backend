/**
 * Renders the real SearchScreen in every state through react-test-renderer.
 * Same stubbing approach as scripts/render-check.tsx — no device needed.
 *
 *   pnpm search-render-check
 */
(globalThis as any).React = require('react');

const Module = require('module');
const origLoad = Module._load;
const React = require('react');

const control: { permission: string; results: any; throwOn: string | null } = {
  permission: 'granted',
  results: { vendors: [], products: [] },
  throwOn: null,
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
  },
  { get: (t: any, k: string) => (k in t ? t[k] : (t[k] = host(k))) },
);

/**
 * Stands in for src/context/LocationContext. When permission is granted the
 * coords are already there on first render — the real case, since Home has
 * fetched them before Search is pushed. That is what lets a search fire on the
 * debounce alone, with no location round trip in front of it.
 */
const locationContextStub = {
  useLocation: () => {
    const granted = control.permission === 'granted';
    const [coords, setCoords] = React.useState<any>(
      granted ? { lat: 19.076, lng: 72.8777 } : null,
    );
    const [status, setStatus] = React.useState(granted ? 'granted' : 'idle');
    const requestLocation = React.useCallback(async () => {
      if (control.permission !== 'granted') {
        setStatus('denied');
        return;
      }
      setCoords({ lat: 19.076, lng: 72.8777 });
      setStatus('granted');
    }, []);
    return { coords, status, requestLocation };
  },
};

class StubApiError extends Error {
  constructor(public status: number, message: string, public override cause?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

let searchCalls = 0;
const apiClientStub = {
  ApiError: StubApiError,
  search: async () => {
    searchCalls += 1;
    if (control.throwOn === 'hang') return new Promise(() => {}); // never settles
    if (control.throwOn === 'network') throw new StubApiError(0, 'Network request failed');
    if (control.throwOn === 'server') throw new StubApiError(500, 'Search index offline');
    return control.results;
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
  '../lib/errors': {
    toUserMessage: (err: unknown) =>
      err instanceof StubApiError
        ? err.status === 0
          ? 'Check your connection and try again.'
          : err.message
        : 'Something went wrong. Please try again.',
  },
  '../theme/ThemeContext': themeStub,
  '../components/ScreenHeader': { __esModule: true, default: host('ScreenHeader') },
};

Module._load = function (request: string, ...rest: any[]) {
  if (request in stubs) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const TestRenderer = require('react-test-renderer');
const SearchScreen = require('../src/screens/SearchScreen').default;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function texts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) texts(node.children, out);
  return out;
}

/** Finds the TextInput and drives its onChangeText, like real typing. */
function typeInto(tree: any, value: string) {
  const input = tree.root.findByType(rnStub.TextInput);
  TestRenderer.act(() => input.props.onChangeText(value));
}

async function renderCase(
  label: string,
  setup: () => void,
  type: string,
  expected: string[],
  absent: string[] = [],
  waitMs = 700,
): Promise<boolean> {
  setup();
  const navigation = { navigate: () => {} };
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(SearchScreen, { navigation, route: { params: undefined } }),
    );
  });
  if (type) typeInto(tree, type);
  await TestRenderer.act(async () => { await wait(waitMs); });

  const found = texts(tree.toJSON());
  const ok =
    expected.every((e) => found.some((f) => f.includes(e))) &&
    absent.every((a) => !found.some((f) => f.includes(a)));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`        ${JSON.stringify(found).slice(0, 175)}`);
  if (!ok) console.log(`        expected all of ${JSON.stringify(expected)}`);
  return ok;
}

(async () => {
  const results: boolean[] = [];

  // 1. below the minimum — no request, nothing rendered
  searchCalls = 0;
  results.push(await renderCase('under 2 chars -> no request, no results UI',
    () => { control.throwOn = null; control.results = { vendors: [], products: [] }; },
    'a',
    [],
    ['No results for', 'Shops', 'Vegetables', 'Could not search']));
  console.log(`        search() calls: ${searchCalls} ${searchCalls === 0 ? '(correct — none fired)' : '(WRONG)'}`);
  results.push(searchCalls === 0);

  // 2. loading — checked before the debounce elapses
  {
    control.throwOn = 'hang'; // request never settles, so 'searching' persists
    let tree: any;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(SearchScreen, { navigation: { navigate: () => {} }, route: {} }),
      );
    });
    typeInto(tree, 'tomato');
    await TestRenderer.act(async () => { await wait(600); });
    const spinner = JSON.stringify(tree.toJSON()).includes('"type":"ActivityIndicator"');
    console.log(`  ${spinner ? 'PASS' : 'FAIL'}  in-flight search -> ActivityIndicator`);
    results.push(spinner);
  }

  // 3. empty
  results.push(await renderCase('both arrays empty -> "No results for <query>"',
    () => { control.throwOn = null; control.results = { vendors: [], products: [] }; },
    'zzzz',
    ['No results for', 'zzzz'],
    ['Shops', 'Vegetables']));

  // 4. populated, both sections
  results.push(await renderCase('vendors + products -> both sections render',
    () => {
      control.throwOn = null;
      control.results = {
        vendors: [{ id: 'v2', storeName: 'North Mart', distanceKm: 1.56 }],
        products: [
          { id: 'p1', name: 'Tomato', description: null, imageUrl: null, unit: 'KILOGRAM', unitValue: 1, price: '25', stockQty: 10, vendor: { id: 'v1', storeName: 'Shivang Fresh', distanceKm: 0 } },
          { id: 'p2', name: 'Cherry Tomatoes', description: null, imageUrl: null, unit: 'KILOGRAM', unitValue: 1, price: '25', stockQty: 10, vendor: { id: 'v2', storeName: 'North Mart', distanceKm: 1.56 } },
        ],
      };
    },
    'tomato',
    ['Shops', 'North Mart', 'Vegetables', 'Tomato', 'Cherry Tomatoes', 'Shivang Fresh', '1.56'],
    ['No results for']));

  // 5. products only — Shops heading must not appear
  results.push(await renderCase('products only -> no empty "Shops" heading',
    () => {
      control.throwOn = null;
      control.results = {
        vendors: [],
        products: [{ id: 'p1', name: 'Tomato', description: null, imageUrl: null, unit: 'KILOGRAM', unitValue: 1, price: '25', stockQty: 10, vendor: { id: 'v1', storeName: 'Shivang Fresh', distanceKm: 0 } }],
      };
    },
    'tomato',
    ['Vegetables', 'Tomato', 'Shivang Fresh'],
    ['Shops', 'No results for']));

  // 6. network error
  results.push(await renderCase('ApiError status 0 -> connection copy + Retry',
    () => { control.throwOn = 'network'; },
    'tomato',
    ['Could not search', 'Check your connection and try again.', 'Retry'],
    ['Network request failed']));

  // 7. server error surfaces backend text
  results.push(await renderCase('ApiError status 500 -> backend message + Retry',
    () => { control.throwOn = 'server'; },
    'tomato',
    ['Could not search', 'Search index offline', 'Retry']));

  // 8. debounce — rapid typing fires exactly one request
  {
    control.throwOn = null;
    control.results = { vendors: [], products: [] };
    searchCalls = 0;
    let tree: any;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(SearchScreen, { navigation: { navigate: () => {} }, route: {} }),
      );
    });
    for (const q of ['to', 'tom', 'toma', 'tomat', 'tomato']) {
      typeInto(tree, q);
      await TestRenderer.act(async () => { await wait(60); });
    }
    await TestRenderer.act(async () => { await wait(700); });
    const ok = searchCalls === 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  debounce: 5 keystrokes -> ${searchCalls} request(s)`);
    results.push(ok);
  }

  // 9. no coords -> the location block, not a search
  searchCalls = 0;
  results.push(await renderCase('location denied -> enable-location block + Try again',
    () => { control.permission = 'denied'; control.throwOn = null; },
    'tomato',
    ['Enable location to see vendors near you', 'Try again'],
    ['No results for', 'Shops', 'Vegetables', 'Could not search']));
  console.log(`        search() calls: ${searchCalls} ${searchCalls === 0 ? '(correct — none fired)' : '(WRONG)'}`);
  results.push(searchCalls === 0);
  control.permission = 'granted';

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} search states verified`);
  process.exit(passed === results.length ? 0 : 1);
})();
