import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

/**
 * Resolves the database the tests may write to, or throws.
 *
 * The suite TRUNCATEs every table and resets the schema, so it must never touch
 * a real database: it runs only against TEST_DATABASE_URL, and refuses outright
 * when that is unset or is the same database as DATABASE_URL. Values come from
 * the process environment first, then the monorepo-root .env.
 */
export function resolveTestDatabaseUrl(): string {
  const rootEnvPath = path.resolve(__dirname, '../../../.env');
  const fileEnv = fs.existsSync(rootEnvPath) ? parse(fs.readFileSync(rootEnvPath)) : {};

  const testUrl = (process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL ?? '').trim();
  const appUrl = (process.env.DATABASE_URL ?? fileEnv.DATABASE_URL ?? '').trim();

  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. The test suite truncates every table, so it only ' +
        'runs against a dedicated test database.',
    );
  }
  if (appUrl && sameDatabase(testUrl, appUrl)) {
    throw new Error(
      'TEST_DATABASE_URL points at the same database as DATABASE_URL. Refusing to run: ' +
        'the suite would wipe it.',
    );
  }
  return testUrl;
}

/** Same host, port and database name — ignores credentials and query params. */
function sameDatabase(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const port = (u: URL) => u.port || '5432';
    return (
      ua.hostname.toLowerCase() === ub.hostname.toLowerCase() &&
      port(ua) === port(ub) &&
      ua.pathname === ub.pathname
    );
  } catch {
    return false;
  }
}
