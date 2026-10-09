import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth-middleware';
import { maskBankDetails } from '../lib/pii';
import { recordRiderLocation } from '../lib/rider-location';
import { emitRiderLocation } from '../lib/socket';

/*
 * The signed-in rider: profile, shift availability, location, own deliveries.
 * Onboarding (POST /riders/onboard) lives in routes/onboarding.ts; claiming and
 * completing deliveries in routes/order-lifecycle.ts.
 */

const RIDER_ONLY = { preHandler: [requireAuth, requireRole('RIDER')] };

/** History is newest-first and capped; a rider app shows recent deliveries, not an archive. */
const MAX_HISTORY_ORDERS = 50;

/** The caller's Rider row (id + status), or a 404 when they have not onboarded. */
async function getOwnRider(request: FastifyRequest, reply: FastifyReply) {
  const rider = await prisma.rider.findUnique({
    where: { userId: request.authUser!.userId },
    select: { id: true, status: true },
  });
  if (!rider) {
    reply.code(404).send({ error: 'No rider profile yet; complete onboarding first' });
    return null;
  }
  return rider;
}

/**
 * What a rider sees per delivery: where to pick up, where to drop, what is in
 * the bag, and how much cash to collect for COD. Never the customer's phone.
 */
const riderOrderSelect = {
  id: true,
  status: true,
  paymentMethod: true,
  total: true,
  placedAt: true,
  deliveredAt: true,
  vendor: { select: { storeName: true, address: true, latitude: true, longitude: true } },
  address: {
    select: {
      label: true,
      line1: true,
      line2: true,
      city: true,
      pincode: true,
      latitude: true,
      longitude: true,
    },
  },
  items: { select: { quantity: true, product: { select: { name: true } } } },
} satisfies Prisma.OrderSelect;

export default async function riderAccountRoutes(app: FastifyInstance) {
  /**
   * 1. GET /v1/riders/me — same contract as GET /vendors/me: a rider who has
   * signed up but not onboarded is a normal state, answered 200 with
   * { onboarded: false } rather than 404.
   */
  app.get('/riders/me', RIDER_ONLY, async (request) => {
    const rider = await prisma.rider.findUnique({
      where: { userId: request.authUser!.userId },
    });
    if (!rider) {
      return { onboarded: false };
    }
    return { onboarded: true, rider: maskBankDetails(rider) };
  });

  /**
   * 2. PATCH /v1/riders/me/availability — go on / off shift. Only APPROVED
   * riders can be available; claiming an order requires isAvailable.
   */
  app.patch('/riders/me/availability', RIDER_ONLY, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body.isAvailable !== 'boolean') {
      return reply.code(400).send({ error: 'isAvailable must be a boolean' });
    }

    const rider = await getOwnRider(request, reply);
    if (!rider) return;
    if (rider.status !== 'APPROVED') {
      return reply.code(403).send({ error: 'rider not approved' });
    }

    // Guarded on status so a suspension that lands mid-request wins.
    const done = await prisma.rider.updateMany({
      where: { id: rider.id, status: 'APPROVED' },
      data: { isAvailable: body.isAvailable },
    });
    if (done.count === 0) {
      return reply.code(409).send({ error: 'Rider status changed before the update was applied' });
    }

    const updated = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    return maskBankDetails(updated);
  });

  /**
   * 3. PATCH /v1/riders/me/location — the HTTP equivalent of the socket's
   * `rider:location`, for when the app reports from the background.
   *
   * Same rules as the socket path: the DB write goes through the shared
   * throttle in lib/rider-location.ts, and if the rider has an order out for
   * delivery the position is rebroadcast to that order's room (unthrottled).
   * Only APPROVED riders report location — nobody else has a reason to be
   * tracked.
   */
  app.patch('/riders/me/location', RIDER_ONLY, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { lat, lng } = body;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return reply.code(400).send({ error: 'lat must be a number between -90 and 90' });
    }
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return reply.code(400).send({ error: 'lng must be a number between -180 and 180' });
    }

    const rider = await getOwnRider(request, reply);
    if (!rider) return;
    if (rider.status !== 'APPROVED') {
      return reply.code(403).send({ error: 'rider not approved' });
    }

    const active = await prisma.order.findFirst({
      where: { riderId: rider.id, status: 'OUT_FOR_DELIVERY' },
      select: { id: true },
    });
    if (active) {
      emitRiderLocation(active.id, lat, lng);
    }

    const persisted = recordRiderLocation(rider.id, lat, lng);
    return { persisted, activeOrderId: active?.id ?? null };
  });

  /**
   * 4. GET /v1/riders/me/orders?status=active|history
   *
   * active (default): the delivery currently OUT_FOR_DELIVERY (at most one,
   * see the claim cap). history: everything else this rider was assigned,
   * newest first, capped at MAX_HISTORY_ORDERS.
   */
  app.get<{ Querystring: { status?: string } }>(
    '/riders/me/orders',
    RIDER_ONLY,
    async (request, reply) => {
      const mode = request.query.status?.trim() || 'active';
      if (mode !== 'active' && mode !== 'history') {
        return reply.code(400).send({ error: 'status must be active or history' });
      }

      const rider = await getOwnRider(request, reply);
      if (!rider) return;

      const status: Prisma.EnumOrderStatusFilter =
        mode === 'active'
          ? { equals: 'OUT_FOR_DELIVERY' satisfies OrderStatus }
          : { not: 'OUT_FOR_DELIVERY' satisfies OrderStatus };

      return prisma.order.findMany({
        where: { riderId: rider.id, status },
        orderBy: { placedAt: 'desc' },
        take: mode === 'history' ? MAX_HISTORY_ORDERS : undefined,
        select: riderOrderSelect,
      });
    },
  );
}
