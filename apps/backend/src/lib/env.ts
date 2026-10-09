import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

// Side-effect module: import this FIRST (before any module that reads process.env)
// so the monorepo-root .env is loaded before prisma.ts / firebase.ts initialise.
// Values already set in the real environment win over the file.
config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * Every variable the backend reads, and nothing else. .env.example mirrors
 * this list. (DIRECT_URL is read by the Prisma CLI for migrations, not by app
 * code; FIREBASE_WEB_* by scripts/get-test-token.ts only.)
 *
 * Shapes are validated in every environment — a malformed value is always a
 * bug. *Presence* is enforced per process by requireEnv(), and only fatally
 * in production, so local dev can boot with Redis or Cloudinary unset.
 */

/** dotenv turns `KEY=` into "", which means "unset" here, not "empty value". */
const blankAsUnset = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankAsUnset, schema.optional());

const schema = z.object({
  NODE_ENV: z.preprocess(
    blankAsUnset,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  PORT: z.preprocess(blankAsUnset, z.coerce.number().int().min(1).max(65535).default(4000)),

  DATABASE_URL: optional(z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')),
  /** Optional read replica for admin/analytics reads; falls back to DATABASE_URL. */
  READ_REPLICA_URL: optional(z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')),
  REDIS_URL: optional(z.string().regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL')),

  FIREBASE_PROJECT_ID: optional(z.string()),
  FIREBASE_CLIENT_EMAIL: optional(z.string()),
  FIREBASE_PRIVATE_KEY: optional(z.string()),

  SENTRY_DSN: optional(z.string().url()),

  CLOUDINARY_CLOUD_NAME: optional(z.string()),
  CLOUDINARY_API_KEY: optional(z.string()),
  CLOUDINARY_API_SECRET: optional(z.string()),

  /** Comma-separated browser origins allowed to call the API, e.g. the admin panel. */
  ALLOWED_ORIGINS: optional(z.string()),
  /**
   * How many reverse proxies sit in front of the app (Cloudflare + Nginx = 2),
   * or "true" to trust all. Needed so request.ip — and therefore per-IP rate
   * limits — is the client, not the proxy. Leave unset when not behind a proxy.
   */
  TRUST_PROXY: optional(z.string().regex(/^(true|false|\d+)$/, 'must be true, false or a hop count')),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`[env] invalid environment variables:\n${problems}`);
}

export const env = parsed.data;
export type EnvKey = keyof typeof env;

/** ALLOWED_ORIGINS as a list; each entry must be a bare origin (no path). */
export const allowedOrigins: string[] = (env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
for (const origin of allowedOrigins) {
  let ok = false;
  try {
    ok = new URL(origin).origin === origin;
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(`[env] ALLOWED_ORIGINS entry "${origin}" must be a bare origin like https://admin.example.com`);
  }
}

/**
 * TRUST_PROXY in the form Fastify's `trustProxy` option takes. A hop count N
 * becomes "trust the N nearest proxies" — the same semantics proxy-addr gives a
 * number, expressed as a function because Fastify's types only accept that.
 */
const trustedHops = Number(env.TRUST_PROXY);
export const trustProxy: boolean | ((address: string, hop: number) => boolean) =
  env.TRUST_PROXY === undefined || env.TRUST_PROXY === 'false'
    ? false
    : env.TRUST_PROXY === 'true'
      ? true
      : (_address, hop) => hop < trustedHops;

export const isProduction = env.NODE_ENV === 'production';

/** What the API process cannot run without in production. */
export const API_REQUIRED_ENV: EnvKey[] = [
  'DATABASE_URL',
  'REDIS_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

/** What the notification worker cannot run without in production. */
export const WORKER_REQUIRED_ENV: EnvKey[] = [
  'DATABASE_URL',
  'REDIS_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
];

/**
 * Fail fast in production when a required variable is missing, with one error
 * naming all of them. Outside production it only warns, so a partial local
 * setup still boots.
 */
export function requireEnv(processName: string, keys: EnvKey[]): void {
  const missing = keys.filter((k) => env[k] === undefined);
  if (missing.length === 0) return;
  const message = `[env] ${processName}: missing required environment variables: ${missing.join(', ')}`;
  if (isProduction) {
    throw new Error(message);
  }
  console.warn(`${message} (tolerated outside production)`);
}
