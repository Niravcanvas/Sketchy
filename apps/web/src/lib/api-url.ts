/**
 * Single accessor for the API base URL (conventions.md §4 — `PUBLIC_API_URL`,
 * not `NEXT_PUBLIC_*`; wired through `next.config.mjs`'s `env` block so the
 * documented name is readable client-side too). Falls back to the local API
 * dev port so `pnpm --filter @sketchy/web dev` works against a freshly
 * cloned repo with no `.env` at all.
 *
 * Returns the base URL INCLUDING the `/v1` prefix `createApiClient`
 * (`@sketchy/shared/client`) expects (api-contract.md §0).
 */
export function getApiUrl(): string {
  const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  return `${base.replace(/\/+$/, '')}/v1`;
}
