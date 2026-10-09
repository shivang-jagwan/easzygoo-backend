import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../lib/auth-middleware';

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
/** Deliberately loose: something@something.tld. Real verification would be a confirmation mail. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function userRoutes(app: FastifyInstance) {
  /**
   * PATCH /v1/users/me — any signed-in account edits its own name and email.
   * Phone and role are not editable here: phone is the Firebase identity, and
   * role is fixed at signup.
   *
   * Send null to clear a field. Emails are stored lower-cased.
   */
  app.patch('/users/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data: Prisma.UserUpdateInput = {};

    if (body.name !== undefined) {
      if (body.name === null) {
        data.name = null;
      } else {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > MAX_NAME_LENGTH) {
          return reply
            .code(400)
            .send({ error: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters, or null` });
        }
        data.name = name;
      }
    }

    if (body.email !== undefined) {
      if (body.email === null) {
        data.email = null;
      } else {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
          return reply.code(400).send({ error: 'email must be a valid email address, or null' });
        }
        data.email = email;
      }
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'No updatable fields provided' });
    }

    return prisma.user.update({
      where: { id: request.authUser!.userId },
      data,
      select: { id: true, role: true, name: true, email: true },
    });
  });
}
