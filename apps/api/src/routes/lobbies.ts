import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import { lobbiesPageSchema } from '@sketchy/shared/contract/matchmaking';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { sendError } from '../error-envelope.js';
import { lobbiesRateLimit } from '../rate-limit.js';
import { listPublicLobbies } from '../rooms/public-lobbies.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";

/** Cursor-pagination query (api-contract.md §0): `?cursor=<opaque>&limit=<n≤50>`. */
const lobbiesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * `GET /v1/lobbies` (api-contract.md §1) — the public-room browser:
 * cursor-paginated public rooms currently in their lobby phase. Any
 * authenticated caller may browse; JOINING a public room still requires a
 * linked account (enforced at the socket `room:join`), so a guest can look
 * before hitting the account upsell. Never exposes any secret/game state —
 * these rooms are pre-game by construction (`rooms/public-lobbies.ts`).
 */
export const lobbyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/lobbies',
    {
      preHandler: [requireAuth, lobbiesRateLimit],
      schema: {
        querystring: lobbiesQuerySchema,
        response: {
          200: lobbiesPageSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.player) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }
      const { cursor, limit } = request.query;
      return listPublicLobbies(cursor, limit ?? 20);
    },
  );
};
