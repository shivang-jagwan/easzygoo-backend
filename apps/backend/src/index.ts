import './lib/env'; // must be first — loads and validates the root .env
import { API_REQUIRED_ENV, env, requireEnv } from './lib/env';
import { initSentry } from './lib/sentry';

// Fail fast (in production) before opening any connection.
requireEnv('api', API_REQUIRED_ENV);

// Start crash reporting before anything else runs. NOTE: TypeScript hoists the
// `import` statements below above this call, so modules are required first —
// error capture is unaffected, only deep auto-instrumentation would be.
initSentry();

import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { prisma } from './lib/prisma';
import { disconnectRead } from './lib/prismaRead';
import { closeQueues } from './lib/queue';
import { checkEvictionPolicy, createRedis, quitAllRedis } from './lib/redis';
import { closeSocket, initSocket } from './lib/socket';

/** Longest a graceful shutdown may take before the process is killed outright. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * SIGTERM/SIGINT (Render deploys, PM2 reloads, Ctrl-C):
 *   1. stop accepting new connections
 *   2. close Socket.io (disconnects clients, so the server can finish closing)
 *   3. app.close() — waits for in-flight HTTP requests, runs onClose hooks
 *   4. disconnect Prisma (primary + replica), close BullMQ queues
 *   5. quit every Redis client
 * A 10s timer force-exits if any step hangs. Repeat signals are ignored.
 */
function installShutdown(app: FastifyInstance): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);

    const hardExit = setTimeout(() => {
      app.log.error(`shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    hardExit.unref();

    try {
      // Fastify tolerates the server already being closed when app.close() runs.
      app.server.close();
      await closeSocket();
      await app.close();
      await Promise.allSettled([prisma.$disconnect(), disconnectRead(), closeQueues()]);
      await quitAllRedis();
      app.log.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const start = async () => {
  const rateLimitRedis = createRedis('rate-limit');
  const app = await buildApp({ rateLimitRedis });
  installShutdown(app);

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    // Fastify exposes the underlying Node http.Server; Socket.io rides on it.
    initSocket(app.server);
    app.log.info('Socket.io attached');

    if (rateLimitRedis) {
      void checkEvictionPolicy(rateLimitRedis, (msg) => app.log.warn(msg));
    } else {
      app.log.warn('REDIS_URL not set — rate limits are per-process and in memory');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
