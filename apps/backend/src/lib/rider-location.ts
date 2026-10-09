import { prisma } from './prisma';

/*
 * Rider location persistence, shared by the Socket.io `rider:location` handler
 * and PATCH /v1/riders/me/location so both paths throttle identically.
 *
 * Broadcasting is the caller's job and is never throttled — only the DB write
 * is, because a rider streams a fix every second or two and Rider.currentLat/Lng
 * only needs to be roughly current.
 */

/** At most one Rider location write per this many ms, per rider. */
export const LOCATION_WRITE_THROTTLE_MS = 5000;

const lastLocationWrite = new Map<string, number>();

/**
 * Persists the rider's position unless one was written in the last
 * LOCATION_WRITE_THROTTLE_MS. Fire-and-forget: never awaits the DB, so it
 * cannot delay or reorder the caller. Returns whether a write was started.
 *
 * Throttle state is per process, so under a PM2 cluster each instance throttles
 * on its own — at worst one write per rider per interval per instance.
 */
export function recordRiderLocation(riderId: string, lat: number, lng: number): boolean {
  const now = Date.now();
  const last = lastLocationWrite.get(riderId) ?? 0;
  if (now - last < LOCATION_WRITE_THROTTLE_MS) return false;

  lastLocationWrite.set(riderId, now);
  void prisma.rider
    .update({ where: { id: riderId }, data: { currentLat: lat, currentLng: lng } })
    .catch((err) => console.error('[rider-location] write failed:', err.message));
  return true;
}

/**
 * Drop a rider's throttle entry, e.g. when their socket disconnects, so the map
 * holds only riders who are actually reporting. The next fix is then written
 * immediately, which is what a reconnecting rider wants anyway.
 */
export function forgetRider(riderId: string): void {
  lastLocationWrite.delete(riderId);
}
