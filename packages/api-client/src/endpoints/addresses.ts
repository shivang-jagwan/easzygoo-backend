import type { ApiClient } from '../client';
import type {
  Address,
  CreateAddressRequest,
  DeleteAddressResponse,
  UpdateAddressRequest,
} from '../types';

/**
 * POST /v1/addresses — authenticated, any role. The owner is taken from the
 * token, so never send a userId.
 *
 * The account's first address comes back with isDefault true whatever the
 * request asked for; creating a later one with isDefault true demotes the
 * previous default in the same transaction.
 */
export function createAddress(client: ApiClient, data: CreateAddressRequest): Promise<Address> {
  return client.post<Address>('/v1/addresses', data);
}

/**
 * GET /v1/addresses/mine — the caller's own addresses, default first, then
 * newest first. Empty array for a new account, never 404.
 */
export function myAddresses(client: ApiClient): Promise<Address[]> {
  return client.get<Address[]>('/v1/addresses/mine');
}

/**
 * PUT /v1/addresses/:id — must own the address (403 otherwise, 404 if unknown).
 * Partial: send only what changed. See UpdateAddressRequest for the isDefault
 * rules.
 */
export function updateAddress(
  client: ApiClient,
  id: string,
  data: UpdateAddressRequest,
): Promise<Address> {
  return client.put<Address>(`/v1/addresses/${encodeURIComponent(id)}`, data);
}

/**
 * DELETE /v1/addresses/:id — hard delete, and 409 when orders reference it.
 * Deleting the default promotes the next most recent address server-side, so
 * refetch the list rather than patching it locally.
 */
export function deleteAddress(client: ApiClient, id: string): Promise<DeleteAddressResponse> {
  return client.delete<DeleteAddressResponse>(`/v1/addresses/${encodeURIComponent(id)}`);
}
