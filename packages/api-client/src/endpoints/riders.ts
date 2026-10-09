import type { ApiClient } from '../client';
import type {
  AvailableOrder,
  MyRiderResponse,
  Rider,
  RiderLocationResponse,
  RiderOrder,
  RiderOrdersFilter,
} from '../types';

/**
 * GET /v1/riders/available-orders — APPROVED riders only (403 otherwise).
 * Unclaimed READY_FOR_PICKUP orders whose store is within 5 km of (lat, lng),
 * nearest first, at most 20.
 */
export function availableOrders(
  client: ApiClient,
  lat: number,
  lng: number,
): Promise<AvailableOrder[]> {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  return client.get<AvailableOrder[]>(`/v1/riders/available-orders?${params.toString()}`);
}

/**
 * GET /v1/riders/me — never 404s for a rider who has not onboarded yet; that
 * comes back as { onboarded: false }.
 */
export function getMyRider(client: ApiClient): Promise<MyRiderResponse> {
  return client.get<MyRiderResponse>('/v1/riders/me');
}

/** PATCH /v1/riders/me/availability — go on/off shift. APPROVED riders only. */
export function setMyAvailability(client: ApiClient, isAvailable: boolean): Promise<Rider> {
  return client.patch<Rider>('/v1/riders/me/availability', { isAvailable });
}

/**
 * PATCH /v1/riders/me/location — for background reporting. The DB write is
 * throttled server-side (persisted:false when skipped), but the position is
 * always rebroadcast to the rider's active order, if any.
 */
export function updateMyLocation(
  client: ApiClient,
  lat: number,
  lng: number,
): Promise<RiderLocationResponse> {
  return client.patch<RiderLocationResponse>('/v1/riders/me/location', { lat, lng });
}

/**
 * GET /v1/riders/me/orders — "active" (default) is the delivery in progress;
 * "history" is the 50 most recent others.
 */
export function myRiderOrders(
  client: ApiClient,
  status: RiderOrdersFilter = 'active',
): Promise<RiderOrder[]> {
  return client.get<RiderOrder[]>(`/v1/riders/me/orders?status=${status}`);
}
