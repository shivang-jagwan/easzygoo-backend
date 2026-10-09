import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { isProduction } from './env';
import { REDIS_PREFIX, createRedis } from './redis';

/*
 * BullMQ queues. Anything async — notifications, payout processing, webhook
 * retries — goes through here rather than running in the request path.
 *
 * The worker that drains this queue runs as a SEPARATE process
 * (`pnpm worker`), matching the Render Background Worker split.
 *
 * Queues are created lazily, never at import: importing this module must not
 * need Redis. Without REDIS_URL, outside production, the getters return null
 * and callers skip the work with a warning. In production a missing REDIS_URL
 * is already a startup error (lib/env.ts requireEnv), and the getters throw as
 * a second line of defence.
 */

export const NOTIFICATIONS_QUEUE = 'notifications';
/** Notification jobs that exhausted every retry. Nothing consumes it; admins inspect it. */
export const NOTIFICATIONS_DLQ = 'notifications-dlq';

export interface NotificationJob {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** What lands in the DLQ: the original payload plus why and when it died. */
export interface NotificationDlqJob {
  originalJobId: string | undefined;
  queue: string;
  payload: NotificationJob;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  failedAt: string;
}

/**
 * A Redis connection for BullMQ, or null without REDIS_URL.
 * `maxRetriesPerRequest: null` is required by BullMQ for blocking commands.
 */
export function createQueueConnection(label: string): Redis | null {
  return createRedis(`queue:${label}`, { maxRetriesPerRequest: null });
}

let notificationsQueue: Queue<NotificationJob> | null | undefined;
let notificationsDlq: Queue<NotificationDlqJob> | null | undefined;
let warnedNoRedis = false;

function noRedis(name: string): null {
  if (isProduction) {
    throw new Error(`REDIS_URL is not set — the "${name}" queue cannot run in production`);
  }
  if (!warnedNoRedis) {
    warnedNoRedis = true;
    console.warn('[queue] REDIS_URL not set — queued work (push notifications) is skipped');
  }
  return null;
}

/** The notifications queue, or null when Redis is not configured (non-production only). */
export function getNotificationsQueue(): Queue<NotificationJob> | null {
  if (notificationsQueue !== undefined) return notificationsQueue;
  const connection = createQueueConnection('notifications');
  notificationsQueue = connection
    ? new Queue<NotificationJob>(NOTIFICATIONS_QUEUE, {
        connection,
        prefix: REDIS_PREFIX.bull,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          // Jobs that exhaust all attempts are copied to NOTIFICATIONS_DLQ by
          // the worker; the original is kept in the failed set as well.
          removeOnFail: false,
        },
      })
    : noRedis(NOTIFICATIONS_QUEUE);
  return notificationsQueue;
}

/** The notifications dead-letter queue, or null when Redis is not configured. */
export function getNotificationsDlq(): Queue<NotificationDlqJob> | null {
  if (notificationsDlq !== undefined) return notificationsDlq;
  const connection = createQueueConnection('notifications-dlq');
  notificationsDlq = connection
    ? new Queue<NotificationDlqJob>(NOTIFICATIONS_DLQ, { connection, prefix: REDIS_PREFIX.bull })
    : noRedis(NOTIFICATIONS_DLQ);
  return notificationsDlq;
}

/** Close whichever queues were opened. Used by graceful shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled([notificationsQueue?.close(), notificationsDlq?.close()]);
  notificationsQueue = undefined;
  notificationsDlq = undefined;
}
