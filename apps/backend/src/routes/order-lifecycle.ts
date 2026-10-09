import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth-middleware';
import { emitOrderStatus } from '../lib/socket';
import { notifyUser } from '../lib/notify';
import { boundingBox, haversineKm, parseGeoParams } from '../lib/geo';

/** Riders only see pickups within this distance of where they are. */
const RIDER_PICKUP_RADIUS_KM = 5;
/** Most orders returned to a rider in one available-orders call. */
const MAX_AVAILABLE_ORDERS = 20;

/** Thrown inside the claim transaction; mapped to an HTTP status by the route. */
class ClaimRefusedError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ClaimRefusedError';
  }
}

/*
 * Order state machine
 * -------------------
 *   PLACED ──▶ ACCEPTED ──▶ PREPARING ──▶ READY_FOR_PICKUP ──▶ OUT_FOR_DELIVERY ──▶ DELIVERED
 *      │           │            │
 *      └───────────┴────────────┴──▶ CANCELLED
 *
 * Who drives each edge:
 *   vendor  PLACED→ACCEPTED, ACCEPTED→PREPARING, PREPARING→READY_FOR_PICKUP,
 *           and →CANCELLED from PLACED / ACCEPTED / PREPARING
 *   rider   READY_FOR_PICKUP→OUT_FOR_DELIVERY (claim), OUT_FOR_DELIVERY→DELIVERED
 *   customer PLACED→CANCELLED only
 *
 * CANCELLED is unreachable once the order is OUT_FOR_DELIVERY — a rider already
 * has the goods. Cancelling restores the stock that order creation decremented.
 */

const VENDOR_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PLACED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
};

const VENDOR_TARGETS: OrderStatus[] = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'CANCELLED'];

/** The rider's edges: claim (READY_FOR_PICKUP -> OUT_FOR_DELIVERY) and drop-off. */
const RIDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  READY_FOR_PICKUP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
};

/** The customer's only edge: cancel before the vendor accepts. */
const CUSTOMER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PLACED: ['CANCELLED'],
};

/**
 * Every refused transition, for every actor, is a 400 of this one shape, so a
 * client can always show what *is* possible from here (allowedNext may be []).
 */
function invalidTransition(
  reply: FastifyReply,
  from: OrderStatus,
  to: OrderStatus,
  transitions: Partial<Record<OrderStatus, OrderStatus[]>>,
  hint?: string,
) {
  return reply.code(400).send({
    error: `Invalid transition: ${from} -> ${to}${hint ? `. ${hint}` : ''}`,
    currentStatus: from,
    requestedStatus: to,
    allowedNext: transitions[from] ?? [],
  });
}

/** Resolve the Vendor row for the authenticated vendor, or send 403. */
async function getOwnVendor(request: FastifyRequest, reply: FastifyReply) {
  const vendor = await prisma.vendor.findUnique({
    where: { userId: request.authUser!.userId },
    select: { id: true },
  });
  if (!vendor) {
    reply.code(403).send({ error: 'No vendor profile linked to this account' });
    return null;
  }
  return vendor;
}

/** Resolve the Rider row for the authenticated rider, or send 403. */
async function getOwnRider(request: FastifyRequest, reply: FastifyReply) {
  const rider = await prisma.rider.findUnique({
    where: { userId: request.authUser!.userId },
    select: { id: true, status: true, isAvailable: true },
  });
  if (!rider) {
    reply.code(403).send({ error: 'No rider profile linked to this account' });
    return null;
  }
  return rider;
}

/**
 * Cancel an order and put its stock back, in one transaction. Shared by the
 * vendor-status CANCELLED path and the customer cancel route.
 *
 * The status guard lives in the UPDATE's WHERE clause, so two concurrent
 * cancels can't both restore stock — the loser matches 0 rows and gets null.
 */
async function cancelOrderRestoringStock(orderId: string, allowedFrom: OrderStatus[]) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: { in: allowedFrom } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (claimed.count === 0) {
      return null; // someone else moved the order first
    }

    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { productId: true, quantity: true },
    });
    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQty: { increment: item.quantity } },
      });
    }

    // A cancelled order gives its coupon use back, in this same transaction as
    // the stock: the global usedCount goes down (never below 0), and the
    // customer's per-user redemption is removed so they can use it again.
    const { couponCode } = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { couponCode: true },
    });
    if (couponCode) {
      await tx.coupon.updateMany({
        where: { code: couponCode, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
      await tx.couponRedemption.deleteMany({ where: { orderId } });
    }

    return tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
  });
}

/**
 * Single exit point for every successful lifecycle transition: reload the order,
 * broadcast the new status to the `order:<id>` socket room, and return it.
 * Every route below returns through here so the emit is never forgotten.
 */
