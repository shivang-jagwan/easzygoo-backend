import type { FastifyInstance, RouteOptions } from 'fastify';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app';
import type { TokenVerifier } from '../../src/lib/auth-middleware';

/*
 * Fake Firebase. A test token is `test-token:<uid>:<phone>`; the fake verifier
 * accepts exactly that shape and rejects everything else, so no test ever calls
 * Firebase. Seed helpers mint tokens via tokenFor().
 */
const TOKEN_PREFIX = 'test-token';

export function tokenFor(firebaseUid: string, phone?: string): string {
  return [TOKEN_PREFIX, firebaseUid, phone ?? ''].join(':');
}

export const fakeVerifier: TokenVerifier = async (idToken) => {
  const [prefix, uid, phone] = idToken.split(':');
  if (prefix !== TOKEN_PREFIX || !uid) {
    throw new Error('invalid test token');
  }
  return {
    uid,
    phone_number: phone || undefined,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
};

export interface TestApp {
  app: FastifyInstance;
  /** Every route registered, as "METHOD /url". */
  routes: string[];
  request: (opts: TestRequest) => Promise<LightMyRequestResponse>;
}

export interface TestRequest {
  method: InjectOptions['method'];
  url: string;
  token?: string;
  body?: unknown;
  remoteAddress?: string;
}

/**
 * The real app (buildApp), with the fake verifier and no logger. Rate limiting
 * is off unless asked for: other suites send hundreds of requests from one
 * address, and the rate-limit suite tests it on purpose.
 */
export async function makeApp(opts: { rateLimit?: boolean } = {}): Promise<TestApp> {
  const routes: string[] = [];
  const app = await buildApp({
    logger: false,
    verifyToken: fakeVerifier,
    rateLimit: opts.rateLimit ?? false,
    onRoute: (route: RouteOptions) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const m of methods) if (m !== 'HEAD') routes.push(`${m} ${route.url}`);
    },
  });
  await app.ready();

  const request = ({ method, url, token, body, remoteAddress }: TestRequest) =>
    app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body !== undefined ? { payload: body as InjectOptions['payload'] } : {}),
      ...(remoteAddress ? { remoteAddress } : {}),
    });

  return { app, routes, request };
}
