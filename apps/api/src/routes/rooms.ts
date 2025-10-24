import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import {
  createRoomRequestSchema,
  createRoomResponseSchema,
  roomResolutionSchema,
  voiceTokenResponseSchema,
} from '@sketchy/shared/contract/rooms';
import { isValidRoomCode, normalizeRoomCode } from '@sketchy/shared/room-code';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { getEnv } from '../env.js';
import { sendError } from '../error-envelope.js';
import { roomCreateRateLimit } from '../rate-limit.js';
import { mintVoiceToken } from '../voice/livekit-token.js';
import { createOnlineRoom } from '../rooms/create-room-service.js';
import { loadRoom } from '../rooms/room-store.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";

const roomCodeParamsSchema = z.object({ code: z.string() });

/** Maps a `createOnlineRoom` error code to its `(status, message)` pair. */
function roomCreateErrorResponse(error: string): { status: number; message: string } {
  switch (error) {
    case 'validation':
      return { status: 400, message: 'Those room settings do not add up. Check role counts and timers.' };
    case 'pack_forbidden':
      return { status: 403, message: "You don't have access to that word pack." };
    default:
      return { status: 500, message: 'Could not create the room. Try again.' };
  }
}

/**
 * Room creation/resolution REST endpoints (api-contract.md §1 "Rooms").
 * Everything after joining is Socket.IO (`sockets/`) — these two routes only
 * allocate a room and let a client check whether it's joinable before it
 * ever opens a socket.
 */
export const roomRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/rooms',
    {
      preHandler: [requireAuth, roomCreateRateLimit],
      schema: {
        body: createRoomRequestSchema,
        response: {
          200: createRoomResponseSchema,
          400: errorEnvelopeSchema,
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

      const visibility = request.body.visibility ?? 'private';

      // Public matchmaking requires a linked account; private rooms
      // stay 100% guest-accessible. Enforced server-side
      // even though the client also gates the affordance.
      if (visibility === 'public' && caller.guest) {
        sendError(
          reply,
          403,
          'account_required',
          'Public rooms need a linked account. Link your email to host one — private rooms never need it.',
        );
        return undefined;
      }

      const db = getDb();
      const [playerRow] = await db.select().from(players).where(eq(players.id, caller.id)).limit(1);
      if (!playerRow) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const result = await createOnlineRoom({
        host: {
          id: playerRow.id,
          displayName: playerRow.displayName,
          avatar: playerRow.avatar,
        },
        settingsPatch: request.body.settings,
        visibility,
      });
      if (!result.ok) {
        const { status, message } = roomCreateErrorResponse(result.error);
        sendError(reply, status, result.error, message);
        return undefined;
      }

      const env = getEnv();
      return { code: result.code, joinUrl: `${env.publicWebUrl}/r/${result.code}` };
    },
  );

  fastify.get(
    '/rooms/:code',
    {
      preHandler: requireAuth,
      schema: {
        params: roomCodeParamsSchema,
        response: {
          200: roomResolutionSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const code = normalizeRoomCode(request.params.code);
      if (!isValidRoomCode(code)) {
        sendError(reply, 404, 'room_not_found', 'Room not found.');
        return undefined;
      }

      const room = await loadRoom(code);
      if (!room) {
        sendError(reply, 404, 'room_not_found', 'Room not found.');
        return undefined;
      }

      const { state } = room;
      const seated = state.players.some((p) => p.id === caller.id);
      const canJoin =
        state.phase === 'lobby' && state.players.length < state.settings.maxPlayers && !seated;
      const host = state.players.find((p) => p.id === state.hostId);

      return {
        code,
        phase: state.phase,
        playerCount: state.players.length,
        maxPlayers: state.settings.maxPlayers,
        canJoin,
        canRejoin: seated,
        hostName: host?.name ?? '',
      };
    },
  );

  /**
   * `GET /v1/rooms/:code/voice-token` (api-contract.md §1) — a signed,
   * audio-only, short-TTL LiveKit access token. Auth +
   * membership only (any SEATED player, alive or eliminated — Ghosts can
   * both listen and speak, game-design.md §9 "heckling encouraged"; there is
   * no phase restriction, voice is legal from the lobby through game over).
   * `VOICE_ENABLED=false` short-circuits before touching the room at all —
   * the kill-switch is a blanket "voice is off", not a per-room check.
   */
  fastify.get(
    '/rooms/:code/voice-token',
    {
      preHandler: requireAuth,
      schema: {
        params: roomCodeParamsSchema,
        response: {
          200: voiceTokenResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const env = getEnv();
      if (!env.voiceEnabled) {
        sendError(
          reply,
          403,
          'voice_disabled',
          'Voice chat is turned off right now — the game itself is unaffected.',
        );
        return undefined;
      }

      const code = normalizeRoomCode(request.params.code);
      if (!isValidRoomCode(code)) {
        sendError(reply, 404, 'room_not_found', 'Room not found.');
        return undefined;
      }

      const room = await loadRoom(code);
      if (!room) {
        sendError(reply, 404, 'room_not_found', 'Room not found.');
        return undefined;
      }

      const player = room.state.players.find((p) => p.id === caller.id);
      if (!player) {
        // Existence-hiding for non-members, same posture as other member-only
        // reads in this codebase (api-contract.md §1 GET /players/me/games/:gameId).
        sendError(reply, 404, 'room_not_found', 'Room not found.');
        return undefined;
      }

      const result = await mintVoiceToken({
        roomCode: code,
        playerId: caller.id,
        playerName: player.name,
      });
      return result;
    },
  );
};