const CUSTOMER_STATUS_MESSAGE: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Your order was accepted by the store',
  PREPARING: 'Your order is being prepared',
  READY_FOR_PICKUP: 'Your order is packed and waiting for a rider',
  OUT_FOR_DELIVERY: 'Your order is out for delivery',
  DELIVERED: 'Your order was delivered',
  CANCELLED: 'Your order was cancelled',
};

async function finishOrderUpdate(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (order) {
    emitOrderStatus(order.id, order.status);

    // Socket covers a foregrounded app; the push covers everything else.
    const message = CUSTOMER_STATUS_MESSAGE[order.status];
    if (message) {
      await notifyUser(order.customerId, 'Order update', message, {
        orderId: order.id,
        status: order.status,
        type: 'ORDER_STATUS',
      });
    }
  }
  return order;
}

export default async function orderLifecycleRoutes(app: FastifyInstance) {
  // 1. PATCH /v1/orders/:id/vendor-status — vendor drives the prep pipeline
  app.patch<{ Params: { id: string } }>(
    '/orders/:id/vendor-status',
    { preHandler: [requireAuth, requireRole('VENDOR')] },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const target = body.status as OrderStatus;
      if (typeof body.status !== 'string' || !VENDOR_TARGETS.includes(target)) {
        return reply
          .code(400)
          .send({ error: `status must be one of ${VENDOR_TARGETS.join(', ')}` });
      }

      const vendor = await getOwnVendor(request, reply);
      if (!vendor) return;

      const order = await prisma.order.findUnique({ where: { id: request.params.id } });
      if (!order) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (order.vendorId !== vendor.id) {
        return reply.code(403).send({ error: 'This order belongs to another vendor' });
      }

      if (!(VENDOR_TRANSITIONS[order.status] ?? []).includes(target)) {
        return invalidTransition(reply, order.status, target, VENDOR_TRANSITIONS);
      }

      if (target === 'CANCELLED') {
        const cancelled = await cancelOrderRestoringStock(order.id, ['PLACED', 'ACCEPTED', 'PREPARING']);
        if (!cancelled) {
          return reply.code(409).send({ error: 'Order status changed before it could be cancelled' });
        }
        return finishOrderUpdate(order.id);
      }

      const updated = await prisma.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: target },
      });
      if (updated.count === 0) {
        return reply.code(409).send({ error: 'Order status changed before it could be updated' });
      }

      return finishOrderUpdate(order.id);
    },
  );

  /**
   * 2. GET /v1/riders/available-orders?lat=&lng= — unclaimed orders ready for
   * pickup near the rider.
   *
   * Only APPROVED riders may browse, and only pickups within
   * RIDER_PICKUP_RADIUS_KM of the rider's position are returned — nearest
   * first, at most MAX_AVAILABLE_ORDERS. Riders never see the whole city's
   * order book.
   */
  app.get<{ Querystring: { lat?: string; lng?: string } }>(
    '/riders/available-orders',
    { preHandler: [requireAuth, requireRole('RIDER')] },
    async (request, reply) => {
      const rider = await getOwnRider(request, reply);
      if (!rider) return;
      if (rider.status !== 'APPROVED') {
        return reply.code(403).send({ error: 'rider not approved' });
      }

      // Only lat/lng are taken from the query; the radius is fixed server-side.
      const geo = parseGeoParams({ lat: request.query.lat, lng: request.query.lng });
      if (!geo.ok) {
        return reply.code(400).send({ error: geo.error });
      }

      // Indexable box prefilter on the vendor's position, exact distance below.
      const box = boundingBox(geo.lat, geo.lng, RIDER_PICKUP_RADIUS_KM);
      const candidates = await prisma.order.findMany({
        where: {
          status: 'READY_FOR_PICKUP',
          riderId: null,
          vendor: {
            latitude: { gte: box.minLat, lte: box.maxLat },
            longitude: { gte: box.minLng, lte: box.maxLng },
          },
        },
        select: {
          id: true,
          total: true,
          placedAt: true,
          vendor: {
            select: { storeName: true, address: true, latitude: true, longitude: true },
          },
          address: { select: { latitude: true, longitude: true } },
        },
      });

      return candidates
        .map((o) => ({
          id: o.id,
          total: o.total,
          placedAt: o.placedAt,
          pickup: o.vendor,
          dropoff: o.address,
          distanceKm: haversineKm(geo.lat, geo.lng, o.vendor.latitude, o.vendor.longitude),
        }))
        .filter((o) => o.distanceKm <= RIDER_PICKUP_RADIUS_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, MAX_AVAILABLE_ORDERS)
        .map((o) => ({ ...o, distanceKm: Math.round(o.distanceKm * 100) / 100 }));
    },
  );

  // 3. POST /v1/orders/:id/claim — first rider to claim wins
  app.post<{ Params: { id: string } }>(
    '/orders/:id/claim',
    { preHandler: [requireAuth, requireRole('RIDER')] },
    async (request, reply) => {
      const rider = await getOwnRider(request, reply);
      if (!rider) return;

      // A rider must be approved by an admin before taking any delivery.
      if (rider.status !== 'APPROVED') {
        return reply.code(403).send({ error: 'rider not approved' });
      }
      // ...and must have marked themselves available (on shift).
      if (!rider.isAvailable) {
        return reply.code(403).send({ error: 'rider is not marked available' });
      }

      const orderId = request.params.id;
      const existing = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true, riderId: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      // Already taken is a conflict (another rider won); any other wrong state
      // is an invalid transition. The atomic claim below still decides races.
      if (existing.riderId !== null) {
        return reply.code(409).send({ error: 'order already claimed or not ready for pickup' });
      }
      if (existing.status !== 'READY_FOR_PICKUP') {
        return invalidTransition(reply, existing.status, 'OUT_FOR_DELIVERY', RIDER_TRANSITIONS);
      }

      try {
        await prisma.$transaction(async (tx) => {
          // Lock this rider's row so two concurrent claims by the SAME rider
          // run one after the other; otherwise both could pass the active-order
          // check below and the rider would end up with two deliveries.
          const locked = await tx.$queryRaw<{ isAvailable: boolean }[]>`
            SELECT "isAvailable" FROM "Rider" WHERE id = ${rider.id} FOR UPDATE`;
          if (!locked[0]?.isAvailable) {
            throw new ClaimRefusedError(403, 'rider is not marked available');
          }

          // One delivery at a time: a rider with an order already out for
          // delivery must finish it before claiming another.
          const active = await tx.order.count({
            where: { riderId: rider.id, status: 'OUT_FOR_DELIVERY' },
          });
          if (active > 0) {
            throw new ClaimRefusedError(409, 'rider already has an active delivery');
          }

          // Atomic claim: riderId/status conditions are in the WHERE clause, so
          // only one of N concurrent riders can match a row.
          const claimed = await tx.order.updateMany({
            where: { id: orderId, riderId: null, status: 'READY_FOR_PICKUP' },
            data: { riderId: rider.id, status: 'OUT_FOR_DELIVERY' },
          });
          if (claimed.count === 0) {
            throw new ClaimRefusedError(409, 'order already claimed or not ready for pickup');
          }
        });
      } catch (err) {
        if (err instanceof ClaimRefusedError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }

      return finishOrderUpdate(orderId);
    },
  );

  // 4. PATCH /v1/orders/:id/delivered — rider completes the drop-off
  app.patch<{ Params: { id: string } }>(
    '/orders/:id/delivered',
    { preHandler: [requireAuth, requireRole('RIDER')] },
    async (request, reply) => {
      const rider = await getOwnRider(request, reply);
      if (!rider) return;

      const order = await prisma.order.findUnique({ where: { id: request.params.id } });
      if (!order) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (order.riderId !== rider.id) {
        return reply.code(403).send({ error: 'This order is assigned to another rider' });
      }
      if (order.status !== 'OUT_FOR_DELIVERY') {
        return invalidTransition(reply, order.status, 'DELIVERED', RIDER_TRANSITIONS);
      }

      const updated = await prisma.order.updateMany({
        where: { id: order.id, riderId: rider.id, status: 'OUT_FOR_DELIVERY' },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
      if (updated.count === 0) {
        return reply.code(409).send({ error: 'Order status changed before it could be updated' });
      }

      return finishOrderUpdate(order.id);
    },
  );

  // 5. PATCH /v1/orders/:id/cancel — customer, only before the vendor accepts
  app.patch<{ Params: { id: string } }>(
    '/orders/:id/cancel',
    { preHandler: [requireAuth, requireRole('CUSTOMER')] },
    async (request, reply) => {
      const order = await prisma.order.findUnique({ where: { id: request.params.id } });
      if (!order) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (order.customerId !== request.authUser!.userId) {
        return reply.code(403).send({ error: 'This order belongs to another account' });
      }
      if (order.status !== 'PLACED') {
        return invalidTransition(
          reply,
          order.status,
          'CANCELLED',
          CUSTOMER_TRANSITIONS,
          'Once a vendor has accepted the order, cancellation goes through the vendor.',
        );
      }

      const cancelled = await cancelOrderRestoringStock(order.id, ['PLACED']);
      if (!cancelled) {
        return reply.code(409).send({ error: 'Order status changed before it could be cancelled' });
      }
      return finishOrderUpdate(order.id);
    },
  );
}
