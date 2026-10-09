import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Role } from '@prisma/client';
import { verifyFirebaseToken } from './auth-middleware';
import { allowedOrigins, trustProxy } from './env';
import { isAllowedOrigin } from './origins';
import { prisma } from './prisma';
import { REDIS_PREFIX, createRedis } from './redis';
import { forgetRider, recordRiderLocation } from './rider-location';

/*
 * Real-time order tracking
 * ------------------------
 * Rooms: one per order, named `order:<orderId>`. A socket only ever joins a room
 * for an order it is a party to (customer, vendor, or assigned rider).
 *
 * Auth: the Firebase ID token goes in the handshake — io(url, { auth: { token } }).
 * It is verified with the same `verifyFirebaseToken` the HTTP routes use.
 *
 * Client -> server
 *   order:join       orderId                      join that order's room
 *   rider:location   { orderId, lat, lng }        RIDER assigned to the order only
 *
 * Server -> client
 *   order:status     { orderId, status, updatedAt }   emitted by order-lifecycle routes
 *   rider:location   { lat, lng, updatedAt }          rebroadcast to the order room
 *   error            { event, message }               join/emit refused
 *   auth:expired     { }                              token expired; server disconnects
 *
 * Token expiry: a Firebase ID token lives ~1 hour, and the handshake is the
 * only time it is checked. When it expires the server emits `auth:expired` and
 * disconnects, so a stale session cannot stay connected indefinitely. The
 * client should fetch a fresh token and reconnect.
 */

export interface SocketUser {
  userId: string;
  role: Role;
  /** Token expiry, seconds since the epoch. */
  tokenExp: number;
}

/** setTimeout's ceiling; a longer delay would fire immediately. */
const MAX_TIMER_MS = 2_147_483_647;

let io: Server | undefined;

/** The live Socket.io server, or undefined before initSocket() runs. */
export function getIo(): Server | undefined {
  return io;
}

/** Emit an order status change to everyone watching that order. No-op if sockets aren't up. */
export function emitOrderStatus(orderId: string, status: string): void {
  io?.to(`order:${orderId}`).emit('order:status', {
    orderId,
    status,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Rebroadcast a rider's position to everyone watching that order. Never
 * throttled — the throttle in lib/rider-location.ts applies to the DB write only.
 * Shared by the socket handler and PATCH /v1/riders/me/location.
 */
export function emitRiderLocation(orderId: string, lat: number, lng: number): void {
  io?.to(`order:${orderId}`).emit('rider:location', {
    lat,
    lng,
    updatedAt: new Date().toISOString(),
  });
}

/** True if this user is the order's customer, its vendor, or its assigned rider. */
async function canAccessOrder(user: SocketUser, orderId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { customerId: true, vendorId: true, riderId: true },
  });
  if (!order) return false;

  if (order.customerId === user.userId) return true;

  if (user.role === 'VENDOR') {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: user.userId },
      select: { id: true },
    });
    return vendor?.id === order.vendorId;
  }

  if (user.role === 'RIDER' && order.riderId) {
    const rider = await prisma.rider.findUnique({
      where: { userId: user.userId },
      select: { id: true },
    });
    return rider?.id === order.riderId;
  }

  return false;
}

/**
 * The authenticated rider's `Rider.id` if they are this order's assigned rider,
 * otherwise null. One round trip, both lookups in parallel.
 */
