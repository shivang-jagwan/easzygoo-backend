import '../lib/env'; // must be first — loads and validates the root .env
import { WORKER_REQUIRED_ENV, requireEnv } from '../lib/env';
import * as Sentry from '@sentry/node';
import { initSentry } from '../lib/sentry';

requireEnv('worker', WORKER_REQUIRED_ENV);

// Separate process from the API server, so it needs its own Sentry init.
initSentry();

import { Worker, type Job } from 'bullmq';
import { getMessaging } from 'firebase-admin/messaging';
import '../lib/firebase'; // initialises the Admin SDK
import { prisma } from '../lib/prisma';
import {
  NOTIFICATIONS_QUEUE,
  closeQueues,
  createQueueConnection,
  getNotificationsDlq,
  type NotificationJob,
} from '../lib/queue';
import { REDIS_PREFIX } from '../lib/redis';

/*
 * Notification worker — runs as its own process (`pnpm worker`), separate from
 * the API server, matching the Render Background Worker split in CLAUDE.md.
 *
 * Drains the "notifications" queue: looks up the user's device tokens and sends
 * one multicast via FCM. Tokens FCM reports as dead are deleted; anything else
 * is logged and left to BullMQ's retry/backoff.
 */

// FCM error codes that mean "this device is gone" — deleting is correct, retrying is not.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

async function handle(job: Job<NotificationJob>) {
  const { userId, title, body, data } = job.data;

  const tokens = await prisma.pushToken.findMany({
    where: { userId },
    select: { id: true, token: true },
  });

  if (tokens.length === 0) {
    // Not a failure — the user simply has no registered device.
    console.log(`[worker] job ${job.id}: no push tokens for user ${userId}, skipping`);
    return { sent: 0, skipped: true };
  }

  const response = await getMessaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { title, body },
    data,
  });

  const deadTokenIds: string[] = [];
  response.responses.forEach((res, i) => {
    if (res.success) return;
    const code = (res.error as { code?: string } | undefined)?.code ?? '';
    if (DEAD_TOKEN_CODES.has(code)) {
      deadTokenIds.push(tokens[i].id);
    } else {
      console.error(`[worker] job ${job.id}: send failed for token ${tokens[i].id}:`, code || res.error?.message);
    }
  });

  if (deadTokenIds.length > 0) {
    await prisma.pushToken.deleteMany({ where: { id: { in: deadTokenIds } } });
    console.log(`[worker] job ${job.id}: pruned ${deadTokenIds.length} dead token(s)`);
  }

  console.log(
    `[worker] job ${job.id}: sent ${response.successCount}/${tokens.length} (failed ${response.failureCount})`,
  );
  return { sent: response.successCount, failed: response.failureCount };
}

// Unlike the API, the worker has nothing to do without Redis — in any environment.
const connection = createQueueConnection('worker');
if (!connection) {
  throw new Error('REDIS_URL is not set — the notification worker cannot run without Redis');
}

const worker = new Worker<NotificationJob>(NOTIFICATIONS_QUEUE, handle, {
  connection,
  prefix: REDIS_PREFIX.bull,
});

/**
 * True when BullMQ will not retry this job again: every attempt is used up, or
 * the processor threw UnrecoverableError (which skips the remaining attempts).
 */
function isFinalFailure(job: Job<NotificationJob>, err: Error): boolean {
  return err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
}

worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  if (!job || !isFinalFailure(job, err)) return; // BullMQ will retry it

  // Dead letter: copy the payload and the reason to the DLQ (GET /v1/admin/dlq)
  // and report once to Sentry — intermediate attempts are only logged above.
  Sentry.captureException(err, {
    tags: { queue: NOTIFICATIONS_QUEUE, deadLettered: 'true' },
    extra: { jobId: job.id, userId: job.data?.userId, attemptsMade: job.attemptsMade },
  });
  getNotificationsDlq()
    ?.add('dead', {
      originalJobId: job.id,
      queue: NOTIFICATIONS_QUEUE,
      payload: job.data,
      failedReason: err.message,
      stacktrace: job.stacktrace ?? [],
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    })
    .catch((dlqErr: Error) => {
      // Losing the DLQ copy must still be visible somewhere.
      console.error(`[worker] could not dead-letter job ${job.id}:`, dlqErr.message);
      Sentry.captureException(dlqErr, { extra: { jobId: job.id } });
    });
});
worker.on('ready', () => console.log('[worker] notification worker ready'));

const shutdown = async () => {
  console.log('[worker] shutting down, draining in-flight jobs...');
  await worker.close();
  await closeQueues(); // the DLQ producer, if it was opened
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
