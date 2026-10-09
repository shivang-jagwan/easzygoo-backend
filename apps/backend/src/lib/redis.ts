import Redis, { type RedisOptions } from 'ioredis';
import { env } from './env';

/*
 * One Redis, logical DB 0 only, with every concern separated by key prefix.
 *
 * Managed free tiers (Upstash included) expose a single DB, so nothing here may
 * depend on SELECT n. Each concern owns a prefix instead:
 *
 *   bull    BullMQ queues        bull:<queue>:...   (BullMQ's own `prefix` option)
 *   rl:     rate limiter         rl:...             (@fastify/rate-limit nameSpace)
 *   sock    Socket.io adapter    sock#/#...         (redis-adapter `key`, pub/sub channels)
 *   cache:  application cache    cache:...          (reserved; nothing caches yet)
 *
 * Do NOT use ioredis `keyPrefix` on a BullMQ connection — BullMQ forbids it.
 */
export const REDIS_PREFIX = {
  bull: 'bull',
  rateLimit: 'rl:',
  socket: 'sock',
  cache: 'cache:',
} as const;

const clients = new Set<Redis>();

/**
 * A new Redis client on REDIS_URL, pinned to DB 0, or null when REDIS_URL is
 * unset (dev/test without Redis — callers fall back or no-op). Errors are
 * logged rather than thrown, so a Redis blip cannot crash the process; ioredis
 * reconnects on its own. Every client is tracked for quitAllRedis().
 */
export function createRedis(label: string, options: RedisOptions = {}): Redis | null {
  if (!env.REDIS_URL) return null;

  const dbInUrl = new URL(env.REDIS_URL).pathname.replace('/', '');
  if (dbInUrl && dbInUrl !== '0') {
    console.warn(`[redis:${label}] REDIS_URL selects DB ${dbInUrl}; ignoring it and using DB 0`);
  }

  const client = new Redis(env.REDIS_URL, { ...options, db: 0 });
  client.on('error', (err) => console.error(`[redis:${label}] error:`, err.message));
  clients.add(client);
  return client;
}

/** Quit every client createRedis() handed out. Used by graceful shutdown. */
export async function quitAllRedis(): Promise<void> {
  await Promise.allSettled(
    [...clients].map(async (c) => {
      try {
        await c.quit();
      } catch {
        c.disconnect();
      }
    }),
  );
  clients.clear();
}

/**
 * BullMQ silently loses jobs if Redis evicts keys under memory pressure, so the
 * only safe policy is `noeviction`. Logs a warning when the policy is anything
 * else — or cannot be read, since managed providers often block CONFIG.
 */
export async function checkEvictionPolicy(
  client: Redis,
  log: (msg: string) => void,
): Promise<void> {
  let policy: string | null = null;
  try {
    const res = (await client.call('CONFIG', 'GET', 'maxmemory-policy')) as string[];
    policy = res?.[1] ?? null;
  } catch {
    try {
      const info = await client.info('memory');
      policy = /maxmemory_policy:(\S+)/.exec(info)?.[1] ?? null;
    } catch {
      policy = null;
    }
  }

  if (policy === 'noeviction') return;
  log(
    policy
      ? `[redis] maxmemory-policy is "${policy}", not "noeviction" — BullMQ jobs can be evicted and lost`
      : '[redis] could not read maxmemory-policy; confirm it is "noeviction" with your provider',
  );
}
