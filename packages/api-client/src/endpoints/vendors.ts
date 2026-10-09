import type { ApiClient } from '../client';
import type {
  UpdateBankRequest,
  UpdateVendorRequest,
  Vendor,
  VendorOrdersPage,
  VendorOrdersQuery,
} from '../types';

/**
 * GET /v1/vendors/me/orders — vendor only, newest first.
 *
 * Defaults to the live queue (status "active"); pass "all" for history or one
 * specific status. To page, pass the previous page's nextCursor as `cursor`
 * until it comes back null. 404 if the vendor has not onboarded.
 */
export function myVendorOrders(
  client: ApiClient,
  query: VendorOrdersQuery = {},
): Promise<VendorOrdersPage> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const qs = params.toString();
  return client.get<VendorOrdersPage>(`/v1/vendors/me/orders${qs ? `?${qs}` : ''}`);
}

/**
 * PATCH /v1/vendors/me — store settings. 403 unless the store is APPROVED;
 * 409 if its status changed mid-request. Bank details use updateMyBank.
 */
export function updateMyVendor(client: ApiClient, data: UpdateVendorRequest): Promise<Vendor> {
  return client.patch<Vendor>('/v1/vendors/me', data);
}

/**
 * PUT /v1/vendors/me/bank — allowed in any status. The response, like every
 * Vendor, carries only bankAccountLast4.
 */
export function updateMyBank(client: ApiClient, data: UpdateBankRequest): Promise<Vendor> {
  return client.put<Vendor>('/v1/vendors/me/bank', data);
}
