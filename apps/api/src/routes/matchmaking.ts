import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import {
  matchmakingQueueRequestSchema,
  matchmakingQueueResponseSchema,
} from '@sketchy/shared/contract/matchmaking';
import { okResponseSchema } from '@sketchy/shared/contract/packs';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../auth/plugin.js';
import { sendError } from '../error-envelope.js';
import { matchmakingRateLimit } from '../rate-limit.js';
import { dequeue, enqueue } from '../matchmaking/queue-store.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";

/**
 * Quick-join matchmaking queue (api-contract.md §1). Enqueue is
 * REST; the MATCH resolution is pushed asynchronously over the socket as
 * `mm:matched { code }` by the matcher (`matchmaking/matcher.ts`). Public
 * matchmaking requires a linked account (guests get `account_required`), so a
 * guest is bounced to the account-link upsell before ever entering the queue.
 */
export const matchmakingRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/matchmaking/queue',
    {
      preHandler: [requireAuth, matchmakingRateLimit],
      schema: {
        body: matchmakingQueueRequestSchema,
        response: {
          200: matchmakingQueueResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }
      if (caller.guest) {
        sendError(
          reply,
          403,
          'account_required',
          'Playing with strangers needs a linked account. Link your email to quick-join — private rooms never need it.',
        );
        return undefined;
      }
      await enqueue(caller.id, request.body.language, Date.now());
      return { status: 'queued' as const };
    },
  );

  fastify.delete(
    '/matchmaking/queue',
    {
      preHandler: requireAuth,
      schema: {
        response: {
          200: okResponseSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }
      // Existence-hiding: `{ ok: true }` whether or not the caller was queued.
      await dequeue(caller.id);
      return { ok: true as const };
    },
  );
};
