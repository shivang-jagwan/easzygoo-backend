import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth-middleware';
import { maskBankDetails } from '../lib/pii';

/**
 * The vendor and rider profile: created once here, and read back here.
 * Both rows default to status PENDING (schema default) — admin approval is a
 * separate flow, not built yet.
 */
export default async function onboardingRoutes(app: FastifyInstance) {
  // POST /v1/vendors/onboard — vendor only, creates the caller's Vendor profile once
  app.post(
    '/vendors/onboard',
    { preHandler: [requireAuth, requireRole('VENDOR')] },
    async (request, reply) => {
      const userId = request.authUser!.userId;

      const existing = await prisma.vendor.findUnique({ where: { userId } });
      if (existing) {
        return reply.code(409).send({ error: 'Vendor profile already exists' });
      }

      const body = (request.body ?? {}) as Record<string, unknown>;

      const storeName = typeof body.storeName === 'string' ? body.storeName.trim() : '';
      if (!storeName) {
        return reply.code(400).send({ error: 'storeName is required' });
      }

      const address = typeof body.address === 'string' ? body.address.trim() : '';
      if (!address) {
        return reply.code(400).send({ error: 'address is required' });
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

      const bankAccountNumber =
        typeof body.bankAccountNumber === 'string' ? body.bankAccountNumber : null;
      const bankIfsc = typeof body.bankIfsc === 'string' ? body.bankIfsc : null;

      try {
        const vendor = await prisma.vendor.create({
          data: {
            userId,
            storeName,
            address,
            pincode,
            latitude: body.latitude,
            longitude: body.longitude,
            bankAccountNumber,
            bankIfsc,
          },
        });
        return reply.code(201).send(maskBankDetails(vendor));
      } catch (err) {
        // Concurrent onboard for the same user won the race.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.code(409).send({ error: 'Vendor profile already exists' });
        }
        throw err;
      }
    },
  );

  /**
   * GET /v1/vendors/me — vendor only, the caller's own profile.
   *
   * A vendor who has signed up but not yet filled in their store is a normal,
   * expected state, not a failure — so it answers 200 with onboarded:false
   * rather than 404. The app branches on that flag to decide between the
   * onboarding form and the dashboard; a 404 would have it treating a brand-new
   * vendor as a broken request.
   */
  app.get(
    '/vendors/me',
    { preHandler: [requireAuth, requireRole('VENDOR')] },
    async (request) => {
      const vendor = await prisma.vendor.findUnique({
        where: { userId: request.authUser!.userId },
      });

      if (!vendor) {
        return { onboarded: false };
      }

      // The vendor's own row, but bank details masked to the last 4 digits
      // like everywhere else — see lib/pii.ts.
      return { onboarded: true, vendor: maskBankDetails(vendor) };
    },
  );

  // POST /v1/riders/onboard — rider only, creates the caller's Rider profile once
  app.post(
    '/riders/onboard',
    { preHandler: [requireAuth, requireRole('RIDER')] },
    async (request, reply) => {
      const userId = request.authUser!.userId;

      const existing = await prisma.rider.findUnique({ where: { userId } });
      if (existing) {
        return reply.code(409).send({ error: 'Rider profile already exists' });
      }

      const body = (request.body ?? {}) as Record<string, unknown>;

      const vehicleType = typeof body.vehicleType === 'string' ? body.vehicleType.trim() : '';
      if (!vehicleType) {
        return reply.code(400).send({ error: 'vehicleType is required' });
      }

      const vehicleNumber =
        typeof body.vehicleNumber === 'string' ? body.vehicleNumber.trim() : '';
      if (!vehicleNumber) {
        return reply.code(400).send({ error: 'vehicleNumber is required' });
      }

      const idProofUrl = typeof body.idProofUrl === 'string' ? body.idProofUrl.trim() : '';
      if (!idProofUrl) {
        return reply.code(400).send({ error: 'idProofUrl is required' });
      }

      const bankAccountNumber =
        typeof body.bankAccountNumber === 'string' ? body.bankAccountNumber : null;
      const bankIfsc = typeof body.bankIfsc === 'string' ? body.bankIfsc : null;

      try {
        const rider = await prisma.rider.create({
          data: { userId, vehicleType, vehicleNumber, idProofUrl, bankAccountNumber, bankIfsc },
        });
        return reply.code(201).send(maskBankDetails(rider));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.code(409).send({ error: 'Rider profile already exists' });
        }
        throw err;
      }
    },
  );
}
