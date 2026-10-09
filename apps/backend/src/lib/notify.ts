import { getNotificationsQueue, type NotificationJob } from './queue';

/**
 * Enqueue a push notification for a user. This is the ONLY way route handlers
 * should trigger a push — never call Firebase messaging directly from a route,
 * so nothing slow or flaky ends up in the request path.
 *
 * Enqueue failures are logged, not thrown: a push that fails to queue must not
 * fail the HTTP request that triggered it. Without Redis (dev/test only) the
 * push is skipped — see lib/queue.ts.
 */
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const job: NotificationJob = { userId, title, body, data };
  try {
    const queue = getNotificationsQueue();
    if (!queue) return;
    await queue.add('push', job);
  } catch (err) {
    console.error('[notify] failed to enqueue push for', userId, (err as Error).message);
  }
}
