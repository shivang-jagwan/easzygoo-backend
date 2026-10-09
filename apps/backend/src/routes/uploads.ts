import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../lib/auth-middleware';

/**
 * Signs a Cloudinary upload with the given params. Cloudinary's scheme: sort
 * the params alphabetically, join as k=v with '&', append the API secret,
 * SHA-1 hex. https://cloudinary.com/documentation/authentication_signatures
 */
export function signCloudinaryParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
}

export default async function uploadRoutes(app: FastifyInstance) {
  /**
   * POST /v1/uploads/sign — a short-lived signed payload the app uses to upload
   * straight to Cloudinary, so image bytes never pass through this API.
   *
   * The folder is fixed server-side from the caller's own profile, and it is
   * part of the signature, so a client cannot redirect the upload into another
   * vendor's or rider's folder. Only VENDOR and RIDER accounts upload.
   *
   * Before onboarding there is no Vendor/Rider row yet, but onboarding itself
   * needs uploads (a rider's idProofUrl is required). Those accounts sign into
   * a per-user staging folder, `.../pending/<userId>`; once the profile exists
   * uploads go to the profile's own folder.
   *
   * The API secret is used to sign and is never returned.
   */
  app.post('/uploads/sign', { preHandler: [requireAuth] }, async (request, reply) => {
    const { userId, role } = request.authUser!;

    let folder: string;
    if (role === 'VENDOR') {
      const vendor = await prisma.vendor.findUnique({ where: { userId }, select: { id: true } });
      folder = vendor ? `easzygoo/vendors/${vendor.id}` : `easzygoo/vendors/pending/${userId}`;
    } else if (role === 'RIDER') {
      const rider = await prisma.rider.findUnique({ where: { userId }, select: { id: true } });
      folder = rider ? `easzygoo/riders/${rider.id}` : `easzygoo/riders/pending/${userId}`;
    } else {
      return reply.code(403).send({ error: 'Only vendors and riders can upload files' });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      request.log.error('Cloudinary is not configured (CLOUDINARY_* env vars missing)');
      return reply.code(503).send({ error: 'Uploads are not available right now' });
    }

    // Cloudinary rejects signatures whose timestamp is more than an hour old.
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signCloudinaryParams({ folder, timestamp }, apiSecret);

    return { timestamp, signature, apiKey, cloudName, folder };
  });
}
