import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth-middleware';
import { maskBankDetails } from '../lib/pii';

/*
 * The signed-in vendor managing their own store: order queue, store settings,
 * bank details. Onboarding (POST /vendors/onboard, GET /vendors/me) lives in
 * routes/onboarding.ts; the public storefront detail lives in routes/discovery.ts.
 */

const VENDOR_ONLY = { preHandler: [requireAuth, requireRole('VENDOR')] };

/**
 * PENDING_PAYMENT orders are invisible to vendors in every listing: an unpaid
 * order is not an order the store should start packing.
 */
const VENDOR_VISIBLE_STATUSES: OrderStatus[] = Object.values(OrderStatus).filter(
  (s) => s !== OrderStatus.PENDING_PAYMENT,
);

/** The default queue view: orders that still need something to happen. */
const ACTIVE_VENDOR_STATUSES: OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const MIN_DELIVERY_RADIUS_KM = 1;
const MAX_DELIVERY_RADIUS_KM = 15;

/** 24-hour "HH:MM", e.g. "09:00" or "21:30". */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** RBI IFSC: 4 bank letters, a literal 0, then 6 branch characters. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers are 9–18 digits. */
const ACCOUNT_NUMBER_RE = /^\d{9,18}$/;

/** The caller's Vendor row (id + status), or a 404 when they have not onboarded. */
async function getOwnVendor(request: FastifyRequest, reply: FastifyReply) {
  const vendor = await prisma.vendor.findUnique({
    where: { userId: request.authUser!.userId },
    select: { id: true, status: true },
  });
  if (!vendor) {
    reply.code(404).send({ error: 'No vendor profile yet; complete onboarding first' });
    return null;
  }
  return vendor;
}

/** What a vendor sees for each order: items, and where it ships — never the customer's phone. */
const vendorOrderSelect = {
  id: true,
  status: true,
  paymentMethod: true,
  subtotal: true,
  deliveryFee: true,
  discount: true,
  total: true,
  couponCode: true,
  placedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  riderId: true,
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      product: { select: { name: true } },
    },
  },
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
} satisfies Prisma.OrderSelect;

interface VendorOrdersQuery {
  status?: string;
  cursor?: string;
  limit?: string;
}

