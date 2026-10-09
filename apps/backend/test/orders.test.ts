import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import {
  createCoupon,
  createCustomer,
  createProduct,
  createVendor,
  createZone,
  northOf,
} from './helpers/seed';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

let t: TestApp;

beforeAll(async () => {
  await truncateAll();
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await createZone(); // the default pincode is deliverable unless a test says otherwise
});

const placeOrder = (token: string, body: Record<string, unknown>) =>
  t.request({ method: 'POST', url: '/v1/orders', token, body });

describe('POST /v1/orders — refusals', () => {
  it('rejects a closed store', async () => {
    const vendor = await createVendor({ isOpen: false });
    const product = await createProduct(vendor.vendorId);
    const customer = await createCustomer();

    const res = await placeOrder(customer.token, {
      vendorId: vendor.vendorId,
      addressId: customer.addressId,
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'store is closed' });
  });

  it('rejects an address outside the store delivery radius', async () => {
    const vendor = await createVendor({ deliveryRadiusKm: 3 });
    const product = await createProduct(vendor.vendorId);
    const customer = await createCustomer(northOf(5));

    const res = await placeOrder(customer.token, {
      vendorId: vendor.vendorId,
      addressId: customer.addressId,
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "address is outside this store's delivery area" });
  });

  it('rejects a pincode with no active service zone', async () => {
    const vendor = await createVendor();
    const product = await createProduct(vendor.vendorId);
    const noZone = await createCustomer({ pincode: '560099' });
    await createZone('560098', '25.00', false); // inactive zone counts as none
    const inactiveZone = await createCustomer({ pincode: '560098' });

    for (const customer of [noZone, inactiveZone]) {
      const res = await placeOrder(customer.token, {
        vendorId: vendor.vendorId,
        addressId: customer.addressId,
        items: [{ productId: product.id, quantity: 1 }],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "we don't deliver to this pincode yet" });
    }
  });

  it('rejects a cart that mixes two vendors', async () => {
    const a = await createVendor();
    const b = await createVendor();
    const pa = await createProduct(a.vendorId);
    const pb = await createProduct(b.vendorId);
    const customer = await createCustomer();

    const res = await placeOrder(customer.token, {
      vendorId: a.vendorId,
      addressId: customer.addressId,
      items: [
        { productId: pa.id, quantity: 1 },
        { productId: pb.id, quantity: 1 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'single-vendor cart: all products must belong to the same vendor',
      productIds: [pb.id],
    });
  });

  it('rejects a duplicate productId', async () => {
    const vendor = await createVendor();
    const product = await createProduct(vendor.vendorId);
    const customer = await createCustomer();

    const res = await placeOrder(customer.token, {
      vendorId: vendor.vendorId,
      addressId: customer.addressId,
      items: [
        { productId: product.id, quantity: 1 },
        { productId: product.id, quantity: 2 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('duplicate productId in items; merge quantities before sending');
  });

  it('rejects insufficient stock with a 409 listing each short product', async () => {
    const vendor = await createVendor();
    const short = await createProduct(vendor.vendorId, { stockQty: 2, name: 'Okra' });
    const fine = await createProduct(vendor.vendorId, { stockQty: 50 });
    const customer = await createCustomer();

    const res = await placeOrder(customer.token, {
      vendorId: vendor.vendorId,
      addressId: customer.addressId,
      items: [
        { productId: short.id, quantity: 3 },
        { productId: fine.id, quantity: 1 },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'insufficient stock',
      products: [
        {
          productId: short.id,
          name: 'Okra',
          reason: 'insufficient stock',
          requested: 3,
          available: 2,
        },
      ],
    });
    // Nothing was decremented.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fine.id } })).stockQty).toBe(50);
  });

  it('enforces item and quantity caps, and refuses ONLINE payment', async () => {
    const vendor = await createVendor();
    const product = await createProduct(vendor.vendorId);
    const customer = await createCustomer();
    const base = { vendorId: vendor.vendorId, addressId: customer.addressId };

    const tooMany = await placeOrder(customer.token, {
      ...base,
      items: Array.from({ length: 51 }, (_, i) => ({ productId: `p${i}`, quantity: 1 })),
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error).toBe('an order can have at most 50 items');

    const tooMuch = await placeOrder(customer.token, {
      ...base,
      items: [{ productId: product.id, quantity: 51 }],
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error).toBe('each item quantity must be at most 50');

    const online = await placeOrder(customer.token, {
      ...base,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'ONLINE',
    });
    expect(online.statusCode).toBe(400);
    expect(online.json()).toEqual({ error: 'online payment not available yet' });
  });
});

describe('POST /v1/orders — success', () => {
  it('computes totals with exact decimal maths and decrements stock', async () => {
    await createZone('560001', '25.50');
    const vendor = await createVendor();
    const a = await createProduct(vendor.vendorId, { price: '40.50', stockQty: 10 });
    const b = await createProduct(vendor.vendorId, { price: '12.25', stockQty: 10 });
    // 0.10 * 3 + 0.20 is 0.5000000000000001 in floating point; must be exactly 0.50.
    const c = await createProduct(vendor.vendorId, { price: '0.10', stockQty: 10 });
    const d = await createProduct(vendor.vendorId, { price: '0.20', stockQty: 10 });
    const coupon = await createCoupon({ discountType: 'PERCENT', discountValue: '10' });
    const customer = await createCustomer();

    const res = await placeOrder(customer.token, {
      vendorId: vendor.vendorId,
      addressId: customer.addressId,
      couponCode: coupon.code,
      items: [
        { productId: a.id, quantity: 3 }, // 121.50
        { productId: b.id, quantity: 2 }, //  24.50
        { productId: c.id, quantity: 3 }, //   0.30
        { productId: d.id, quantity: 1 }, //   0.20
      ],
    });
    expect(res.statusCode).toBe(201);
    const order = res.json();

    // subtotal 146.50; 10% = 14.65; fee 25.50; total 146.50 + 25.50 - 14.65 = 157.35
    expect(D(order.subtotal).equals('146.50')).toBe(true);
    expect(D(order.discount).equals('14.65')).toBe(true);
    expect(D(order.deliveryFee).equals('25.50')).toBe(true);
    expect(D(order.total).equals('157.35')).toBe(true);
    expect(order.status).toBe('PLACED');
    expect(order.paymentMethod).toBe('COD');
    expect(order.couponCode).toBe(coupon.code);

    const lines = Object.fromEntries(
      order.items.map((i: { productId: string; lineTotal: string; unitPrice: string }) => [
        i.productId,
        i,
      ]),
    );
    expect(D(lines[c.id].lineTotal).equals('0.30')).toBe(true);
    expect(D(lines[a.id].unitPrice).equals('40.50')).toBe(true);

    // The persisted row agrees with the response.
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.total.equals(D('157.35'))).toBe(true);

    const stock = await prisma.product.findMany({
      where: { id: { in: [a.id, b.id, c.id, d.id] } },
      select: { id: true, stockQty: true },
    });
    expect(Object.fromEntries(stock.map((s) => [s.id, s.stockQty]))).toEqual({
      [a.id]: 7,
      [b.id]: 8,
      [c.id]: 7,
      [d.id]: 9,
    });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
  });

  it('never discounts below the delivery fee (FLAT coupon larger than subtotal)', async () => {
    const vendor = await createVendor();
    const p = await createProduct(vendor.vendorId, { price: '30.00' });
    const coupon = await createCoupon({ discountType: 'FLAT', discountValue: '100' });
    const customer = await createCustomer();

    const res = await placeOrder(customer.token, {
      vendorId: vendor.vendorId,
      addressId: customer.addressId,
      couponCode: coupon.code,
      items: [{ productId: p.id, quantity: 1 }],
    });
    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(D(order.discount).equals('30')).toBe(true);
    expect(D(order.total).equals(order.deliveryFee)).toBe(true);
  });
});
