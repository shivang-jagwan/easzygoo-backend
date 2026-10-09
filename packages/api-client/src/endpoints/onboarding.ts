import type { ApiClient } from '../client';
import type {
  MyVendorResponse,
  OnboardRiderRequest,
  OnboardVendorRequest,
  Rider,
  Vendor,
} from '../types';

/**
 * POST /v1/vendors/onboard — one-time profile creation. Returns 409 if the
 * account already has a Vendor row. The new row starts at status PENDING.
 */
export function onboardVendor(client: ApiClient, data: OnboardVendorRequest): Promise<Vendor> {
  return client.post<Vendor>('/v1/vendors/onboard', data);
}

/**
 * GET /v1/vendors/me — vendor only, the caller's own profile.
 *
 * Never 404s for a vendor who has not onboarded yet: that comes back as
 * { onboarded: false }, so a fresh account is a branch rather than an error to
 * catch. A 403 still means the signed-in account is not a vendor at all.
 */
export function getMyVendor(client: ApiClient): Promise<MyVendorResponse> {
  return client.get<MyVendorResponse>('/v1/vendors/me');
}

/** POST /v1/riders/onboard — same contract, for riders. Starts at PENDING. */
export function onboardRider(client: ApiClient, data: OnboardRiderRequest): Promise<Rider> {
  return client.post<Rider>('/v1/riders/onboard', data);
}
