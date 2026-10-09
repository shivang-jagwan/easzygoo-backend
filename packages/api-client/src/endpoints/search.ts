import type { ApiClient } from '../client';
import type { SearchResults } from '../types';

/**
 * GET /v1/search — public. Searches vendor names and product names, scoped to
 * vendors that can deliver to (lat, lng).
 *
 * The backend rejects a `q` shorter than 2 characters with a 400, so callers
 * should avoid firing below that rather than relying on the error.
 * `maxRadiusKm` defaults to 10 server-side.
 */
export function search(
  client: ApiClient,
  q: string,
  lat: number,
  lng: number,
  maxRadiusKm?: number,
): Promise<SearchResults> {
  const params = new URLSearchParams({ q, lat: String(lat), lng: String(lng) });
  if (maxRadiusKm !== undefined) params.set('maxRadiusKm', String(maxRadiusKm));
  return client.get<SearchResults>(`/v1/search?${params.toString()}`);
}
