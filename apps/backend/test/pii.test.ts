import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import { createAdmin, createRider, createUser, createVendor } from './helpers/seed';

/*
 * Full bank numbers and IFSCs must never appear in any response body. Checked
 * against the raw body text, so a field leaking under any name is caught.
 */
const ACCOUNT = '123456789012';
const IFSC = 'HDFC0001234';

let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  await truncateAll();
  t = await makeApp();
  adminToken = (await createAdmin()).token;
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});

function expectNoBankDetails(body: string) {
  expect(body).not.toContain(ACCOUNT);
  expect(body).not.toContain(IFSC);
  expect(body).not.toContain('bankAccountNumber');
  expect(body).not.toContain('bankIfsc');
}

describe('bank details are masked', () => {
  it('admin pending vendor list', async () => {
    await createVendor({ status: 'PENDING', bankAccountNumber: ACCOUNT, bankIfsc: IFSC });
    const res = await t.request({ method: 'GET', url: '/v1/admin/vendors/pending', token: adminToken });
    expect(res.statusCode).toBe(200);
    expectNoBankDetails(res.body);
    expect(res.json()[0].bankAccountLast4).toBe('9012');
  });

  it('admin pending rider list', async () => {
    await createRider({ status: 'PENDING', bankAccountNumber: ACCOUNT, bankIfsc: IFSC });
    const res = await t.request({ method: 'GET', url: '/v1/admin/riders/pending', token: adminToken });
    expect(res.statusCode).toBe(200);
    expectNoBankDetails(res.body);
    expect(res.json()[0].bankAccountLast4).toBe('9012');
  });

  it('admin approve responses', async () => {
    const v = await createVendor({ status: 'PENDING', bankAccountNumber: ACCOUNT, bankIfsc: IFSC });
    const r = await createRider({ status: 'PENDING', bankAccountNumber: ACCOUNT, bankIfsc: IFSC });
    for (const url of [`/v1/admin/vendors/${v.vendorId}/approve`, `/v1/admin/riders/${r.riderId}/approve`]) {
      const res = await t.request({ method: 'PATCH', url, token: adminToken });
      expect(res.statusCode).toBe(200);
      expectNoBankDetails(res.body);
    }
  });

  it('GET /v1/vendors/me', async () => {
    const v = await createVendor({ bankAccountNumber: ACCOUNT, bankIfsc: IFSC });
    const res = await t.request({ method: 'GET', url: '/v1/vendors/me', token: v.token });
    expect(res.statusCode).toBe(200);
    expectNoBankDetails(res.body);
    expect(res.json().vendor.bankAccountLast4).toBe('9012');
  });

  it('GET /v1/riders/me', async () => {
    const r = await createRider({ bankAccountNumber: ACCOUNT, bankIfsc: IFSC });
    const res = await t.request({ method: 'GET', url: '/v1/riders/me', token: r.token });
    expect(res.statusCode).toBe(200);
    expectNoBankDetails(res.body);
  });

  it('onboarding and bank-update responses echo only the last 4 digits', async () => {
    const vendorUser = await createUser('VENDOR');
    const onboard = await t.request({
      method: 'POST',
      url: '/v1/vendors/onboard',
      token: vendorUser.token,
      body: {
        storeName: 'Fresh Mart',
        address: '3 Main Rd',
        pincode: '560001',
        latitude: 12.97,
        longitude: 77.59,
        bankAccountNumber: ACCOUNT,
        bankIfsc: IFSC,
      },
    });
    expect(onboard.statusCode).toBe(201);
    expectNoBankDetails(onboard.body);

    const bank = await t.request({
      method: 'PUT',
      url: '/v1/vendors/me/bank',
      token: vendorUser.token,
      body: { bankAccountNumber: '987654321098', bankIfsc: 'icic0004321' },
    });
    expect(bank.statusCode).toBe(200);
    expect(bank.body).not.toContain('987654321098');
    expect(bank.body).not.toContain('ICIC0004321');
    expect(bank.json().bankAccountLast4).toBe('1098');

    // Stored in full (and upper-cased) for payouts.
    const row = await prisma.vendor.findUniqueOrThrow({ where: { userId: vendorUser.id } });
    expect(row.bankAccountNumber).toBe('987654321098');
    expect(row.bankIfsc).toBe('ICIC0004321');

    const riderUser = await createUser('RIDER');
    const riderOnboard = await t.request({
      method: 'POST',
      url: '/v1/riders/onboard',
      token: riderUser.token,
      body: {
        vehicleType: 'bike',
        vehicleNumber: 'KA01AB1234',
        idProofUrl: 'https://example.test/id.jpg',
        bankAccountNumber: ACCOUNT,
        bankIfsc: IFSC,
      },
    });
    expect(riderOnboard.statusCode).toBe(201);
    expectNoBankDetails(riderOnboard.body);
  });
});
