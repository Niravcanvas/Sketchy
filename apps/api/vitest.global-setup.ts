/**
 * Vitest global setup (pinned decision): runs ONCE
 * before any test file, in the main process — so mutations to `process.env`
 * here are visible to every test file's worker (thread or fork), which is
 * exactly how `DATABASE_URL`/`REDIS_URL` get overridden for the whole run
 * BEFORE any test file calls `buildServer()` / `getEnv()`.
 *
 * Drops + recreates a dedicated `sketchy_test` database every run (never
 * touches the dev `sketchy` database) and applies the committed Drizzle
 * migrations to it programmatically, so integration tests always start
 * from a known-clean, current schema.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://sketchy:sketchy@localhost:5432/postgres';
const TEST_DATABASE_NAME = 'sketchy_test';
const TEST_DATABASE_URL = `postgres://sketchy:sketchy@localhost:5432/${TEST_DATABASE_NAME}`;
const TEST_REDIS_URL = 'redis://localhost:6379/1';

async function recreateTestDatabase(): Promise<void> {
  const adminClient = new Client({ connectionString: ADMIN_DATABASE_URL });
  try {
    await adminClient.connect();
  } catch (cause) {
    // The whole api suite is dead in the water without an admin connection here.
    // Surface a message that points at the fix instead of a bare ECONNREFUSED.
    throw new Error(
      `Cannot reach the Postgres admin connection at ${ADMIN_DATABASE_URL} to (re)create ` +
        `the "${TEST_DATABASE_NAME}" test database. The project Postgres must be running on ` +
        `:5432 — start it with \`docker compose -f deploy/compose.dev.yml up -d\`.`,
      { cause },
    );
  }
  try {
    // Force-close any lingering connections from a previous crashed run —
    // Postgres refuses DROP DATABASE while sessions are still attached.
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DATABASE_NAME],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE_NAME}`);
    await adminClient.query(`CREATE DATABASE ${TEST_DATABASE_NAME}`);
  } finally {
    await adminClient.end();
  }
}

async function applyMigrations(): Promise<void> {
  const migrationClient = new Client({ connectionString: TEST_DATABASE_URL });
  await migrationClient.connect();
  try {
    const db = drizzle(migrationClient);
    await migrate(db, { migrationsFolder: path.join(scriptDir, 'drizzle') });
  } finally {
    await migrationClient.end();
  }
}

export default async function setup(): Promise<void> {
  await recreateTestDatabase();

  // Must happen BEFORE any test file's module graph runs `getEnv()` — see
  // the file doc comment above for why this is safe across worker types.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;

  await applyMigrations();
}
