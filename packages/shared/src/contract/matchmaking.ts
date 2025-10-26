import { z } from 'zod';
import { roomCodeSchema } from './rooms.js';

/**
 * Matchmaking wire contract (api-contract.md §1 "Matchmaking" +
 * §2.2 `mm:matched`). All ADDITIVE to the frozen `/v1` surface — new
 * endpoints and a new server→client socket event, never a change to an
 * existing shape (contract checklist §4).
 *
 * Room "language" is a short lowercase tag matching the `word_packs.language`
 * convention (data-model.md §1, default `'en'`) — it's the only grouping
 * dimension the launch-scale matcher uses. Kept a plain constrained string rather than a closed enum so a
 * new content language never needs a contract change to be matchable.
 */
export const languageSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}(-[a-z]{2})?$/, 'Language must be a 2-letter code, optionally region-suffixed.');

export type Language = z.infer<typeof languageSchema>;

/**
 * One row of `GET /v1/lobbies` — a public room currently in its lobby phase,
 * browsable by any authenticated caller (api-contract.md §1). Deliberately a
 * lean projection (no secret/game state, ever — these rooms are pre-game by
 * construction): just what the browser list card renders.
 */
export const lobbyItemSchema = z.object({
  code: roomCodeSchema,
  hostName: z.string(),
  playerCount: z.number().int(),
  maxPlayers: z.number().int(),
  language: languageSchema,
});

export type LobbyItem = z.infer<typeof lobbyItemSchema>;

/** `GET /v1/lobbies` response body — cursor pagination envelope (api-contract.md §0). */
export const lobbiesPageSchema = z.object({
  items: z.array(lobbyItemSchema),
  nextCursor: z.string().nullable(),
});

export type LobbiesPage = z.infer<typeof lobbiesPageSchema>;

/**
 * `POST /v1/matchmaking/queue` request body — the caller joins the quick-join
 * queue for `language`. Resolution is pushed asynchronously over the socket
 * as `mm:matched { code }` (below), never in this response — the matcher runs
 * on its own interval.
 */
export const matchmakingQueueRequestSchema = z.object({
  language: languageSchema,
});

export type MatchmakingQueueRequest = z.infer<typeof matchmakingQueueRequestSchema>;

/**
 * `POST /v1/matchmaking/queue` response body — a bare acknowledgement that the
 * caller is now queued (api-contract.md §1: `{ status: 'queued' }`). Numeric
 * queue position is deliberately NOT returned here (kept exactly the doc's
 * shape): at launch scale the queue is short and the client renders a
 * "searching…" state with a local elapsed timer + a 90s "host instead?"
 * fallback rather than a precise ordinal.
 */
export const matchmakingQueueResponseSchema = z.object({
  status: z.literal('queued'),
});

export type MatchmakingQueueResponse = z.infer<typeof matchmakingQueueResponseSchema>;

/**
 * `mm:matched` (api-contract.md §2.2) — the server→client push that
 * resolves a quick-join queue entry: the code of the public room the caller
 * has been matched into. The client navigates to `/r/{code}` and joins via
 * the ordinary `room:join`. Fanned to the caller's per-player socket room
 * (they aren't in a game room yet when queued), so every open tab for that
 * player learns of the match. Cosmetic-adjacent like `chat:message`/`voice:*`
 * — never part of `room:snapshot`/`GameState`.
 */
export const mmMatchedSchema = z.object({
  code: roomCodeSchema,
});

export type MmMatched = z.infer<typeof mmMatchedSchema>;
