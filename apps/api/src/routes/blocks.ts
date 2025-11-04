import { blocksResponseSchema, createBlockRequestSchema } from '@sketchy/shared/contract/blocks';
import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import { okResponseSchema } from '@sketchy/shared/contract/packs';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { sendError } from '../error-envelope.js';
import { addBlock, listBlocksFor, removeBlock } from '../moderation/blocks.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";

const blockParamsSchema = z.object({ blockedPlayerId: z.uuid() });

/**
 * Per-player block list. Additive `/v1`
 * endpoints beyond api-contract.md §1's originally-enumerated matchmaking rows:
 * a durable block list is what the matcher's "never matched together" guarantee
 * and the client's "hide their chat locally" filter both read from.
 */
export const blockRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/blocks',
    {
      preHandler: requireAuth,
      schema: {
        response: {
          200: blocksResponseSchema,
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
      return { items: await listBlocksFor(caller.id) };
    },
  );

  fastify.post(
    '/blocks',
    {
      preHandler: requireAuth,
      schema: {
        body: createBlockRequestSchema,
        response: {
          200: okResponseSchema,
          400: errorEnvelopeSchema,
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
      if (request.body.blockedPlayerId === caller.id) {
        sendError(reply, 400, 'validation', "You can't block yourself. Introspective, though.");
        return undefined;
      }
      // Idempotent; no existence check on the target (a block on a since-deleted
      // player is harmless — the FK simply won't match anyone). A block on a
      // non-existent id would violate the FK, so guard by swallowing that as a
      // clean validation rather than a 500.
      try {
        await addBlock(caller.id, request.body.blockedPlayerId);
      } catch {
        sendError(reply, 400, 'validation', "We couldn't block that player.");
        return undefined;
      }
      return { ok: true as const };
    },
  );

  fastify.delete(
    '/blocks/:blockedPlayerId',
    {
      preHandler: requireAuth,
      schema: {
        params: blockParamsSchema,
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
      await removeBlock(caller.id, request.params.blockedPlayerId);
      return { ok: true as const };
    },
  );
};
