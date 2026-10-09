import type { Role } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app';
import { prisma, truncateAll } from './helpers/db';
import { createUser, type SeededUser } from './helpers/seed';

/*
 * Every route's access rule, in one table. The first test proves the table
 * covers exactly the routes the app registers, so a new route cannot ship
 * without being classified here.
 *
 *   public   no auth at all
 *   token    needs a valid token, but no User row / role (signup)
 *   any      any signed-in role (ownership is checked per resource)
 *   Role[]   only these roles; every other role gets 403
 */
type Access = 'public' | 'token' | 'any' | Role[];

const ROUTES: Record<string, Access> = {
  'GET /health': 'public',
  'GET /v1/categories': 'public',
  'GET /v1/vendors/nearby': 'public',
  'GET /v1/search': 'public',
  'GET /v1/vendors/:vendorId': 'public',
  'GET /v1/vendors/:vendorId/products': 'public',

  'POST /v1/auth/verify': 'token',

  'POST /v1/addresses': 'any',
  'GET /v1/addresses/mine': 'any',
  'PUT /v1/addresses/:id': 'any',
  'DELETE /v1/addresses/:id': 'any',
  'POST /v1/notifications/register-token': 'any',
  'GET /v1/orders/:id': 'any',
  'PATCH /v1/users/me': 'any',
  'POST /v1/uploads/sign': ['VENDOR', 'RIDER'],

  'GET /v1/admin/vendors/pending': ['ADMIN'],
  'GET /v1/admin/riders/pending': ['ADMIN'],
  'PATCH /v1/admin/vendors/:id/approve': ['ADMIN'],
  'PATCH /v1/admin/vendors/:id/reject': ['ADMIN'],
  'PATCH /v1/admin/riders/:id/approve': ['ADMIN'],
  'PATCH /v1/admin/riders/:id/reject': ['ADMIN'],
  'POST /v1/admin/coupons': ['ADMIN'],
  'GET /v1/admin/zones': ['ADMIN'],
  'POST /v1/admin/zones': ['ADMIN'],
  'GET /v1/admin/dlq': ['ADMIN'],
  'POST /v1/categories': ['ADMIN'],

  'POST /v1/vendors/onboard': ['VENDOR'],
  'GET /v1/vendors/me': ['VENDOR'],
  'PATCH /v1/vendors/me': ['VENDOR'],
  'PUT /v1/vendors/me/bank': ['VENDOR'],
  'GET /v1/vendors/me/orders': ['VENDOR'],
  'POST /v1/products': ['VENDOR'],
  'PUT /v1/products/:id': ['VENDOR'],
  'PATCH /v1/products/:id/stock': ['VENDOR'],
  'DELETE /v1/products/:id': ['VENDOR'],
  'PATCH /v1/orders/:id/vendor-status': ['VENDOR'],

  'POST /v1/riders/onboard': ['RIDER'],
  'GET /v1/riders/me': ['RIDER'],
  'PATCH /v1/riders/me/availability': ['RIDER'],
  'PATCH /v1/riders/me/location': ['RIDER'],
  'GET /v1/riders/me/orders': ['RIDER'],
  'GET /v1/riders/available-orders': ['RIDER'],
  'POST /v1/orders/:id/claim': ['RIDER'],
  'PATCH /v1/orders/:id/delivered': ['RIDER'],

  'POST /v1/orders': ['CUSTOMER'],
  'GET /v1/orders/mine': ['CUSTOMER'],
  'PATCH /v1/orders/:id/cancel': ['CUSTOMER'],
};

const ROLES: Role[] = ['CUSTOMER', 'VENDOR', 'RIDER', 'ADMIN'];

let t: TestApp;
const users = {} as Record<Role, SeededUser>;

beforeAll(async () => {
  await truncateAll();
  t = await makeApp();
  for (const role of ROLES) users[role] = await createUser(role);
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
});

const call = (route: string, token?: string) => {
  const [method, path] = route.split(' ');
  const url = path.replace(/:[A-Za-z]+/g, 'nonexistent-id');
  return t.request({ method: method as 'GET', url, token, body: method === 'GET' ? undefined : {} });
};

const guarded = Object.entries(ROUTES).filter(([, access]) => access !== 'public');
const roleGated = guarded.flatMap(([route, access]) =>
  Array.isArray(access)
    ? ROLES.filter((r) => !access.includes(r)).map((role) => ({ route, role }))
    : [],
);

it('the table covers every registered route, and nothing else', () => {
  const registered = t.routes.filter((r) => !r.startsWith('OPTIONS ')).sort();
  expect(registered).toEqual(Object.keys(ROUTES).sort());
});

describe('no token -> 401', () => {
  it.each(guarded.map(([route]) => route))('%s', async (route) => {
    const res = await call(route);
    expect(res.statusCode).toBe(401);
    expect(typeof res.json().error).toBe('string');
  });
});

describe('invalid token -> 401', () => {
  it.each(guarded.map(([route]) => route))('%s', async (route) => {
    const res = await call(route, 'not-a-real-token');
    expect(res.statusCode).toBe(401);
  });
});

describe('wrong role -> 403', () => {
  it.each(roleGated)('$route as $role', async ({ route, role }) => {
    const res = await call(route, users[role].token);
    expect(res.statusCode).toBe(403);
    expect(typeof res.json().error).toBe('string');
  });
});
