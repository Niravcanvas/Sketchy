import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import { okResponseSchema } from '@sketchy/shared/contract/packs';
import { createReportRequestSchema } from '@sketchy/shared/contract/reports';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../auth/plugin.js';
import { getDb } from '../db/client.js';
import { players, reports } from '../db/schema.js';
import { sendError } from '../error-envelope.js';
import { captureReportContext } from '../moderation/report-context.js';
import { reportRateLimit } from '../rate-limit.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";

/**
 * `POST /v1/reports` (api-contract.md §1). Files a moderation report
 * against another player. When `roomCode` is supplied the server captures the
 * room's recent chat/clue context (`moderation/report-context.ts`) into the
 * `reports.context` column — never trusting the client to supply it. The report
 * lands `status: 'open'` for the admin queue (routes/admin.ts).
 */
export const reportRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/reports',
    {
      preHandler: [requireAuth, reportRateLimit],
      schema: {
        body: createReportRequestSchema,
        response: {
          200: okResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
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
      const { reportedPlayerId, roomCode, reason, detail } = request.body;

      if (reportedPlayerId === caller.id) {
        sendError(reply, 400, 'validation', "You can't report yourself. Admirable restraint would be easier.");
        return undefined;
      }

      const db = getDb();
      const [reported] = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.id, reportedPlayerId))
        .limit(1);
      if (!reported) {
        sendError(reply, 404, 'not_found', 'That player no longer exists.');
        return undefined;
      }

      // Server-side context capture (only when a room is named, and best-effort:
      // a vanished room just means no captured context, not a failed report).
      const context = roomCode ? await captureReportContext(roomCode) : null;

      await db.insert(reports).values({
        reporterId: caller.id,
        reportedId: reportedPlayerId,
        roomCode: roomCode ?? null,
        reason,
        detail: detail ?? '',
        context: context ? (context as unknown as Record<string, unknown>) : null,
      });

      return { ok: true as const };
    },
  );
};
