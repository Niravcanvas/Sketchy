import { z } from 'zod';
import type { GameSettings, Phase } from '@sketchy/engine/types';
import { difficultySchema } from './packs.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../room-code.js';

/**
 * A well-formed room code: exactly `ROOM_CODE_LENGTH` chars, every char drawn
 * from `ROOM_CODE_ALPHABET` (conventions.md §4 — excludes 0/O/1/I/L,
 * uppercase only). Built from the same constants `isValidRoomCode()` uses so
 * the two can never drift. Does NOT normalize (trim/uppercase) — that's a
 * client-input concern (`normalizeRoomCode()`), not a wire-validation one;
 * a lowercase or padded code is simply rejected here.
 */
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const roomCodeSchema = z
  .string()
  .regex(ROOM_CODE_PATTERN, 'Room code must be 5 characters from the room-code alphabet.');

export type RoomCode = z.infer<typeof roomCodeSchema>;

/** Mirrors the engine `SpecialRole` union (data-model.md §3, packages/engine/src/types.ts). */
export const specialRoleSchema = z.enum([
  'judge',
  'ghost',
  'jester',
  'lovebirds',
  'grudge',
  'mirror',
  'rivals',
  'mime',
]);

/**
 * `Partial<GameSettings>` (api-contract.md §1 `POST /rooms`, §2 `lobby:settings`) —
 * every `GameSettings` field (data-model.md §3) made optional. Standalone (not
 * nested under a `settings` key) so `socket.ts` can reuse it verbatim as the
 * `lobby:settings` payload schema.
 *
 * The `satisfies z.ZodType<Partial<GameSettings>>` below is a compile-time
 * proof that this schema's inferred output stays assignable to the engine's
 * `Partial<GameSettings>` — a field whose TYPE drifts from `types.ts` (e.g.
 * `clueTimerSec` stops being `number | null`) fails `tsc`, not just a human
 * reviewer. It does not, on its own, guarantee every engine field is
 * *present* here (that direction of drift, e.g. a wholesale forgotten field,
 * still needs a reviewer or a test); see `rooms.test.ts` for a runtime check
 * that closes that gap.
 */
export const gameSettingsPatchSchema = z
  .object({
    maxPlayers: z.number().int().optional(),
    undercoverCount: z.number().int().optional(),
    mrWhiteCount: z.number().int().optional(),
    specialRoles: z.array(specialRoleSchema).optional(),
    packIds: z.array(z.string()).optional(),
    difficulties: z.array(difficultySchema).optional(),
    clueTimerSec: z.number().nullable().optional(),
    discussionTimerSec: z.number().nullable().optional(),
    voteTimerSec: z.number().nullable().optional(),
    mrWhiteFirstClueBan: z.boolean().optional(),
    eliminationReveal: z.enum(['role', 'word_and_role']).optional(),
  })
  .strict() satisfies z.ZodType<Partial<GameSettings>>;

export type GameSettingsPatch = z.infer<typeof gameSettingsPatchSchema>;

/**
 * Room visibility on creation. ADDITIVE
 * optional field on `POST /rooms` — NOT a `GameSettings` key (the engine
 * never learns about public matchmaking): a
 * public room is simply one seeded with `GameState.mode: 'online_public'`
 * (already an engine-defined mode), listed in `GET /lobbies`, and reachable by
 * the quick-join matcher. Defaults to `'private'` when omitted, so every
 * existing caller keeps creating private rooms unchanged. Creating a
 * `'public'` room requires a linked account (guests get `account_required`).
 */
export const roomVisibilitySchema = z.enum(['private', 'public']);

export type RoomVisibility = z.infer<typeof roomVisibilitySchema>;

/** `POST /v1/rooms` request body (api-contract.md §1). `visibility` is an
 * additive optional field (defaults `'private'`). */
export const createRoomRequestSchema = z.object({
  settings: gameSettingsPatchSchema.optional(),
  visibility: roomVisibilitySchema.optional(),
});

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

/** `POST /v1/rooms` response body (api-contract.md §1). */
export const createRoomResponseSchema = z.object({
  code: roomCodeSchema,
  joinUrl: z.string(),
});

export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;

/**
 * Mirrors the engine `Phase` union (data-model.md §3, packages/engine/src/types.ts).
 * `satisfies z.ZodType<Phase>` catches a phase literal that no longer exists on
 * the engine type (or a typo); it does not by itself catch a phase the engine
 * added that this list forgot — see `rooms.test.ts`.
 */
export const phaseSchema = z.enum([
  'lobby',
  'dealing',
  'clue',
  'discussion',
  'voting',
  'tiebreak_clue',
  'judge_decision',
  'grudge_decision',
  'reveal',
  'mrwhite_guess',
  'game_over',
]) satisfies z.ZodType<Phase>;

/** `GET /v1/rooms/:code` response body — pre-join check (api-contract.md §1). */
export const roomResolutionSchema = z.object({
  code: roomCodeSchema,
  phase: phaseSchema,
  playerCount: z.number().int(),
  maxPlayers: z.number().int(),
  canJoin: z.boolean(),
  canRejoin: z.boolean(),
  hostName: z.string(),
});

export type RoomResolution = z.infer<typeof roomResolutionSchema>;

/**
 * `GET /v1/rooms/:code/voice-token` response body (api-contract.md §1) — a
 * signed LiveKit access token: `identity` = the caller's playerId,
 * `room` (LiveKit room name) = this room code, audio-only publish/subscribe,
 * short TTL (`apps/api/src/voice/livekit-token.ts`). `url` is the LiveKit
 * server's client-facing wss URL the caller should connect to — returned by
 * the API rather than assumed client-side so a non-Next.js client (mobile,
 * `packages/shared/examples/headless-client.ts`) needs no
 * separate config to use voice; the web app's `NEXT_PUBLIC_LIVEKIT_URL` is
 * kept only as a same-origin-dev fallback (`apps/web/src/lib/voice.ts`).
 */
export const voiceTokenResponseSchema = z.object({
  token: z.string(),
  url: z.string(),
});

export type VoiceTokenResponse = z.infer<typeof voiceTokenResponseSchema>;
