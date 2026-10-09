import type { ApiClient } from '../client';
import type { AuthUser, SignupRole } from '../types';

/**
 * POST /v1/auth/verify — login and signup in one call.
 *
 * This is the one route that runs *before* a User row exists, so the Firebase
 * ID token is passed explicitly rather than relying on the client's
 * `getToken()` (which typically has nothing to return yet at signup).
 *
 * `role` is required for a brand-new account and must be CUSTOMER, VENDOR or
 * RIDER. For an existing account it is ignored server-side — the stored role
 * wins and cannot be changed through this endpoint.
 */
export function verify(client: ApiClient, idToken: string, role?: SignupRole): Promise<AuthUser> {
  return client.post<AuthUser>('/v1/auth/verify', role ? { role } : {}, { token: idToken });
}
