import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import { guestAuthRequestSchema, guestAuthResponseSchema } from '@sketchy/shared/contract/players';
import { containsProfanity } from '@sketchy/shared/profanity';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { signPlayerToken } from '../auth/jwt.js';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { sendError } from '../error-envelope.js';
import { authRateLimit } from '../rate-limit.js';
import { DEFAULT_AVATAR } from '../rooms/default-avatar.js';
import { mapPlayer } from './mappers.js';

/**
 * `POST /v1/auth/guest` (system-design.md §6, api-contract.md §1): the
 * guest-first identity entry point. No auth required; rate-limited 5/min/IP
 * (rate-limit.ts `authRateLimit`) on top of the global 60/min/IP limit that
 * applies to every non-ops route.
 */
export const authRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/auth/guest',
    {
      preHandler: authRateLimit,
      schema: {
        body: guestAuthRequestSchema,
        response: {
          200: guestAuthResponseSchema,
          400: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { displayName } = request.body;

      if (containsProfanity(displayName)) {
        sendError(reply, 400, 'profanity', "Let's keep it printable. Try different words.");
        return undefined;
      }

      const db = getDb();
      const [row] = await db
        .insert(players)
        .values({ displayName, avatar: DEFAULT_AVATAR, isGuest: true })
        .returning();
      if (!row) {
        sendError(reply, 500, 'internal', 'Failed to create guest player.');
        return undefined;
      }

      const token = await signPlayerToken(row.id, true);
      return { token, player: mapPlayer(row) };
    },
  );
};
