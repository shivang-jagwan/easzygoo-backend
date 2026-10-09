import type { FastifyInstance } from 'fastify';
import { DiscountType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth-middleware';
import { maskBankDetails } from '../lib/pii';
import { prismaRead } from '../lib/prismaRead';
import { getNotificationsDlq } from '../lib/queue';

/** Most dead-lettered jobs GET /admin/dlq returns, newest first. */
const DLQ_PAGE_SIZE = 50;

/*
 * Admin approval routes. Every route here is ADMIN-only.
 *
 * Note: no route anywhere in the API creates an ADMIN user — phone OTP signup
 * can only ever produce CUSTOMER / VENDOR / RIDER (see routes/auth.ts). Admins
 * are promoted by hand in the database.
 *
 * Vendor and Rider both start at PENDING after onboarding; approve/reject only
 * act on PENDING rows, so an already-decided profile can't be flipped here.
 */

const ADMIN_ONLY = { preHandler: [requireAuth, requireRole('ADMIN')] };

const DISCOUNT_TYPES = Object.values(DiscountType);

/** Indian pincodes are six digits. Zones are matched to Address.pincode exactly. */
const PINCODE_RE = /^\d{6}$/;

const DECISIONS = [
  ['approve', 'APPROVED'],
  ['reject', 'REJECTED'],
] as const;

export default async function adminRoutes(app: FastifyInstance) {
  // 1. GET /v1/admin/vendors/pending
  // Admin lists read from the replica (lib/prismaRead.ts); the approve/reject
  // writes below stay on the primary.
  app.get('/admin/vendors/pending', ADMIN_ONLY, async () => {
    const vendors = await prismaRead.vendor.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { phone: true } } },
    });
    // Bank details are masked even for admins — see lib/pii.ts.
    return vendors.map(({ user, ...v }) => ({ ...maskBankDetails(v), phone: user.phone }));
  });

  // 4. GET /v1/admin/riders/pending
  app.get('/admin/riders/pending', ADMIN_ONLY, async () => {
    const riders = await prismaRead.rider.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { phone: true } } },
    });
    return riders.map(({ user, ...r }) => ({ ...maskBankDetails(r), phone: user.phone }));
  });

  // POST /v1/admin/coupons — minimal creation endpoint so coupons can be
  // exercised end to end. No listing/editing yet.
  app.post('/admin/coupons', ADMIN_ONLY, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code) {
      return reply.code(400).send({ error: 'code is required' });
    }

    if (
      typeof body.discountType !== 'string' ||
      !DISCOUNT_TYPES.includes(body.discountType as DiscountType)
    ) {
      return reply
        .code(400)
        .send({ error: `discountType must be one of ${DISCOUNT_TYPES.join(', ')}` });
    }
    const discountType = body.discountType as DiscountType;

    if (typeof body.discountValue !== 'number' || body.discountValue <= 0) {
      return reply.code(400).send({ error: 'discountValue must be a positive number' });
    }

    let minOrderValue: number | null = null;
    if (body.minOrderValue !== undefined && body.minOrderValue !== null) {
      if (typeof body.minOrderValue !== 'number' || body.minOrderValue < 0) {
        return reply.code(400).send({ error: 'minOrderValue must be a non-negative number' });
      }
      minOrderValue = body.minOrderValue;
    }

    let maxUses: number | null = null;
    if (body.maxUses !== undefined && body.maxUses !== null) {
      if (typeof body.maxUses !== 'number' || !Number.isInteger(body.maxUses) || body.maxUses <= 0) {
        return reply.code(400).send({ error: 'maxUses must be a positive integer' });
      }
      maxUses = body.maxUses;
    }

    // Per-customer cap: 1 (default) or null for uncapped. Anything above 1 is
    // refused because CouponRedemption is unique on (couponId, userId), so a
    // second redemption by the same customer could never be recorded.
    let perUserLimit: number | null = 1;
    if (body.perUserLimit !== undefined) {
      if (body.perUserLimit !== null && body.perUserLimit !== 1) {
        return reply
          .code(400)
          .send({ error: 'perUserLimit must be 1 or null (no per-customer limit)' });
      }
      perUserLimit = body.perUserLimit;
    }

    const validFrom = new Date(String(body.validFrom));
    const validUntil = new Date(String(body.validUntil));
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      return reply
        .code(400)
        .send({ error: 'validFrom and validUntil are required ISO date strings' });
    }
    if (validUntil <= validFrom) {
      return reply.code(400).send({ error: 'validUntil must be after validFrom' });
    }

    const existing = await prisma.coupon.findUnique({ where: { code } });
    if (existing) {
      return reply.code(400).send({ error: 'A coupon with this code already exists' });
    }

    try {
      const coupon = await prisma.coupon.create({
        data: {
          code,
          discountType,
          discountValue: body.discountValue,
          minOrderValue,
          maxUses,
          perUserLimit,
          validFrom,
          validUntil,
        },
      });
      return reply.code(201).send(coupon);
    } catch (err) {
      // Concurrent create with the same code raced past the pre-check.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(400).send({ error: 'A coupon with this code already exists' });
      }
      throw err;
    }
  });

  // GET /v1/admin/zones — every service zone, active or not.
  app.get('/admin/zones', ADMIN_ONLY, async () => {
    return prismaRead.serviceZone.findMany({ orderBy: { pincode: 'asc' } });
  });

  /**
   * GET /v1/admin/dlq — the latest dead-lettered notification jobs, newest
   * first: payload, failure reason and attempt count, for inspection/replay.
   */
  app.get('/admin/dlq', ADMIN_ONLY, async (_request, reply) => {
    const dlq = getNotificationsDlq();
    if (!dlq) {
      return reply.code(503).send({ error: 'Queues are not configured (REDIS_URL unset)' });
    }
    const jobs = await dlq.getJobs(['waiting'], 0, DLQ_PAGE_SIZE - 1, false);
    return jobs.map((job) => ({ id: job.id, ...job.data }));
  });

  /**
   * POST /v1/admin/zones — create or update the zone for a pincode.
   *
   * A pincode is deliverable only while it has an active zone, and the zone's
   * baseDeliveryFee is what POST /v1/orders charges. Deactivate rather than
   * delete, so past pricing stays inspectable.
   */
  app.post('/admin/zones', ADMIN_ONLY, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    const pincode = typeof body.pincode === 'string' ? body.pincode.trim() : '';
    if (!PINCODE_RE.test(pincode)) {
      return reply.code(400).send({ error: 'pincode must be a 6-digit string' });
    }

    if (
      typeof body.baseDeliveryFee !== 'number' ||
      !Number.isFinite(body.baseDeliveryFee) ||
      body.baseDeliveryFee < 0
    ) {
      return reply.code(400).send({ error: 'baseDeliveryFee must be a non-negative number' });
    }
    const baseDeliveryFee = body.baseDeliveryFee;

    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return reply.code(400).send({ error: 'isActive must be a boolean' });
    }
    const isActive = body.isActive ?? true;

    const existing = await prisma.serviceZone.findUnique({ where: { pincode }, select: { id: true } });
    const zone = await prisma.serviceZone.upsert({
      where: { pincode },
      create: { pincode, baseDeliveryFee, isActive },
      update: { baseDeliveryFee, isActive },
    });
    return reply.code(existing ? 200 : 201).send(zone);
  });

  for (const [action, next] of DECISIONS) {
    // 2 & 3. PATCH /v1/admin/vendors/:id/approve | /reject
    app.patch<{ Params: { id: string } }>(
      `/admin/vendors/:id/${action}`,
      ADMIN_ONLY,
      async (request, reply) => {
        const vendor = await prisma.vendor.findUnique({
          where: { id: request.params.id },
          select: { id: true, status: true },
        });
        if (!vendor) {
          return reply.code(404).send({ error: 'Vendor not found' });
        }
        if (vendor.status !== 'PENDING') {
          return reply.code(400).send({
            error: `Vendor is not pending review (current status: ${vendor.status})`,
            currentStatus: vendor.status,
          });
        }

        // Guarded update so two admins deciding at once can't both win.
        const done = await prisma.vendor.updateMany({
          where: { id: vendor.id, status: 'PENDING' },
          data: { status: next },
        });
        if (done.count === 0) {
          return reply
            .code(409)
            .send({ error: 'Vendor status changed before the decision was applied' });
        }

        const updated = await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } });
        return maskBankDetails(updated);
      },
    );

    // 5 & 6. PATCH /v1/admin/riders/:id/approve | /reject
    app.patch<{ Params: { id: string } }>(
      `/admin/riders/:id/${action}`,
      ADMIN_ONLY,
      async (request, reply) => {
        const rider = await prisma.rider.findUnique({
          where: { id: request.params.id },
          select: { id: true, status: true },
        });
        if (!rider) {
          return reply.code(404).send({ error: 'Rider not found' });
        }
        if (rider.status !== 'PENDING') {
          return reply.code(400).send({
            error: `Rider is not pending review (current status: ${rider.status})`,
            currentStatus: rider.status,
          });
        }

        const done = await prisma.rider.updateMany({
          where: { id: rider.id, status: 'PENDING' },
          data: { status: next },
        });
        if (done.count === 0) {
          return reply
            .code(409)
            .send({ error: 'Rider status changed before the decision was applied' });
        }

        const updated = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
        return maskBankDetails(updated);
      },
    );
  }
}
