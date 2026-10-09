import * as Sentry from '@sentry/node';
import Fastify, { type FastifyError, type FastifyInstance, type RouteOptions } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type Redis from 'ioredis';

import { allowedOrigins, trustProxy } from './lib/env';
import { firebaseTokenVerifier, type TokenVerifier } from './lib/auth-middleware';
import { isAllowedOrigin } from './lib/origins';
import { RATE_LIMITS, RATE_WINDOW } from './lib/rate-limits';
import { REDIS_PREFIX } from './lib/redis';

import addressRoutes from './routes/addresses';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import catalogRoutes from './routes/catalog';
import discoveryRoutes from './routes/discovery';
import notificationRoutes from './routes/notifications';
import onboardingRoutes from './routes/onboarding';
import searchRoutes from './routes/search';
import orderLifecycleRoutes from './routes/order-lifecycle';
import orderRoutes from './routes/orders';
import riderAccountRoutes from './routes/rider-account';
import uploadRoutes from './routes/uploads';
import userRoutes from './routes/users';
import vendorAccountRoutes from './routes/vendor-account';

export interface BuildAppOptions {
  /** Replaces Firebase ID-token verification. Tests inject a fake here. */
  verifyToken?: TokenVerifier;
  /**
   * Redis for the rate limiter (keys under `rl:`). Null/omitted uses the
   * in-memory store — fine for tests and single-process dev, wrong for a
   * cluster, where every instance would count separately.
   */
  rateLimitRedis?: Redis | null;
  /**
   * Default true. Tests that fire hundreds of requests from one address turn
   * it off; the rate-limit tests leave it on. Never false in the server.
   */
  rateLimit?: boolean;
  /** Observes every route as it is registered (the auth-matrix test uses it). */
  onRoute?: (route: RouteOptions) => void;
  logger?: boolean;
}

/**
 * Builds the HTTP app without listening, so the server entry point and the
 * test suite assemble exactly the same thing. Socket.io is attached separately
 * by index.ts, once there is a listening server.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    // Behind Cloudflare + Nginx, request.ip must be the client, not the proxy,
    // or every user shares one per-IP rate limit. Hop count from TRUST_PROXY.
    trustProxy,
  });

  app.decorate('verifyToken', options.verifyToken ?? firebaseTokenVerifier);
  if (options.onRoute) app.addHook('onRoute', options.onRoute);

  // Captures unhandled route errors (5xx) with full request context.
  Sentry.setupFastifyErrorHandler(app);

  // Every error leaves as { error }, the shape all routes already use. 5xx
  // details stay in the logs/Sentry and never reach the client.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      request.log.error(err);
      return reply.code(status).send({ error: 'Internal server error' });
    }
    return reply.code(status).send({ error: err.message });
  });

  // Browser origins are refused outright unless allow-listed — CORS headers
  // alone only stop a browser *reading* the response, not the request running.
  // Registered before @fastify/cors so preflights from unknown origins 403 too.
  app.addHook('onRequest', async (request, reply) => {
    if (!isAllowedOrigin(request.headers.origin, request.host)) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
  });

  await app.register(helmet);
  await app.register(cors, { origin: allowedOrigins.length > 0 ? allowedOrigins : false });

  // Without the plugin, routes' `config.rateLimit` is inert metadata.
  if (options.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      max: RATE_LIMITS.global,
      timeWindow: RATE_WINDOW,
      redis: options.rateLimitRedis ?? undefined,
      nameSpace: REDIS_PREFIX.rateLimit,
      // Fail open: if Redis is down, serve requests unlimited rather than take
      // the whole API down with it.
      skipOnError: true,
      errorResponseBuilder: (_request, context) => {
        const err = new Error(`Too many requests, retry in ${context.after}`) as FastifyError;
        err.statusCode = context.statusCode;
        return err;
      },
    });
  }

  // Exempt from rate limiting so health checks can never be throttled.
  app.get('/health', { config: { rateLimit: false } }, async () => {
    return { status: 'ok', service: 'easzygoo-backend' };
  });

  // Versioned under /v1 per CLAUDE.md conventions.
  for (const routes of [
    authRoutes,
    adminRoutes,
    addressRoutes,
    onboardingRoutes,
    notificationRoutes,
    discoveryRoutes,
    searchRoutes,
    catalogRoutes,
    orderRoutes,
    orderLifecycleRoutes,
    vendorAccountRoutes,
    riderAccountRoutes,
    userRoutes,
    uploadRoutes,
  ]) {
    await app.register(routes, { prefix: '/v1' });
  }

  return app;
}
