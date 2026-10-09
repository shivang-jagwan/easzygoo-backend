import { execSync } from 'node:child_process';
import path from 'node:path';
import { resolveTestDatabaseUrl } from './test-db';

/**
 * Runs once per `vitest run`, before any test file: rebuilds the test
 * database's schema from prisma/schema.prisma.
 *
 * `db push` (not `migrate deploy`) so tests exercise the schema the code is
 * written against, even while a migration for it is still pending. pg_trgm is
 * created first because the Product.name GIN index needs it.
 */
export default function setup(): void {
  const url = resolveTestDatabaseUrl();
  const cwd = path.resolve(__dirname, '..');
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  const run = (cmd: string, input?: string) =>
    execSync(cmd, { cwd, env, input, stdio: ['pipe', 'pipe', 'pipe'] });

  run(
    'npx prisma db execute --stdin --schema prisma/schema.prisma',
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS pg_trgm;',
  );
  run('npx prisma db push --skip-generate --accept-data-loss --schema prisma/schema.prisma');
}
