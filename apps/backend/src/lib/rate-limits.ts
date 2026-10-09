import type { FastifyRequest } from 'fastify';
import type { RateLimitOptions } from '@fastify/rate-limit';

/** Requests per minute. One place, so routes and tests agree on the numbers. */
export const RATE_LIMITS = {
  /** Every route without a stricter rule, per IP. */
  global: 120,
  /** POST /v1/auth/verify, per IP — signup/login, the brute-force target. */
  authVerify: 10,
  /** GET /v1/search and /v1/vendors/nearby, per IP — public geo scans. */
  discovery: 30,
  /** POST /v1/orders, per signed-in customer. */
  createOrder: 10,
} as const;

export const RATE_WINDOW = '1 minute';

/** Per-route config: N requests per minute per client IP. */
export function perIp(max: number): { rateLimit: RateLimitOptions } {
  return { rateLimit: { max, timeWindow: RATE_WINDOW } };
}

/**
 * Per-route config: N requests per minute per authenticated user.
 *
 * Runs at preHandler — after the route's own requireAuth/requireRole, which
 * @fastify/rate-limit appends its hook behind — so request.authUser is set.
 * Requests that fail auth are rejected before ever counting against a user.
 */
export function perUser(max: number): { rateLimit: RateLimitOptions } {
  return {
    rateLimit: {
      max,
      timeWindow: RATE_WINDOW,
      hook: 'preHandler',
      keyGenerator: (request: FastifyRequest) =>
        request.authUser ? `user:${request.authUser.userId}` : `ip:${request.ip}`,
    },
  };
}
