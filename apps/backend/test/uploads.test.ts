import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signCloudinaryParams } from '../src/routes/uploads';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import { createAdmin, createRider, createUser, createVendor } from './helpers/seed';

/*
 * POST /v1/uploads/sign: the folder is chosen server-side from the caller's
 * profile (or a per-user pending folder before onboarding), and is part of the
 * signature. Fake Cloudinary credentials come from test/setup-env.ts.
 */
const SECRET = 'test-secret-do-not-leak';

let t: TestApp;

beforeAll(async () => {
  await truncateAll();
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});

async function sign(token: string) {
  const res = await t.request({ method: 'POST', url: '/v1/uploads/sign', token });
  return res;
}

/** The payload is a valid signature over exactly { folder, timestamp }, and leaks no secret. */
function expectSignedFor(res: Awaited<ReturnType<typeof sign>>, folder: string) {
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.folder).toBe(folder);
  expect(body.apiKey).toBe('test-key');
  expect(body.cloudName).toBe('test-cloud');
  expect(Math.abs(body.timestamp - Date.now() / 1000)).toBeLessThan(60);
  expect(body.signature).toBe(signCloudinaryParams({ folder, timestamp: body.timestamp }, SECRET));
  expect(res.body).not.toContain(SECRET);
}

describe('folder per caller', () => {
  it('VENDOR without a profile signs into vendors/pending/<userId>', async () => {
    const user = await createUser('VENDOR');
    expectSignedFor(await sign(user.token), `easzygoo/vendors/pending/${user.id}`);
  });

  it('VENDOR with a profile signs into vendors/<vendorId>', async () => {
    const vendor = await createVendor({ status: 'PENDING' });
    expectSignedFor(await sign(vendor.token), `easzygoo/vendors/${vendor.vendorId}`);
  });

  it('RIDER without a profile signs into riders/pending/<userId>', async () => {
    const user = await createUser('RIDER');
    expectSignedFor(await sign(user.token), `easzygoo/riders/pending/${user.id}`);
  });

  it('RIDER with a profile signs into riders/<riderId>', async () => {
    const rider = await createRider({ status: 'PENDING' });
    expectSignedFor(await sign(rider.token), `easzygoo/riders/${rider.riderId}`);
  });

  it('a signature for one folder does not verify for another', async () => {
    const user = await createUser('RIDER');
    const body = (await sign(user.token)).json();
    const forged = signCloudinaryParams(
      { folder: 'easzygoo/riders/someone-else', timestamp: body.timestamp },
      SECRET,
    );
    expect(body.signature).not.toBe(forged);
  });
});

describe('refusals', () => {
  it.each([['CUSTOMER'], ['ADMIN']] as const)('%s gets 403', async (role) => {
    const user = role === 'ADMIN' ? await createAdmin() : await createUser(role);
    const res = await sign(user.token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Only vendors and riders can upload files' });
  });

  it('503 when Cloudinary is not configured', async () => {
    const saved = process.env.CLOUDINARY_API_SECRET;
    process.env.CLOUDINARY_API_SECRET = '';
    try {
      const res = await sign((await createUser('VENDOR')).token);
      expect(res.statusCode).toBe(503);
    } finally {
      process.env.CLOUDINARY_API_SECRET = saved;
    }
  });
});
