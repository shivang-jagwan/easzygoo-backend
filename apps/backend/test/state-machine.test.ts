import type { OrderStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import {
  createCustomer,
  createOrderRow,
  createProduct,
  createRider,
  createVendor,
  createZone,
} from './helpers/seed';

/*
 * The order state machine, exhaustively: for each actor, every (from, to) pair
 * is tried. Valid pairs must succeed and land in `to`; every other pair must be
 * a 400 carrying allowedNext = exactly the edges that actor has from `from`.
 */

const ALL: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
];

const VENDOR: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PLACED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
};
const VENDOR_TARGETS: OrderStatus[] = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'CANCELLED'];
const RIDER: Partial<Record<OrderStatus, OrderStatus[]>> = {
  READY_FOR_PICKUP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
};
const CUSTOMER: Partial<Record<OrderStatus, OrderStatus[]>> = { PLACED: ['CANCELLED'] };

let t: TestApp;
let ctx: {
  vendor: Awaited<ReturnType<typeof createVendor>>;
  customer: Awaited<ReturnType<typeof createCustomer>>;
  rider: Awaited<ReturnType<typeof createRider>>;
  productId: string;
};

beforeAll(async () => {
  await truncateAll();
  await createZone();
  t = await makeApp();
  const vendor = await createVendor();
  const product = await createProduct(vendor.vendorId, { stockQty: 1000 });
  ctx = {
    vendor,
    customer: await createCustomer(),
    rider: await createRider({ isAvailable: true }),
    productId: product.id,
  };
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});

/** A fresh order sitting in `status`; assigned to the test rider where that makes sense. */
async function orderIn(status: OrderStatus) {
  const riderOwned = status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED';
  return createOrderRow({
    customerId: ctx.customer.id,
    addressId: ctx.customer.addressId,
    vendorId: ctx.vendor.vendorId,
    productId: ctx.productId,
    status,
    riderId: riderOwned ? ctx.rider.riderId : null,
  });
}

async function expectStatus(id: string, status: OrderStatus) {
  expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe(status);
}

describe('vendor transitions', () => {
  const cases = ALL.flatMap((from) => VENDOR_TARGETS.map((to) => ({ from, to })));

  it.each(cases)('$from -> $to', async ({ from, to }) => {
    const order = await orderIn(from);
    const res = await t.request({
      method: 'PATCH',
      url: `/v1/orders/${order.id}/vendor-status`,
      token: ctx.vendor.token,
      body: { status: to },
    });
    const allowed = VENDOR[from] ?? [];
    if (allowed.includes(to)) {
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(to);
      await expectStatus(order.id, to);
    } else {
      expect(res.statusCode).toBe(400);
      expect(res.json().allowedNext).toEqual(allowed);
      expect(res.json().currentStatus).toBe(from);
      await expectStatus(order.id, from);
    }
  });
});

describe('rider transitions', () => {
  it.each(ALL)('claim from %s', async (from) => {
    // Rider must be free of other deliveries for a valid claim to be allowed.
    await prisma.order.updateMany({
      where: { riderId: ctx.rider.riderId, status: 'OUT_FOR_DELIVERY' },
      data: { status: 'DELIVERED' },
    });
    const order = await createOrderRow({
      customerId: ctx.customer.id,
      addressId: ctx.customer.addressId,
      vendorId: ctx.vendor.vendorId,
      productId: ctx.productId,
      status: from,
      riderId: null,
    });
    const res = await t.request({
      method: 'POST',
      url: `/v1/orders/${order.id}/claim`,
      token: ctx.rider.token,
    });
    if (from === 'READY_FOR_PICKUP') {
      expect(res.statusCode).toBe(200);
      await expectStatus(order.id, 'OUT_FOR_DELIVERY');
    } else {
      expect(res.statusCode).toBe(400);
      expect(res.json().allowedNext).toEqual(RIDER[from] ?? []);
      await expectStatus(order.id, from);
    }
  });

  it.each(ALL)('deliver from %s (assigned rider)', async (from) => {
    const order = await createOrderRow({
      customerId: ctx.customer.id,
      addressId: ctx.customer.addressId,
      vendorId: ctx.vendor.vendorId,
      productId: ctx.productId,
      status: from,
      riderId: ctx.rider.riderId,
    });
    const res = await t.request({
      method: 'PATCH',
      url: `/v1/orders/${order.id}/delivered`,
      token: ctx.rider.token,
    });
    if (from === 'OUT_FOR_DELIVERY') {
      expect(res.statusCode).toBe(200);
      expect(res.json().deliveredAt).not.toBeNull();
      await expectStatus(order.id, 'DELIVERED');
    } else {
      expect(res.statusCode).toBe(400);
      expect(res.json().allowedNext).toEqual(RIDER[from] ?? []);
      await expectStatus(order.id, from);
    }
  });
});

describe('customer transitions', () => {
  it.each(ALL)('cancel from %s', async (from) => {
    const order = await orderIn(from);
    const res = await t.request({
      method: 'PATCH',
      url: `/v1/orders/${order.id}/cancel`,
      token: ctx.customer.token,
    });
    if (from === 'PLACED') {
      expect(res.statusCode).toBe(200);
      await expectStatus(order.id, 'CANCELLED');
    } else {
      expect(res.statusCode).toBe(400);
      expect(res.json().allowedNext).toEqual(CUSTOMER[from] ?? []);
      await expectStatus(order.id, from);
    }
  });
});

describe('cancellation restores stock', () => {
  it('puts every unit back, exactly once', async () => {
    const product = await createProduct(ctx.vendor.vendorId, { stockQty: 10 });
    const placed = await t.request({
      method: 'POST',
      url: '/v1/orders',
      token: ctx.customer.token,
      body: {
        vendorId: ctx.vendor.vendorId,
        addressId: ctx.customer.addressId,
        items: [{ productId: product.id, quantity: 4 }],
      },
    });
    expect(placed.statusCode).toBe(201);
    const id = placed.json().id;

    // Two cancels at once: only one may restore stock.
    const [a, b] = await Promise.all([
      t.request({ method: 'PATCH', url: `/v1/orders/${id}/cancel`, token: ctx.customer.token }),
      t.request({
        method: 'PATCH',
        url: `/v1/orders/${id}/vendor-status`,
        token: ctx.vendor.token,
        body: { status: 'CANCELLED' },
      }),
    ]);
    // Exactly one wins. The loser either lost the guarded UPDATE (409) or read
    // the order after the winner committed and saw CANCELLED (400) — both fine.
    const codes = [a.statusCode, b.statusCode];
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect([400, 409]).toContain(codes.find((c) => c !== 200));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(10);
  });
});
