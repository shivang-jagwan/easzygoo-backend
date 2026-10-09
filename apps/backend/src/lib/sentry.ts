import * as Sentry from '@sentry/node';

/*
 * Crash reporting. The API server and the notification worker are separate Node
 * processes (Render web service + Background Worker), so each one calls
 * initSentry() for itself — one process's init does nothing for the other.
 *
 * Requires lib/env to have loaded first, since the DSN comes from the root .env.
 */

let initialised = false;

/**
 * Requests whose bodies carry bank details or KYC documents. Sentry's HTTP
 * integration attaches incoming request bodies to error events by default, so
 * these are excluded at capture time — they never leave the process. (Fastify's
 * own request logging records method/url/ip only, never bodies.)
 */
const SENSITIVE_BODY_PATHS = [/^\/v1\/(vendors|riders)\/onboard\b/, /^\/v1\/vendors\/me\/bank\b/];

export function isSensitiveBodyPath(url: string): boolean {
  const path = url.split('?')[0];
  return SENSITIVE_BODY_PATHS.some((re) => re.test(path));
}

export function initSentry(): void {
  if (initialised) return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Local dev without Sentry configured must still boot.
    console.warn('[sentry] SENTRY_DSN not set — crash reporting disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    integrations: [
      Sentry.httpIntegration({
        // Request bodies on onboarding/bank routes are never sent to Sentry.
        ignoreIncomingRequestBody: (url) => isSensitiveBodyPath(url),
      }),
    ],
    // Second line of defence in case a body reaches an event some other way.
    beforeSend(event) {
      const req = event.request;
      if (req?.url && isSensitiveBodyPath(new URL(req.url, 'http://localhost').pathname)) {
        delete req.data;
      }
      return event;
    },
  });

  initialised = true;
  console.log(`[sentry] initialised (env: ${process.env.NODE_ENV || 'development'})`);
}
