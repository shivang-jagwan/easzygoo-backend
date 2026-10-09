import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import { createCoupon, createCustomer, createProduct, createVendor, createZone } from './helpers/seed';

/*
 * Real concurrency: four requests are injected at once and their handlers
 * interleave at every await, each in its own DB transaction against Postgres.
 * Asserting on the final DB state, not just status codes, is the point.
 */

let t: TestApp;

beforeAll(async () => {
  await truncateAll();
  await createZone();
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});

describe('concurrent order creation', () => {
  it('sells the last unit exactly once', async () => {
    const vendor = await createVendor();
    const product = await createProduct(vendor.vendorId, { stockQty: 1 });
    const customers = await Promise.all([1, 2, 3, 4].map(() => createCustomer()));

    const results = await Promise.all(
      customers.map((c) =>
        t.request({
          method: 'POST',
          url: '/v1/orders',
          token: c.token,
          body: {
            vendorId: vendor.vendorId,
            addressId: c.addressId,
            items: [{ productId: product.id, quantity: 1 }],
          },
        }),
      ),
    );

    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409]);
    for (const r of results.filter((r) => r.statusCode === 409)) {
      expect(r.json().error).toBe('insufficient stock');
    }
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(0);
    expect(await prisma.order.count({ where: { vendorId: vendor.vendorId } })).toBe(1);
  });

  it('hands a single-use coupon to exactly one order and leaves losers’ stock untouched', async () => {
    const vendor = await createVendor();
    const product = await createProduct(vendor.vendorId, { stockQty: 10 });
    // perUserLimit null: only the global maxUses is under test here.
    const coupon = await createCoupon({ maxUses: 1, perUserLimit: null });
    const customers = await Promise.all([1, 2, 3, 4].map(() => createCustomer()));

    const results = await Promise.all(
      customers.map((c) =>
        t.request({
          method: 'POST',
          url: '/v1/orders',
          token: c.token,
          body: {
            vendorId: vendor.vendorId,
            addressId: c.addressId,
            couponCode: coupon.code,
            items: [{ productId: product.id, quantity: 2 }],
          },
        }),
      ),
    );

    const winners = results.filter((r) => r.statusCode === 201);
    const losers = results.filter((r) => r.statusCode !== 201);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(3);
    for (const r of losers) {
      // 409 if it lost inside the transaction, 400 if it saw usedCount=1 first.
      expect([400, 409]).toContain(r.statusCode);
      expect(r.json().error).toBe('coupon usage limit reached');
    }

    // Only the winner's 2 units left the shelf; losers rolled back completely.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(8);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    expect(await prisma.order.count({ where: { couponCode: coupon.code } })).toBe(1);
  });

  it('lets one customer redeem a per-user coupon once even when racing themselves', async () => {
    const vendor = await createVendor();
    const product = await createProduct(vendor.vendorId, { stockQty: 10 });
    const coupon = await createCoupon({ perUserLimit: 1 });
    const customer = await createCustomer();

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        t.request({
          method: 'POST',
          url: '/v1/orders',
          token: customer.token,
          body: {
            vendorId: vendor.vendorId,
            addressId: customer.addressId,
            couponCode: coupon.code,
            items: [{ productId: product.id, quantity: 1 }],
          },
        }),
      ),
    );

    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    for (const r of results.filter((r) => r.statusCode !== 201)) {
      expect(r.json().error).toBe('you have already used this coupon');
    }
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(9);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(1);
  });
});