async function resolveAssignedRider(user: SocketUser, orderId: string): Promise<string | null> {
  const [order, rider] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, select: { riderId: true } }),
    prisma.rider.findUnique({ where: { userId: user.userId }, select: { id: true } }),
  ]);
  if (!order || !rider || order.riderId !== rider.id) return null;
  return rider.id;
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    // CORS headers only for allow-listed browser origins…
    cors: { origin: allowedOrigins },
    // …and the real gate: same origin rule as the HTTP API (lib/origins.ts).
    // Native clients (no Origin, or their own same-origin Origin) pass.
    allowRequest: (req, callback) => {
      const forwardedHost = trustProxy ? req.headers['x-forwarded-host'] : undefined;
      const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host;
      callback(null, isAllowedOrigin(req.headers.origin, host));
    },
  });

  // Redis adapter so emits reach clients connected to any backend instance
  // (the PM2 cluster / multiple Render instances). Channels live under the
  // `sock` prefix (lib/redis.ts). createRedis logs errors instead of throwing.
  const pubClient = createRedis('socket-pub');
  const subClient = createRedis('socket-sub');
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient, { key: REDIS_PREFIX.socket }));
  } else {
    console.warn('[socket] REDIS_URL not set — running without the Redis adapter (single instance only)');
  }

  // Handshake auth: verify the Firebase ID token, then resolve the User row.
  io.use(async (socket, next) => {
    try {
      const decoded = await verifyFirebaseToken(socket.handshake.auth?.token as string | undefined);
      const user = await prisma.user.findUnique({
        where: { firebaseUid: decoded.uid },
        select: { id: true, role: true },
      });
      if (!user) {
        return next(new Error('No account for this token'));
      }
      socket.data.user = {
        userId: user.id,
        role: user.role,
        tokenExp: decoded.exp,
      } satisfies SocketUser;
      next();
    } catch (err) {
      next(new Error(err instanceof Error ? err.message : 'Unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUser;

    // Disconnect when the handshake token expires (see header comment).
    const expiresInMs = Math.min(user.tokenExp * 1000 - Date.now(), MAX_TIMER_MS);
    const expiryTimer = setTimeout(() => {
      socket.emit('auth:expired', {});
      socket.disconnect(true);
    }, Math.max(expiresInMs, 0));

    socket.on('order:join', async (orderId: unknown) => {
      if (typeof orderId !== 'string' || !orderId) {
        socket.emit('error', { event: 'order:join', message: 'orderId is required' });
        return;
      }
      if (!(await canAccessOrder(user, orderId))) {
        socket.emit('error', { event: 'order:join', message: 'Not allowed to watch this order' });
        return;
      }
      await socket.join(`order:${orderId}`);
      socket.emit('order:joined', { orderId });
    });

    // orderId -> promise of the rider's own Rider.id for that order (null if not theirs).
    const orderAuth = new Map<string, Promise<string | null>>();
    // This socket's own Rider.id once any authorisation has resolved it.
    let ownRiderId: string | null = null;

    // Nothing per-connection may outlive the connection.
    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      orderAuth.clear();
      if (ownRiderId) forgetRider(ownRiderId);
    });

    socket.on('rider:location', async (payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const orderId = typeof p.orderId === 'string' ? p.orderId : '';
      const lat = typeof p.lat === 'number' ? p.lat : NaN;
      const lng = typeof p.lng === 'number' ? p.lng : NaN;

      if (!orderId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        socket.emit('error', { event: 'rider:location', message: 'orderId, lat and lng are required' });
        return;
      }
      if (user.role !== 'RIDER') {
        socket.emit('error', { event: 'rider:location', message: 'Only riders can report location' });
        return;
      }

      // Authorisation is memoised per socket as the in-flight *promise*, so a
      // burst of messages all await the same one and resume in FIFO order.
      // Without this, each message would race its own lookup and could overtake
      // the ones before it.
      let assigned = orderAuth.get(orderId);
      if (!assigned) {
        assigned = resolveAssignedRider(user, orderId);
        orderAuth.set(orderId, assigned);
      }
      const riderId = await assigned;
      if (riderId) ownRiderId = riderId;
      if (!riderId) {
        socket.emit('error', { event: 'rider:location', message: 'Not the assigned rider for this order' });
        return;
      }

      // Broadcast FIRST. Nothing below this line may delay or reorder it —
      // otherwise a message that happens to hit the DB write falls behind the
      // messages after it that skipped the write.
      emitRiderLocation(orderId, lat, lng);

      // Then persist, throttled per rider, fire-and-forget so it never blocks
      // this handler or the next message.
      recordRiderLocation(riderId, lat, lng);
    });
  });

  return io;
}

/**
 * Disconnect every client and stop the Socket.io engine. Used by graceful
 * shutdown; the HTTP server itself is closed by Fastify. The adapter's Redis
 * clients are quit with the rest by quitAllRedis().
 */
export async function closeSocket(): Promise<void> {
  if (!io) return;
  const server = io;
  io = undefined;
  server.disconnectSockets(true);
  await server.close();
}
