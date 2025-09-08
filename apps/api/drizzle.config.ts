import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config (system-design.md §3): migrations are generated here
 * and committed to `apps/api/drizzle/`, then applied explicitly via
 * `db:migrate` — never auto-applied by the app at boot. `DATABASE_URL`
 * falls back to the `deploy/compose.dev.yml` default so `db:generate`/
 * `db:migrate` work with zero flag plumbing in local dev.
 */
export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://sketchy:sketchy@localhost:5432/sketchy',
  },
});
