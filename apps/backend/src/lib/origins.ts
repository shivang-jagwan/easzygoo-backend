import { allowedOrigins } from './env';

/**
 * The one origin rule for both HTTP (Fastify) and Socket.io:
 *
 *   - No Origin header: allowed. Native mobile HTTP clients send none, and
 *     Origin is not an auth mechanism here — every protected route needs a
 *     bearer token regardless.
 *   - Origin in ALLOWED_ORIGINS: allowed (e.g. the admin panel).
 *   - Origin equal to the API's own origin: allowed. React Native's WebSocket
 *     (Android and iOS) sends Origin set to the socket URL's own origin, so the
 *     mobile apps' Socket.io connections arrive "same-origin" — that is not a
 *     cross-origin request and must not be refused.
 *   - Anything else: a browser on an unknown site — refused.
 *
 * `host` is the Host the client addressed (after any trusted proxy rewrite).
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    // Includes the literal "null" origin (sandboxed iframes, file://).
    return false;
  }
}
