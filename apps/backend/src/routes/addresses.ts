import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../lib/auth-middleware';

/*
 * Delivery addresses. Not role-restricted — Address hangs off User, so any
 * authenticated account manages its own.
 *
 * Invariant: once a user has any address, exactly one of them is the default.
 * Enforced on create (the first address is forced default), on update, and on
 * delete (removing the default promotes the next most recent).
 */

/** The transactional client handed to a $transaction callback. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Clear isDefault on every other address belonging to this user. */
async function clearOtherDefaults(tx: Tx, userId: string, exceptId?: string): Promise<void> {
  await tx.address.updateMany({
    where: { userId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export default async function addressRoutes(app: FastifyInstance) {
  // 1. POST /v1/addresses
  app.post('/addresses', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.userId;
    const body = (request.body ?? {}) as Record<string, unknown>;

    const line1 = typeof body.line1 === 'string' ? body.line1.trim() : '';
    if (!line1) {
      return reply.code(400).send({ error: 'line1 is required' });
    }

    const city = typeof body.city === 'string' ? body.city.trim() : '';
    if (!city) {
      return reply.code(400).send({ error: 'city is required' });
    }

    const pincode = typeof body.pincode === 'string' ? body.pincode.trim() : '';
    if (!pincode) {
      return reply.code(400).send({ error: 'pincode is required' });
    }

    if (typeof body.latitude !== 'number' || body.latitude < -90 || body.latitude > 90) {
      return reply
        .code(400)
        .send({ error: 'latitude is required and must be a number between -90 and 90' });
    }
    if (typeof body.longitude !== 'number' || body.longitude < -180 || body.longitude > 180) {
      return reply
        .code(400)
        .send({ error: 'longitude is required and must be a number between -180 and 180' });
    }

    if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
      return reply.code(400).send({ error: 'isDefault must be a boolean' });
    }

    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
    const line2 = typeof body.line2 === 'string' && body.line2.trim() ? body.line2.trim() : null;

    // A user's first address is always the default, whatever the body asked for.
    const existingCount = await prisma.address.count({ where: { userId } });
    const isDefault = body.isDefault === true || existingCount === 0;

    const data = {
      userId,
      label,
      line1,
      line2,
      city,
      pincode,
      latitude: body.latitude,
      longitude: body.longitude,
      isDefault,
    };

    if (!isDefault) {
      const created = await prisma.address.create({ data });
      return reply.code(201).send(created);
    }

    const address = await prisma.$transaction(async (tx) => {
      await clearOtherDefaults(tx, userId);
      return tx.address.create({ data });
    });
    return reply.code(201).send(address);
  });

  // 2. GET /v1/addresses/mine — registered before /:id so the static path wins
  app.get('/addresses/mine', { preHandler: [requireAuth] }, async (request) => {
    return prisma.address.findMany({
      where: { userId: request.authUser!.userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  });

  // 3. PUT /v1/addresses/:id
  app.put<{ Params: { id: string } }>(
    '/addresses/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.authUser!.userId;

      const address = await prisma.address.findUnique({ where: { id: request.params.id } });
      if (!address) {
        return reply.code(404).send({ error: 'Address not found' });
      }
      if (address.userId !== userId) {
        return reply.code(403).send({ error: 'This address belongs to another account' });
      }

      const body = (request.body ?? {}) as Record<string, unknown>;
      const data: Prisma.AddressUpdateInput = {};

      if (body.label !== undefined) {
        data.label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
      }
      if (body.line2 !== undefined) {
        data.line2 = typeof body.line2 === 'string' && body.line2.trim() ? body.line2.trim() : null;
      }

      for (const field of ['line1', 'city', 'pincode'] as const) {
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

      let promoteToDefault = false;
      if (body.isDefault !== undefined) {
        if (typeof body.isDefault !== 'boolean') {
          return reply.code(400).send({ error: 'isDefault must be a boolean' });
        }
        // Refuse to unset the only default rather than leaving the user with
        // none — they promote a different address instead.
        if (body.isDefault === false && address.isDefault) {
          return reply
            .code(400)
            .send({ error: 'Set another address as default instead of unsetting this one' });
        }
        data.isDefault = body.isDefault;
        promoteToDefault = body.isDefault === true;
      }

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'No updatable fields provided' });
      }

      if (!promoteToDefault) {
        return prisma.address.update({ where: { id: address.id }, data });
      }

      return prisma.$transaction(async (tx) => {
        await clearOtherDefaults(tx, userId, address.id);
        return tx.address.update({ where: { id: address.id }, data });
      });
    },
  );

  // 4. DELETE /v1/addresses/:id
  app.delete<{ Params: { id: string } }>(
    '/addresses/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.authUser!.userId;

      const address = await prisma.address.findUnique({ where: { id: request.params.id } });
      if (!address) {
        return reply.code(404).send({ error: 'Address not found' });
      }
      if (address.userId !== userId) {
        return reply.code(403).send({ error: 'This address belongs to another account' });
      }

      // Order.address is a required relation with no onDelete rule, so Postgres
      // restricts the delete. Refuse cleanly instead of surfacing a raw FK
      // error, and keep past orders pointing at the address they shipped to.
      const orderCount = await prisma.order.count({ where: { addressId: address.id } });
      if (orderCount > 0) {
        return reply.code(409).send({
          error: 'Address is used by existing orders and cannot be deleted',
          orderCount,
        });
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.address.delete({ where: { id: address.id } });

          // Removing the default promotes the next most recent address, so the
          // "exactly one default" invariant survives.
          if (address.isDefault) {
            const next = await tx.address.findFirst({
              where: { userId },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            if (next) {
              await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
            }
          }
        });
      } catch (err) {
        // Lost a race with an order created between the count and the delete.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          return reply
            .code(409)
            .send({ error: 'Address is used by existing orders and cannot be deleted' });
        }
        throw err;
      }

      return { id: address.id, deleted: true };
    },
  );
}