export default async function vendorAccountRoutes(app: FastifyInstance) {
  /**
   * 1. GET /v1/vendors/me/orders?status=&cursor=&limit=
   *
   * Newest first, cursor-paginated on the order id. `status` is omitted or
   * "active" for the live queue, "all" for full history, or one specific
   * status. Returns { orders, nextCursor } — nextCursor is null on the last page.
   */
  app.get<{ Querystring: VendorOrdersQuery }>(
    '/vendors/me/orders',
    VENDOR_ONLY,
    async (request, reply) => {
      const vendor = await getOwnVendor(request, reply);
      if (!vendor) return;

      const statusParam = request.query.status?.trim() || 'active';
      let statuses: OrderStatus[];
      if (statusParam === 'active') {
        statuses = ACTIVE_VENDOR_STATUSES;
      } else if (statusParam === 'all') {
        statuses = VENDOR_VISIBLE_STATUSES;
      } else if (VENDOR_VISIBLE_STATUSES.includes(statusParam as OrderStatus)) {
        statuses = [statusParam as OrderStatus];
      } else {
        return reply.code(400).send({
          error: `status must be active, all, or one of ${VENDOR_VISIBLE_STATUSES.join(', ')}`,
        });
      }

      let limit = DEFAULT_PAGE_SIZE;
      if (request.query.limit !== undefined) {
        limit = Number(request.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
          return reply
            .code(400)
            .send({ error: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}` });
        }
      }

      // A cursor must be one of this vendor's own orders, so a page can never
      // be positioned using another store's order.
      const cursor = request.query.cursor?.trim() || undefined;
      if (cursor) {
        const owned = await prisma.order.findFirst({
          where: { id: cursor, vendorId: vendor.id },
          select: { id: true },
        });
        if (!owned) {
          return reply.code(400).send({ error: 'invalid cursor' });
        }
      }

      // One extra row tells us whether another page exists.
      const rows = await prisma.order.findMany({
        where: { vendorId: vendor.id, status: { in: statuses } },
        orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: vendorOrderSelect,
      });

      const hasMore = rows.length > limit;
      const orders = hasMore ? rows.slice(0, limit) : rows;
      return { orders, nextCursor: hasMore ? orders[orders.length - 1].id : null };
    },
  );

  /**
   * 2. PATCH /v1/vendors/me — store settings.
   *
   * Only an APPROVED store may change its settings: a PENDING/REJECTED/
   * SUSPENDED vendor must not be able to move its location or reopen itself
   * while under review. Bank details are the exception and have their own
   * route (PUT /vendors/me/bank) that works in any status.
   */
  app.patch('/vendors/me', VENDOR_ONLY, async (request, reply) => {
    const vendor = await getOwnVendor(request, reply);
    if (!vendor) return;
    if (vendor.status !== 'APPROVED') {
      return reply
        .code(403)
        .send({ error: 'Store settings can only be changed once the store is approved' });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const data: Prisma.VendorUpdateManyMutationInput = {};

    for (const field of ['storeName', 'address', 'pincode'] as const) {
      if (body[field] !== undefined) {
        const raw = body[field];
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) {
          return reply.code(400).send({ error: `${field} must be a non-empty string` });
        }
        data[field] = value;
      }
    }

    if (body.latitude !== undefined) {
      if (typeof body.latitude !== 'number' || body.latitude < -90 || body.latitude > 90) {
        return reply.code(400).send({ error: 'latitude must be a number between -90 and 90' });
      }
      data.latitude = body.latitude;
    }
    if (body.longitude !== undefined) {
      if (typeof body.longitude !== 'number' || body.longitude < -180 || body.longitude > 180) {
        return reply.code(400).send({ error: 'longitude must be a number between -180 and 180' });
      }
      data.longitude = body.longitude;
    }

    // Hours are "HH:MM" 24-hour, or null to clear. A close time earlier than
    // the open time is allowed — it means the store is open past midnight.
    for (const field of ['openTime', 'closeTime'] as const) {
      if (body[field] !== undefined) {
        const raw = body[field];
        if (raw !== null && (typeof raw !== 'string' || !HHMM_RE.test(raw))) {
          return reply.code(400).send({ error: `${field} must be "HH:MM" (24-hour) or null` });
        }
        data[field] = raw;
      }
    }

    if (body.isOpen !== undefined) {
      if (typeof body.isOpen !== 'boolean') {
        return reply.code(400).send({ error: 'isOpen must be a boolean' });
      }
      data.isOpen = body.isOpen;
    }

    // Delivery radius is capped so one store cannot claim a whole city.
    if (body.deliveryRadiusKm !== undefined) {
      if (
        typeof body.deliveryRadiusKm !== 'number' ||
        !Number.isFinite(body.deliveryRadiusKm) ||
        body.deliveryRadiusKm < MIN_DELIVERY_RADIUS_KM ||
        body.deliveryRadiusKm > MAX_DELIVERY_RADIUS_KM
      ) {
        return reply.code(400).send({
          error: `deliveryRadiusKm must be between ${MIN_DELIVERY_RADIUS_KM} and ${MAX_DELIVERY_RADIUS_KM}`,
        });
      }
      data.deliveryRadiusKm = body.deliveryRadiusKm;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'No updatable fields provided' });
    }

    // Guarded on status, so an admin suspending the store between the check
    // above and this write wins.
    const done = await prisma.vendor.updateMany({
      where: { id: vendor.id, status: 'APPROVED' },
      data,
    });
    if (done.count === 0) {
      return reply.code(409).send({ error: 'Store status changed before the update was applied' });
    }

    const updated = await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } });
    return maskBankDetails(updated);
  });

  /**
   * 3. PUT /v1/vendors/me/bank — set the payout account. Allowed in any status
   * so a vendor can fix bank details while still under review.
   */
  app.put('/vendors/me/bank', VENDOR_ONLY, async (request, reply) => {
    const vendor = await getOwnVendor(request, reply);
    if (!vendor) return;

    const body = (request.body ?? {}) as Record<string, unknown>;

    const accountNumber =
      typeof body.bankAccountNumber === 'string' ? body.bankAccountNumber.trim() : '';
    if (!ACCOUNT_NUMBER_RE.test(accountNumber)) {
      return reply.code(400).send({ error: 'bankAccountNumber must be 9 to 18 digits' });
    }

    // IFSC is case-insensitive in practice; store the canonical upper case.
    const ifsc = typeof body.bankIfsc === 'string' ? body.bankIfsc.trim().toUpperCase() : '';
    if (!IFSC_RE.test(ifsc)) {
      return reply.code(400).send({ error: 'bankIfsc must be a valid IFSC code, e.g. HDFC0001234' });
    }

    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        bankAccountNumber: accountNumber,
        bankIfsc: ifsc,
        // A Cashfree beneficiary is bound to the old account; drop it so the
        // next payout re-registers against the new one instead of paying the
        // old account.
        cashfreeBeneficiaryId: null,
      },
    });
    return maskBankDetails(updated);
  });
}
