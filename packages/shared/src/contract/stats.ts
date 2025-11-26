import { z } from 'zod';

/**
 * `GET /v1/stats/games-today` response body (api-contract.md §1 "Ops") — the ONE public,
 * unauthenticated stats surface. Deliberately a single non-negative int: the same
 * daily-resetting "games started since local midnight" count `GET /v1/admin/stats`'s
 * `gamesToday` field exposes (`apps/api/src/services/stats.ts`'s `countGamesToday`, reused
 * unmodified by both routes), and NOTHING else — the admin-only operational gauges
 * (`roomsActive` / `socketsConnected` / `actionsPerMin`) never get a public counterpart.
 * Backs the landing page's social-proof counter (`apps/web/src/lib/admin-stats.ts`) without
 * coupling the public web tier to the ops-only `ADMIN_TOKEN` (post-launch-backlog.md item 4).
 */
export const gamesTodayResponseSchema = z.object({
  gamesToday: z.number().int().nonnegative(),
});

export type GamesTodayResponse = z.infer<typeof gamesTodayResponseSchema>;
