import type { ApiClient } from '../client';
import type { NearbyVendor, PublicVendor } from '../types';

/**
 * GET /v1/vendors/nearby — public. Returns APPROVED, open vendors within both
 * their own delivery radius and `maxRadiusKm`, nearest first.
 * `maxRadiusKm` defaults to 10 server-side.
 */
export function nearbyVendors(
  client: ApiClient,
  lat: number,
  lng: number,
  maxRadiusKm?: number,
): Promise<NearbyVendor[]> {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (maxRadiusKm !== undefined) params.set('maxRadiusKm', String(maxRadiusKm));
  return client.get<NearbyVendor[]>(`/v1/vendors/nearby?${params.toString()}`);
}

/**
 * GET /v1/vendors/:vendorId — public storefront detail. 404 for any store that
 * is not APPROVED, exactly as for one that does not exist.
 */
export function getVendor(client: ApiClient, vendorId: string): Promise<PublicVendor> {
  return client.get<PublicVendor>(`/v1/vendors/${encodeURIComponent(vendorId)}`);
}
