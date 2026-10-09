import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import {
  BASE,
  createCustomer,
  createOrderRow,
  createProduct,
  createRider,
  createVendor,
  northOf,
} from './helpers/seed';

let t: TestApp;
let shop: Awaited<ReturnType<typeof createVendor>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;
let productId: string;

beforeAll(async () => {
  await truncateAll();
  t = await makeApp();
  shop = await createVendor();
  customer = await createCustomer();
  productId = (await createProduct(shop.vendorId)).id;
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});

const readyOrder = (vendorId = shop.vendorId, vendorProductId = productId) =>
  createOrderRow({
    customerId: customer.id,
    addressId: customer.addressId,
    vendorId,
    productId: vendorProductId,
    status: 'READY_FOR_PICKUP',
  });

const available = (token: string, at = BASE) =>
  t.request({
    method: 'GET',
    url: `/v1/riders/available-orders?lat=${at.lat}&lng=${at.lng}`,
    token,
  });
const claim = (token: string, orderId: string) =>
  t.request({ method: 'POST', url: `/v1/orders/${orderId}/claim`, token });

describe('unapproved riders', () => {
  it.each(['PENDING', 'REJECTED', 'SUSPENDED'] as const)(
    '%s rider gets 403 on available-orders and claim',
    async (status) => {
      const rider = await createRider({ status, isAvailable: true });
      const order = await readyOrder();

      const list = await available(rider.token);
      expect(list.statusCode).toBe(403);
      expect(list.json()).toEqual({ error: 'rider not approved' });

      const res = await claim(rider.token, order.id);
      expect(res.statusCode).toBe(403);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).riderId).toBeNull();
    },
  );
});

describe('claiming', () => {
  it('two riders racing for one order: one 200, one 409', async () => {
    const r1 = await createRider();
    const r2 = await createRider();
    const order = await readyOrder();

    const [a, b] = await Promise.all([claim(r1.token, order.id), claim(r2.token, order.id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const winner = a.statusCode === 200 ? r1 : r2;
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.riderId).toBe(winner.riderId);
    expect(row.status).toBe('OUT_FOR_DELIVERY');
  });

  it('requires the rider to be marked available', async () => {
    const rider = await createRider({ isAvailable: false });
    const res = await claim(rider.token, (await readyOrder()).id);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'rider is not marked available' });
  });

  it('caps a rider at one active delivery, even when they double-claim at once', async () => {
    const rider = await createRider();
    const [o1, o2] = [await readyOrder(), await readyOrder()];

    const [a, b] = await Promise.all([claim(rider.token, o1.id), claim(rider.token, o2.id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json()).toEqual({ error: 'rider already has an active delivery' });
    expect(await prisma.order.count({ where: { riderId: rider.riderId } })).toBe(1);
  });
});

describe('available-orders', () => {
  it('returns only pickups within 5 km, nearest first', async () => {
    await prisma.order.updateMany({ where: { status: 'READY_FOR_PICKUP' }, data: { status: 'CANCELLED' } });
    const near = await createVendor(northOf(1));
    const mid = await createVendor(northOf(4));
    const far = await createVendor(northOf(8));
    for (const v of [far, mid, near]) {
      const p = await createProduct(v.vendorId);
      await readyOrder(v.vendorId, p.id);
    }
    const rider = await createRider();

    const res = await available(rider.token);
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { pickup: { storeName: string }; distanceKm: number }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].distanceKm).toBeLessThan(rows[1].distanceKm);
    expect(rows.every((r) => r.distanceKm <= 5)).toBe(true);
  });

  it('caps the list at 20', async () => {
    await prisma.order.updateMany({ where: { status: 'READY_FOR_PICKUP' }, data: { status: 'CANCELLED' } });
    for (let i = 0; i < 23; i++) await readyOrder();
    const res = await available((await createRider()).token);
    expect(res.json()).toHaveLength(20);
  });

  it('requires lat and lng', async () => {
    const res = await t.request({
      method: 'GET',
      url: '/v1/riders/available-orders',
      token: (await createRider()).token,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/orders/:id for riders', () => {
  it('allows the assigned rider only', async () => {
    const assigned = await createRider();
    const other = await createRider();
    const order = await readyOrder();
    expect((await claim(assigned.token, order.id)).statusCode).toBe(200);

    const mine = await t.request({ method: 'GET', url: `/v1/orders/${order.id}`, token: assigned.token });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().id).toBe(order.id);

    const theirs = await t.request({ method: 'GET', url: `/v1/orders/${order.id}`, token: other.token });
    expect(theirs.statusCode).toBe(403);

    // An unclaimed order is not visible to riders at all.
    const unclaimed = await readyOrder();
    const peek = await t.request({ method: 'GET', url: `/v1/orders/${unclaimed.id}`, token: assigned.token });
    expect(peek.statusCode).toBe(403);
  });
});
