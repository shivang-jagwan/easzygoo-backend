import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import { createCustomer, createUser } from './helpers/seed';

/*
 * The only suite with rate limiting on. Each test uses its own remoteAddress
 * so the per-IP buckets never bleed between tests. In-memory store (no Redis
 * in tests); the Redis store is the same plugin with a different backend.
 */
let t: TestApp;

beforeAll(async () => {
  await truncateAll();
  t = await makeApp({ rateLimit: true });
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});

describe('POST /v1/auth/verify — 10 per minute per IP', () => {
  it('serves 10 and refuses the 11th with 429 { error }', async () => {
    const user = await createUser('CUSTOMER');
    const codes: number[] = [];
    let last;
    for (let i = 0; i < 11; i++) {
      last = await t.request({
        method: 'POST',
        url: '/v1/auth/verify',
        token: user.token,
        body: {},
        remoteAddress: '203.0.113.10',
      });
      codes.push(last.statusCode);
    }
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(codes[10]).toBe(429);
    expect(Object.keys(last!.json())).toEqual(['error']);
    expect(last!.headers['retry-after']).toBeDefined();

    // A different IP has its own bucket.
    const other = await t.request({
      method: 'POST',
      url: '/v1/auth/verify',
      token: user.token,
      body: {},
      remoteAddress: '203.0.113.11',
    });
    expect(other.statusCode).toBe(200);
  });

  it('counts failed attempts too (brute force is still limited)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await t.request({
        method: 'POST',
        url: '/v1/auth/verify',
        token: 'not-a-valid-token', // every attempt fails auth, and still counts
        remoteAddress: '203.0.113.20',
      });
      codes.push(res.statusCode);
    }
    expect(codes[10]).toBe(429);
  });
});

describe('POST /v1/orders — 10 per minute per customer', () => {
  it('limits per user, not per IP', async () => {
    const alice = await createCustomer();
    const bob = await createCustomer();
    const send = (token: string) =>
      t.request({ method: 'POST', url: '/v1/orders', token, body: {}, remoteAddress: '203.0.113.30' });

    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await send(alice.token)).statusCode);
    // Invalid body, so each is a 400 — but each still counts.
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(400));
    expect(codes[10]).toBe(429);

    // Same IP, different customer: not limited.
    expect((await send(bob.token)).statusCode).toBe(400);
  });
});

describe('discovery — 30 per minute per IP', () => {
  it('limits /v1/search', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) {
      codes.push(
        (await t.request({ method: 'GET', url: '/v1/search', remoteAddress: '203.0.113.40' })).statusCode,
      );
    }
    expect(codes.slice(0, 30).every((c) => c === 400)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});
