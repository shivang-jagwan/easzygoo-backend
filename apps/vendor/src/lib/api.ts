import { createApiClient } from '@easzygoo/api-client';

import { auth } from './firebase';

/**
 * The shared API client. Every backend call in this app goes through here so
 * requests stay typed and the bearer token is attached in exactly one place.
 *
 * EXPO_PUBLIC_API_URL is inlined by Metro at build time. Expo reads .env from
 * the app directory (apps/vendor/.env), not the monorepo root, so the fallback
 * below is what you get if that file is missing.
 */
// Metro inlines EXPO_PUBLIC_* at build time by rewriting the member expression
// `process.env.EXPO_PUBLIC_API_URL` literally. Wrapping it in a cast — even
// `(process.env as X).FOO` — stops the rewrite. Keep this expression as-is.
export const apiBaseUrl: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getToken: async () => {
    const current = auth.currentUser;
    if (!current) return null;
    return current.getIdToken();
  },
});
