import type { ApiClient } from '../client';
import type {
  Coupon,
  CreateCouponRequest,
  DeadLetter,
  PendingRider,
  PendingVendor,
  Rider,
  ServiceZone,
  UpsertZoneRequest,
  Vendor,
} from '../types';

/*
 * ADMIN-only endpoints. Every call 403s for any other role. Admins are promoted
 * by hand in the database — no API route creates one.
 */

/** GET /v1/admin/vendors/pending — newest first, with the owner's phone. */
export function listPendingVendors(client: ApiClient): Promise<PendingVendor[]> {
  return client.get<PendingVendor[]>('/v1/admin/vendors/pending');
}

/** GET /v1/admin/riders/pending — newest first, with the rider's phone. */
export function listPendingRiders(client: ApiClient): Promise<PendingRider[]> {
  return client.get<PendingRider[]>('/v1/admin/riders/pending');
}

/** PATCH /v1/admin/vendors/:id/approve — PENDING only (400 otherwise, 409 on a race). */
export function approveVendor(client: ApiClient, id: string): Promise<Vendor> {
  return client.patch<Vendor>(`/v1/admin/vendors/${encodeURIComponent(id)}/approve`);
}

/** PATCH /v1/admin/vendors/:id/reject — PENDING only. */
export function rejectVendor(client: ApiClient, id: string): Promise<Vendor> {
  return client.patch<Vendor>(`/v1/admin/vendors/${encodeURIComponent(id)}/reject`);
}

/** PATCH /v1/admin/riders/:id/approve — PENDING only. */
export function approveRider(client: ApiClient, id: string): Promise<Rider> {
  return client.patch<Rider>(`/v1/admin/riders/${encodeURIComponent(id)}/approve`);
}

/** PATCH /v1/admin/riders/:id/reject — PENDING only. */
export function rejectRider(client: ApiClient, id: string): Promise<Rider> {
  return client.patch<Rider>(`/v1/admin/riders/${encodeURIComponent(id)}/reject`);
}

/** POST /v1/admin/coupons — 400 if the code already exists. */
export function createCoupon(client: ApiClient, data: CreateCouponRequest): Promise<Coupon> {
  return client.post<Coupon>('/v1/admin/coupons', data);
}

/** GET /v1/admin/zones — all service zones, active or not, by pincode. */
export function listZones(client: ApiClient): Promise<ServiceZone[]> {
  return client.get<ServiceZone[]>('/v1/admin/zones');
}

/**
 * POST /v1/admin/zones — create or update the zone for a pincode. Orders to a
 * pincode are refused unless it has an active zone, whose fee they are charged.
 */
export function upsertZone(client: ApiClient, data: UpsertZoneRequest): Promise<ServiceZone> {
  return client.post<ServiceZone>('/v1/admin/zones', data);
}

/**
 * GET /v1/admin/dlq — the 50 most recent dead-lettered notification jobs,
 * newest first. 503 when the API has no Redis configured.
 */
export function listDeadLetters(client: ApiClient): Promise<DeadLetter[]> {
  return client.get<DeadLetter[]>('/v1/admin/dlq');
}
