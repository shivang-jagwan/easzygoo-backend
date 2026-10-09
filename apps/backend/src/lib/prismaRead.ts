import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { prisma } from './prisma';

/**
 * Read-only Prisma client for admin list / analytics queries, so reporting
 * traffic stays off the primary (CLAUDE.md working convention).
 *
 * Points at READ_REPLICA_URL when set; otherwise it IS the primary client — no
 * second connection pool is opened just to talk to the same database.
 *
 * Replicas lag. Use this only for lists an admin browses, never for a read
 * that must see a write made a moment earlier (approve/reject, order state).
 * Never write through it.
 */
export const prismaRead: PrismaClient = env.READ_REPLICA_URL
  ? new PrismaClient({
      datasources: { db: { url: env.READ_REPLICA_URL } },
      log: ['warn', 'error'],
    })
  : prisma;

/** Disconnect the replica client if it is a separate one. Used by graceful shutdown. */
export async function disconnectRead(): Promise<void> {
  if (prismaRead !== prisma) await prismaRead.$disconnect();
}
