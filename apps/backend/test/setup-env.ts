import { resolveTestDatabaseUrl } from './test-db';

/*
 * Runs in each test file's process before the file imports any app code.
 * Everything set here wins over the root .env (dotenv never overrides).
 */
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
// Blank = unset (lib/env.ts): no Redis, no replica, no browser origins, no
// Sentry — queues no-op, the rate limiter uses memory, reads hit the test DB.
process.env.REDIS_URL = '';
process.env.READ_REPLICA_URL = '';
process.env.ALLOWED_ORIGINS = '';
process.env.SENTRY_DSN = '';
process.env.TRUST_PROXY = '';
// Fake Cloudinary credentials: tests check signatures, never the real account.
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret-do-not-leak';
