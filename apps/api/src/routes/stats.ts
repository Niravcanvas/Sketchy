import { gamesTodayResponseSchema } from '@sketchy/shared/contract/stats';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { statsRateLimit } from '../rate-limit.js';
import { countGamesToday } from '../services/stats.js';

/**
 * The ONE public, unauthenticated stats surface (api-contract.md §1 "Ops",
 * post-launch-backlog.md item 4 — now resolved). Deliberately separate from `adminRoutes`'
 * `GET /admin/stats`: that endpoint stays admin-token-gated and keeps exposing the
 * operational gauges (`roomsActive`/`socketsConnected`/`actionsPerMin`); this one has no
 * `requireAuth` at all and returns ONLY `{ gamesToday }`, computed via the SAME
 * `countGamesToday()` query `readAdminStats` uses (`services/stats.ts`) so the two can never
 * disagree on what "today" means. Exists so the landing page's social-proof counter
 * (`apps/web/src/lib/admin-stats.ts`) no longer needs the ops-only `ADMIN_TOKEN`. Rate-limited
 * per-IP via `statsRateLimit` since there's no player identity to key on.
 */
export const statsRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/stats/games-today',
    {
      preHandler: statsRateLimit,
      schema: {
        response: {
          200: gamesTodayResponseSchema,
        },
      },
    },
    async () => ({ gamesToday: await countGamesToday() }),
  );
};
