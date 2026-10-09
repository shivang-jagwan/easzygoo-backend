import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuthError, verifyBearerToken } from '../lib/auth-middleware';
import { RATE_LIMITS, perIp } from '../lib/rate-limits';

// Roles a client may self-assign at signup. ADMIN is never grantable here.
const SIGNUP_ROLES: Role[] = [Role.CUSTOMER, Role.VENDOR, Role.RIDER];

const userView = { id: true, role: true, name: true } as const;

export default async function authRoutes(app: FastifyInstance) {
  /**
   * POST /v1/auth/verify — login + signup in one call.
   *
   * Intentionally NOT behind `requireAuth`: that middleware requires the User row
   * to already exist, which this endpoint is what creates.
   *
   * - Verifies the Firebase ID token (same logic as requireAuth, via verifyBearerToken).
   * - Existing user  -> returns it; any `role` in the body is ignored.
   * - New user       -> needs body.role in {CUSTOMER, VENDOR, RIDER}; creates the
   *                     row from the token's uid + phone_number.
   *
   * No custom JWT is issued — clients keep sending the Firebase ID token as the
   * bearer token on every other route.
   */
  // Rate limited per IP: this is the one unauthenticated write, and the
  // natural target for token-stuffing and signup spam.
  app.post('/auth/verify', { config: perIp(RATE_LIMITS.authVerify) }, async (request, reply) => {
    let decoded;
    try {
      decoded = await verifyBearerToken(request);
    } catch (err) {
      const e = err as AuthError;
      return reply.code(e.statusCode).send({ error: e.message });
    }

    const existing = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
      select: userView,
    });
    if (existing) {
      // role can't be changed through this endpoint — ignore anything in the body
      return existing;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const role = body.role;
    if (typeof role !== 'string' || !SIGNUP_ROLES.includes(role as Role)) {
      return reply
        .code(400)
        .send({ error: `role is required for new users and must be one of ${SIGNUP_ROLES.join(', ')}` });
    }

    const phone = decoded.phone_number;
    if (!phone) {
      return reply
        .code(400)
        .send({ error: 'Token has no phone number; cannot create account' });
    }

    try {
      const user = await prisma.user.create({
        data: { firebaseUid: decoded.uid, phone, role: role as Role },
        select: userView,
      });
      return reply.code(201).send(user);
    } catch (err) {
      // Concurrent first request for the same token won the race — return that row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await prisma.user.findUnique({
          where: { firebaseUid: decoded.uid },
          select: userView,
        });
        if (raced) return raced;
        return reply.code(409).send({ error: 'Phone number already registered' });
      }
      throw err;
    }
  });
}
