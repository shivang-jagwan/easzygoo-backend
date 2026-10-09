import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import { createCoupon, createCustomer, createProduct, createVendor, createZone } from './helpers/seed';

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

async function setup(couponOpts: Parameters<typeof createCoupon>[0] = {}) {
  const vendor = await createVendor();
  const product = await createProduct(vendor.vendorId, { stockQty: 20 });
  const coupon = await createCoupon(couponOpts);
  const order = (customer: { token: string; addressId: string }) =>
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
    });
  return { vendor, product, coupon, order };
}

const usedCount = async (id: string) =>
  (await prisma.coupon.findUniqueOrThrow({ where: { id } })).usedCount;
const redemptions = (couponId: string, userId: string) =>
  prisma.couponRedemption.count({ where: { couponId, userId } });

describe('per-user coupon limit', () => {
  it('allows one redemption per customer, and other customers are unaffected', async () => {
    const { coupon, order } = await setup({ perUserLimit: 1 });
    const alice = await createCustomer();
    const bob = await createCustomer();

    expect((await order(alice)).statusCode).toBe(201);
    const again = await order(alice);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'you have already used this coupon' });

    expect((await order(bob)).statusCode).toBe(201);
    expect(await usedCount(coupon.id)).toBe(2);
    expect(await redemptions(coupon.id, alice.id)).toBe(1);
  });

  it('records no redemption and allows reuse when perUserLimit is null', async () => {
    const { coupon, order } = await setup({ perUserLimit: null });
    const alice = await createCustomer();

    expect((await order(alice)).statusCode).toBe(201);
    expect((await order(alice)).statusCode).toBe(201);
    expect(await usedCount(coupon.id)).toBe(2);
    expect(await redemptions(coupon.id, alice.id)).toBe(0);
  });
});

describe('cancelling an order gives the coupon back', () => {
  it('customer cancel: usedCount and redemption restored, coupon reusable', async () => {
    const { coupon, product, order } = await setup({ perUserLimit: 1, maxUses: 5 });
    const alice = await createCustomer();

    const placed = await order(alice);
    expect(placed.statusCode).toBe(201);
    expect(await usedCount(coupon.id)).toBe(1);
    expect(await redemptions(coupon.id, alice.id)).toBe(1);

    const cancel = await t.request({
      method: 'PATCH',
      url: `/v1/orders/${placed.json().id}/cancel`,
      token: alice.token,
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('CANCELLED');

    expect(await usedCount(coupon.id)).toBe(0);
    expect(await redemptions(coupon.id, alice.id)).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(20);

    // The restored redemption means the same customer may use it again.
    expect((await order(alice)).statusCode).toBe(201);
  });

  it('vendor cancel: usedCount and redemption restored', async () => {
    const { coupon, vendor, order } = await setup({ perUserLimit: 1, maxUses: 5 });
    const alice = await createCustomer();
    const placed = await order(alice);
    expect(placed.statusCode).toBe(201);
    const id = placed.json().id;

    // Walk it forward first: vendors may cancel from ACCEPTED/PREPARING too.
    const accept = await t.request({
      method: 'PATCH',
      url: `/v1/orders/${id}/vendor-status`,
      token: vendor.token,
      body: { status: 'ACCEPTED' },
    });
    expect(accept.statusCode).toBe(200);

    const cancel = await t.request({
      method: 'PATCH',
      url: `/v1/orders/${id}/vendor-status`,
      token: vendor.token,
      body: { status: 'CANCELLED' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(await usedCount(coupon.id)).toBe(0);
    expect(await redemptions(coupon.id, alice.id)).toBe(0);
  });

  it('never drives usedCount below zero', async () => {
    const { coupon, order } = await setup({ perUserLimit: 1 });
    const alice = await createCustomer();
    const placed = await order(alice);
    // Simulate drift: someone zeroed the counter by hand.
    await prisma.coupon.update({ where: { id: coupon.id }, data: { usedCount: 0 } });

    const cancel = await t.request({
      method: 'PATCH',
      url: `/v1/orders/${placed.json().id}/cancel`,
      token: alice.token,
    });
    expect(cancel.statusCode).toBe(200);
    expect(await usedCount(coupon.id)).toBe(0);
  });
});
