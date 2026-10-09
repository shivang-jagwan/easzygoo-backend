import type { FastifyInstance } from 'fastify';

import { prisma } from '../lib/prisma';
import { RATE_LIMITS, perIp } from '../lib/rate-limits';
import { findNearbyVendors, parseGeoParams, type GeoQuery } from '../lib/geo';

export default async function discoveryRoutes(app: FastifyInstance) {
  // GET /v1/vendors/nearby — public. Geo logic lives in lib/geo so this and
  // /v1/search stay on one implementation.
  app.get<{ Querystring: GeoQuery }>(
    '/vendors/nearby',
    { config: perIp(RATE_LIMITS.discovery) },
    async (request, reply) => {
      const geo = parseGeoParams(request.query);
      if (!geo.ok) {
        return reply.code(400).send({ error: geo.error });
      }

      return findNearbyVendors(geo.lat, geo.lng, geo.maxRadiusKm);
    },
  );

  /**
   * GET /v1/vendors/:vendorId — public storefront detail.
   *
   * Only APPROVED stores exist publicly: anything else is a 404, so a pending
   * or suspended store is indistinguishable from a missing one. Only
   * customer-facing fields are selected — no owner, bank or status data.
   * (`:vendorId`, not `:id`, to match /vendors/:vendorId/products.)
   */
  app.get<{ Params: { vendorId: string } }>('/vendors/:vendorId', async (request, reply) => {
    const vendor = await prisma.vendor.findFirst({
      where: { id: request.params.vendorId, status: 'APPROVED' },
      select: {
        id: true,
        storeName: true,
        address: true,
        isOpen: true,
        openTime: true,
        closeTime: true,
        deliveryRadiusKm: true,
      },
    });
    if (!vendor) {
      return reply.code(404).send({ error: 'Vendor not found' });
    }

    // Ratings are not built yet; the field is in the contract so clients can
    // render "no rating" now and need no change when it lands.
    return { ...vendor, averageRating: null };
  });
}
