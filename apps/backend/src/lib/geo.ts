import { prisma } from './prisma';

/**
 * Shared geo helpers for the routes that answer "what is near this point".
 *
 * NOTE: bounding-box prefilter + in-memory Haversine is fine at low vendor
 * counts. If the vendor table grows large this should move to a PostGIS
 * `ST_DWithin` query or a geospatial index rather than scanning the box.
 */

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = 111.045; // good enough for a bounding box

export const DEFAULT_MAX_RADIUS_KM = 10;
/**
 * Hard ceiling on a caller-supplied search radius. Matches the largest delivery
 * radius a store can set, so nothing reachable is cut off, and keeps a public
 * request from scanning a city-sized bounding box.
 */
export const MAX_SEARCH_RADIUS_KM = 15;

/** Great-circle distance in km between two lat/lng points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

/** Query string shape shared by every "near me" route. */
export interface GeoQuery {
  lat?: string;
  lng?: string;
  maxRadiusKm?: string;
}

export type GeoParamsResult =
  | { ok: true; lat: number; lng: number; maxRadiusKm: number }
  | { ok: false; error: string };

/**
 * Validates lat/lng/maxRadiusKm from a query string so every geo route rejects
 * bad input identically. Returns the error message rather than sending it, so
 * the caller keeps control of the status code.
 */
export function parseGeoParams(query: GeoQuery): GeoParamsResult {
  const lat = Number(query.lat);
  const lng = Number(query.lng);

  if (
    query.lat === undefined ||
    query.lng === undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { ok: false, error: 'lat and lng are required and must be valid coordinates' };
  }

  let maxRadiusKm = DEFAULT_MAX_RADIUS_KM;
  if (query.maxRadiusKm !== undefined) {
    maxRadiusKm = Number(query.maxRadiusKm);
    if (!Number.isFinite(maxRadiusKm) || maxRadiusKm <= 0) {
      return { ok: false, error: 'maxRadiusKm must be a positive number' };
    }
    if (maxRadiusKm > MAX_SEARCH_RADIUS_KM) {
      return { ok: false, error: `maxRadiusKm must be at most ${MAX_SEARCH_RADIUS_KM}` };
    }
  }

  return { ok: true, lat, lng, maxRadiusKm };
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Rough lat/lng box around (lat, lng) sized to radiusKm, used as an indexable
 * SQL prefilter before the exact Haversine check. Longitude degrees shrink with
 * latitude; cos is clamped near the poles.
 */
export function boundingBox(lat: number, lng: number, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / KM_PER_DEG_LAT;
  const lngDelta = radiusKm / (KM_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export interface NearbyVendor {
  id: string;
  storeName: string;
  latitude: number;
  longitude: number;
  deliveryRadiusKm: number;
  /** Rounded to 2 decimal places. */
  distanceKm: number;
}

/**
 * APPROVED, open vendors that are within BOTH their own delivery radius and the
 * caller's search cap, nearest first.
 */
export async function findNearbyVendors(
  lat: number,
  lng: number,
  maxRadiusKm: number,
): Promise<NearbyVendor[]> {
  // Bounding box first so we don't scan every vendor row.
  const box = boundingBox(lat, lng, maxRadiusKm);

  const candidates = await prisma.vendor.findMany({
    where: {
      status: 'APPROVED',
      isOpen: true,
      latitude: { gte: box.minLat, lte: box.maxLat },
      longitude: { gte: box.minLng, lte: box.maxLng },
    },
    select: {
      id: true,
      storeName: true,
      latitude: true,
      longitude: true,
      deliveryRadiusKm: true,
    },
  });

  return candidates
    .map((v) => ({ ...v, distanceKm: haversineKm(lat, lng, v.latitude, v.longitude) }))
    // must be inside both the vendor's own delivery radius and the search cap
    .filter((v) => v.distanceKm <= Math.min(v.deliveryRadiusKm, maxRadiusKm))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((v) => ({ ...v, distanceKm: Math.round(v.distanceKm * 100) / 100 }));
}
