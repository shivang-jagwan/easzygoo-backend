import type { FastifyInstance } from 'fastify';

import { prisma } from '../lib/prisma';
import { findNearbyVendors, parseGeoParams, type GeoQuery } from '../lib/geo';
import { RATE_LIMITS, perIp } from '../lib/rate-limits';

const MIN_QUERY_LENGTH = 2;
/** Longer queries are never real product searches, and make ILIKE scans pricier. */
const MAX_QUERY_LENGTH = 60;

interface SearchQuery extends GeoQuery {
  q?: string;
}

/** A vendor as it appears in search results — the nearby shape, trimmed down. */
interface VendorHit {
  id: string;
  storeName: string;
  distanceKm: number;
}

export default async function searchRoutes(app: FastifyInstance) {
  /**
   * GET /v1/search — public.
   *
   * Searches only within the caller's deliverable radius: a product in a store
   * that cannot reach them is not a useful result. Nearby vendors are resolved
   * first, then both matches are scoped to that set.
   */
  app.get<{ Querystring: SearchQuery }>(
    '/search',
    { config: perIp(RATE_LIMITS.discovery) },
    async (request, reply) => {
      const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
      if (q.length < MIN_QUERY_LENGTH) {
        return reply
          .code(400)
          .send({ error: `q is required and must be at least ${MIN_QUERY_LENGTH} characters` });
      }
      if (q.length > MAX_QUERY_LENGTH) {
        return reply
          .code(400)
          .send({ error: `q must be at most ${MAX_QUERY_LENGTH} characters` });
      }

      const geo = parseGeoParams(request.query);
      if (!geo.ok) {
        return reply.code(400).send({ error: geo.error });
      }

      const nearby = await findNearbyVendors(geo.lat, geo.lng, geo.maxRadiusKm);
      if (nearby.length === 0) {
        // Nothing can reach this location, so nothing can match.
        return { vendors: [], products: [] };
      }

      // Already distance-sorted by findNearbyVendors, so anything derived from
      // this order inherits it.
      const byId = new Map<string, VendorHit>(
        nearby.map((v) => [v.id, { id: v.id, storeName: v.storeName, distanceKm: v.distanceKm }]),
      );

      const vendors = nearby
        .filter((v) => v.storeName.toLowerCase().includes(q.toLowerCase()))
        .map((v) => byId.get(v.id)!);

      const matchedProducts = await prisma.product.findMany({
        where: {
          isActive: true,
          vendorId: { in: nearby.map((v) => v.id) },
          name: { contains: q, mode: 'insensitive' },
        },
        select: {
          id: true,
          vendorId: true,
          name: true,
          description: true,
          imageUrl: true,
          unit: true,
          unitValue: true,
          price: true,
          stockQty: true,
        },
      });

      const products = matchedProducts
        .map((p) => {
          const { vendorId, ...product } = p;
          return { ...product, vendor: byId.get(vendorId)! };
        })
        // Nearest store first; ties broken by product name so paging is stable.
        .sort(
          (a, b) =>
            a.vendor.distanceKm - b.vendor.distanceKm || a.name.localeCompare(b.name),
        );

      return { vendors, products };
    },
  );
}
