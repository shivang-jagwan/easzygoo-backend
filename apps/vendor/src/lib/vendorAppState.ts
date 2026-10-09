import type { AuthUser, MyVendorResponse } from '@easzygoo/api-client';

import type { VendorAppState } from '../navigation/types';

/**
 * What RootNavigator should show. Only `ready` maps onto one of the four
 * navigator branches — `loading` and `error` are states of the *decision*, not
 * flows the vendor can be in, so they are kept out of VendorAppState rather
 * than smuggled in as extra members.
 */
export type VendorGate =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; state: VendorAppState };

export interface VendorGateInput {
  /** True until the restored Firebase session has been checked. */
  isAuthLoading: boolean;
  /** Our backend's User row, null when signed out. */
  user: AuthUser | null;
  /** GET /v1/vendors/me, or null while it is still in flight. */
  profile: MyVendorResponse | null;
  /** Set when that request failed, so we genuinely do not know the answer. */
  profileError: boolean;
}

/**
 * Derives the top-level flow from auth + the vendor's own profile.
 *
 * The one rule worth stating: a failed profile fetch resolves to `error`, never
 * to `onboarding`. Those two are indistinguishable from the app's side — both
 * are "no vendor row in hand" — but treating a dropped connection as "you have
 * no store yet" would walk an already-onboarded vendor back into the signup
 * form and invite a duplicate submission. Not knowing is its own answer.
 */
export function resolveVendorAppState({
  isAuthLoading,
  user,
  profile,
  profileError,
}: VendorGateInput): VendorGate {
  if (isAuthLoading) return { kind: 'loading' };
  if (user === null) return { kind: 'ready', state: 'loggedOut' };
  if (profileError) return { kind: 'error' };
  if (profile === null) return { kind: 'loading' };
  if (!profile.onboarded) return { kind: 'ready', state: 'onboarding' };

  // PENDING, REJECTED and SUSPENDED all park the vendor on the same screen —
  // it reads the status from context and picks its own wording, so the three
  // are not flattened into one "under review" message.
  return {
    kind: 'ready',
    state: profile.vendor.status === 'APPROVED' ? 'active' : 'pendingApproval',
  };
}
