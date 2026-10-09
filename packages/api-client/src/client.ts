/**
 * Transport layer. Deliberately free of React Native and Firebase imports —
 * each app supplies its own `getToken` (which will wrap Firebase's
 * `currentUser.getIdToken()`), so this package stays pure TypeScript and is
 * importable from anywhere, including tests and the admin panel.
 */

/**
 * The only error type this client throws.
 *
 * `status` is the HTTP status for a non-2xx response, or **0** when the request
 * never reached the server at all (offline, DNS failure, connection refused,
 * TLS error, abort). Callers can branch on `status === 0` to mean "check your
 * connection" without sniffing error constructors or message text.
 *
 * `cause` carries the original thrown value for logging — never show it to a
 * user; a failed `fetch` rejects with an opaque `TypeError: fetch failed`.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Deliberately the standard Error.cause, so logging tools pick it up.
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the request never reached the server. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export interface ApiClientOptions {
  /** e.g. "http://localhost:4000". A trailing slash is fine. */
  baseUrl: string;
  /** Returns the current Firebase ID token, or null when signed out. */
  getToken: () => Promise<string | null>;
}

export interface RequestOptions {
  /**
   * Overrides `getToken()` for this one call. Needed by auth.verify(), which
   * runs at signup before the app has anywhere to read a token back from.
   */
  token?: string;
}

export interface ApiClient {
  get<T>(path: string, opts?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T>(path: string, opts?: RequestOptions): Promise<T>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function createApiClient({ baseUrl, getToken }: ApiClientOptions): ApiClient {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {};

    const token = opts?.token ?? (await getToken());
    if (token !== null && token !== undefined) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // fetch only rejects when the request never completed. Normalise it here
      // so every app sees one error type instead of a raw TypeError leaking
      // through and being rendered to users verbatim.
      throw new ApiError(0, 'Network request failed', err);
    }

    // 204 and other empty bodies would blow up res.json().
    const text = await res.text();
    const payload: unknown = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      throw new ApiError(
        res.status,
        extractErrorMessage(payload) ?? `Request failed (${res.status})`,
        payload,
      );
    }

    return payload as T;
  }

  return {
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    put: (path, body, opts) => request('PUT', path, body, opts),
    patch: (path, body, opts) => request('PATCH', path, body, opts),
    delete: (path, opts) => request('DELETE', path, undefined, opts),
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The backend's error shape is `{ error: string }`; fall back sensibly. */
function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload) return payload;
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    if (typeof o.error === 'string') return o.error;
    if (typeof o.message === 'string') return o.message;
  }
  return null;
}
