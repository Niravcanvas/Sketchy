import { z } from 'zod';
import type { RedactedGameState } from '@sketchy/engine/redact-for';
import type { ErrorCode } from './errors.js';
import { mmMatchedSchema } from './matchmaking.js';
import type { MmMatched } from './matchmaking.js';
import { gameSettingsPatchSchema, roomCodeSchema, specialRoleSchema } from './rooms.js';
import type { GameSettingsPatch } from './rooms.js';

/**
 * Socket.IO `/game` namespace protocol (api-contract.md §2) — the single
 * source of truth for event names and payload shapes. Clients never
 * hand-type event strings; they index `CLIENT_EVENTS` / `SERVER_EVENTS`.
 *
 * `special:judge` is live (the Judge special role); `special:grudge` is
 * live (the Grudge special role); `voice:*` is live — `voice:state`
 * (client→server mute report) and `voice:roster` (server→client mute
 * mirror — api-contract.md §2.2's doc comment on `voiceRosterSchema`
 * explains why it isn't just `voice:state` echoed back). Both stay inside
 * the `voice:*` namespace and stay EPHEMERAL — never folded into
 * `room:snapshot`/`GameState` (voice is cosmetic to the engine,
 * system-design.md §8).
 *
 * `mm:matched` is the ONE `mm:*` server→client event
 * (matchmaking queue resolution, `SERVER_EVENTS.matched`, payload
 * `mmMatchedSchema` re-exported below from `matchmaking.ts`). There is no
 * client→server `mm:*` event: quick-join enqueue/cancel are REST
 * (`POST/DELETE /matchmaking/queue`, api-contract.md §1), and the ONLY socket
 * traffic matchmaking adds is this one server push. So `CLIENT_EVENTS` gains
 * nothing from matchmaking, and the additive-only socket freeze
 * (`socket-freeze.test.ts`, which tracks CLIENT→server required keys) is
 * untouched by it.
 */
export const CLIENT_EVENTS = {
  roomJoin: 'room:join',
  roomLeave: 'room:leave',
  roomSync: 'room:sync',
  lobbyReady: 'lobby:ready',
  lobbySettings: 'lobby:settings',
  lobbyKick: 'lobby:kick',
  gameStart: 'game:start',
  dealAck: 'deal:ack',
  clueSubmit: 'clue:submit',
  phaseAdvance: 'phase:advance',
  turnSkip: 'turn:skip',
  voteCast: 'vote:cast',
  mrWhiteGuess: 'mrwhite:guess',
  gameRematch: 'game:rematch',
  chatSend: 'chat:send',
  timePing: 'time:ping',
  timerExtend: 'timer:extend',
  hostTransfer: 'host:transfer',
  specialJudge: 'special:judge',
  specialGrudge: 'special:grudge',
  voiceState: 'voice:state',
} as const;

export const SERVER_EVENTS = {
  roomSnapshot: 'room:snapshot',
  roomEvent: 'room:event',
  chatMessage: 'chat:message',
  sessionSuperseded: 'session:superseded',
  voiceRoster: 'voice:roster',
  matched: 'mm:matched',
} as const;

/** `mm:matched` payload — re-exported from `matchmaking.ts` so the
 * socket layer's server→client event map can import every payload type from
 * this one module, same as every other socket payload. */
export { mmMatchedSchema };
export type { MmMatched };

// ---------------------------------------------------------------------------
// Client → server payload schemas (api-contract.md §2.1). Every payload is
// `.strict()` — an unrecognized key is a validation error, not a silently
// dropped field, since the client and server are independently deployed.
// ---------------------------------------------------------------------------

/** Shared by every event whose payload is empty (`{}`). */
const emptyPayloadSchema = z.object({}).strict();

/** `room:join` — code format only; normalization (trim/uppercase) is a client-input concern. */
export const roomJoinPayloadSchema = z.object({ code: roomCodeSchema }).strict();
export type RoomJoinPayload = z.infer<typeof roomJoinPayloadSchema>;

/** `room:leave` */
export const roomLeavePayloadSchema = emptyPayloadSchema;
export type RoomLeavePayload = z.infer<typeof roomLeavePayloadSchema>;

/** `room:sync` */
export const roomSyncPayloadSchema = z.object({ lastVer: z.number().int().min(0) }).strict();
export type RoomSyncPayload = z.infer<typeof roomSyncPayloadSchema>;

/** `lobby:ready` */
export const lobbyReadyPayloadSchema = z.object({ ready: z.boolean() }).strict();
export type LobbyReadyPayload = z.infer<typeof lobbyReadyPayloadSchema>;

/** `lobby:settings` — reuses `gameSettingsPatchSchema` verbatim (rooms.ts). */
export const lobbySettingsPayloadSchema = gameSettingsPatchSchema;
export type LobbySettingsPayload = GameSettingsPatch;

/** `lobby:kick` */
export const lobbyKickPayloadSchema = z.object({ playerId: z.uuid() }).strict();
export type LobbyKickPayload = z.infer<typeof lobbyKickPayloadSchema>;

/** `game:start` */
export const gameStartPayloadSchema = emptyPayloadSchema;
export type GameStartPayload = z.infer<typeof gameStartPayloadSchema>;

/** `deal:ack` */
export const dealAckPayloadSchema = emptyPayloadSchema;
export type DealAckPayload = z.infer<typeof dealAckPayloadSchema>;

/** `clue:submit` — 1-40 chars after trim; secret-word/repeat/profanity checks are server-side (engine). */
export const clueSubmitPayloadSchema = z
  .object({ text: z.string().trim().min(1).max(40) })
  .strict();
export type ClueSubmitPayload = z.infer<typeof clueSubmitPayloadSchema>;

/** `phase:advance` */
export const phaseAdvancePayloadSchema = emptyPayloadSchema;
export type PhaseAdvancePayload = z.infer<typeof phaseAdvancePayloadSchema>;

/** `turn:skip` */
export const turnSkipPayloadSchema = emptyPayloadSchema;
export type TurnSkipPayload = z.infer<typeof turnSkipPayloadSchema>;

/** `vote:cast` */
export const voteCastPayloadSchema = z.object({ targetId: z.uuid() }).strict();
export type VoteCastPayload = z.infer<typeof voteCastPayloadSchema>;

/** `mrwhite:guess` — 1-60 chars after trim; case/diacritic-insensitive matching is server-side. */
export const mrWhiteGuessPayloadSchema = z
  .object({ word: z.string().trim().min(1).max(60) })
  .strict();
export type MrWhiteGuessPayload = z.infer<typeof mrWhiteGuessPayloadSchema>;

/** `game:rematch` */
export const gameRematchPayloadSchema = emptyPayloadSchema;
export type GameRematchPayload = z.infer<typeof gameRematchPayloadSchema>;

/** `chat:send` — 1-200 chars after trim; rate-limit/profanity are server-side. */
export const chatSendPayloadSchema = z.object({ text: z.string().trim().min(1).max(200) }).strict();
export type ChatSendPayload = z.infer<typeof chatSendPayloadSchema>;

/** `time:ping` */
export const timePingPayloadSchema = emptyPayloadSchema;
export type TimePingPayload = z.infer<typeof timePingPayloadSchema>;

/** `timer:extend` — host's once-per-phase +60s (engine `extendTimer`; game-design.md §6.3).
 * The engine action existed without a wire event until the discussion UI needed it. */
export const timerExtendPayloadSchema = emptyPayloadSchema;
export type TimerExtendPayload = z.infer<typeof timerExtendPayloadSchema>;

/** `host:transfer` — the host hands the pencil to another seated player via the player-card
 * action (game-design.md §8 "the new host can hand it back"). Host-only, enforced
 * server-side (`sockets/play.ts`); dispatches the engine's `migrateHost` and fans out the
 * `hostChanged` toast. The auto-migration path (grace expiry / explicit
 * host leave) is server-originated and needs no client event, but the manual hand-back is a
 * genuine new client intent (api-contract.md §4 checklist). */
export const hostTransferPayloadSchema = z.object({ targetId: z.uuid() }).strict();
export type HostTransferPayload = z.infer<typeof hostTransferPayloadSchema>;

/** `special:judge` — the Judge special role's tie-breaking call (game-design.md §6.4 "the
 * tie instead routes to the Judge"). Judge-only, `judge_decision` phase only,
 * enforced server-side by the engine's `judgeDecide` reducer; `targetId` must be one of the
 * tied players the engine routed here. */
export const specialJudgePayloadSchema = z.object({ targetId: z.uuid() }).strict();
export type SpecialJudgePayload = z.infer<typeof specialJudgePayloadSchema>;

/** `special:grudge` — the Grudge special role's drag-down choice. Grudge-only
 * (must currently BE the just-eliminated `pendingElimination`), `grudge_decision` phase
 * only, enforced server-side by the engine's `grudgeDrag` reducer; `targetId` must name a
 * currently ALIVE player. Same shape as `special:judge` — a single required `targetId`. */
export const specialGrudgePayloadSchema = z.object({ targetId: z.uuid() }).strict();
export type SpecialGrudgePayload = z.infer<typeof specialGrudgePayloadSchema>;

/** `voice:state` (api-contract.md §2.1) — mirrors the caller's OWN LiveKit mute
 * state into the player strip for participants who aren't themselves connected to voice
 * (game-design.md §10). Sender-only: the server never trusts a claimed `playerId` here — it
 * reads the actor off `socket.data.playerId`, same as every other event (`sockets/voice.ts`).
 * No phase/turn restriction (mute is legal in lobby AND every game phase, including as a
 * spectator/Ghost — voice is cosmetic to the engine, never gated by it). */
export const voiceStatePayloadSchema = z.object({ muted: z.boolean() }).strict();
export type VoiceStatePayload = z.infer<typeof voiceStatePayloadSchema>;

// ---------------------------------------------------------------------------
// Ack envelope (api-contract.md §2: "Every client→server event uses an ack
// callback"). Not a zod schema — the server constructs it, the client
// narrows on `.ok`; there is nothing untrusted to parse on either side.
// ---------------------------------------------------------------------------

export type SocketAck<T = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; error: ErrorCode };

/** `room:join` ack (api-contract.md §2.1). */
export type JoinAck = SocketAck<{ snapshot: RoomSnapshot }>;

/** `room:sync` ack (api-contract.md §2.1). */
export type SyncAck = SocketAck<{ snapshot: RoomSnapshot }>;

/** `time:ping` ack — round-trip clock offset measurement (api-contract.md §2.3). */
export type TimePingAck = SocketAck<{ serverNow: number }>;

/** Every other client→server event: `{ ok: true }` or `{ ok: false, error }`, no extra data. */
export type BasicAck = SocketAck;

// ---------------------------------------------------------------------------
// Server → client payloads (api-contract.md §2.2).
// ---------------------------------------------------------------------------

/**
 * `canAct` is computed server-side so clients never re-derive permission
 * logic (api-contract.md §2.2). This key list is pinned exactly — the doc's
 * `{ submitClue, vote, judge, ... }` ellipsis resolves to these seven, PLUS
 * `grudge` (the Grudge special role's `special:grudge` action).
 */
export const youSliceCanActSchema = z.object({
  submitClue: z.boolean(),
  vote: z.boolean(),
  judge: z.boolean(),
  grudge: z.boolean(),
  advancePhase: z.boolean(),
  start: z.boolean(),
  kick: z.boolean(),
  extendTimer: z.boolean(),
});

export type YouSliceCanAct = z.infer<typeof youSliceCanActSchema>;

/**
 * The caller's private slice of state (data-model.md §4, api-contract.md §2.2).
 * `lovebirdsPartnerId`/`rivalId` are the ONE `you`-slice concern the paired
 * special roles need: the PARTNER's identity is secret (their `specialRole` stays hidden
 * to everyone else per the ordinary redaction rule), but their NAME is not — it's already
 * public on the redacted `players` array — so exposing just the id here (server-computed,
 * `null` unless the viewer actually holds that paired role) is enough for a client to
 * render "linked to {name}" via a lookup, without inventing any new public state or a new
 * early-reveal redaction exception (arch/data-model.md "Phase 13 engine extension").
 */
export const youSliceSchema = z.object({
  playerId: z.string(),
  role: z.enum(['civilian', 'undercover', 'mrwhite']).nullable(),
  word: z.string().nullable(),
  specialRole: specialRoleSchema.nullable(),
  yourVote: z.string().nullable(),
  canAct: youSliceCanActSchema,
  lovebirdsPartnerId: z.string().nullable(),
  rivalId: z.string().nullable(),
});

export type YouSlice = z.infer<typeof youSliceSchema>;

/**
 * `room:snapshot` (api-contract.md §2.2) — "the only way state reaches
 * clients". `state` is typed via a TYPE-ONLY import of the engine's real
 * `RedactedGameState` (packages/engine/src/redact-for.ts); the zod side uses
 * `z.custom<RedactedGameState>()` rather than restating its full structure,
 * since `state` is always server-produced and already engine-typed —
 * re-deriving a parallel zod shape for it would be redundant surface that
 * drifts, not protection against drift.
 */
export const roomSnapshotSchema = z.object({
  ver: z.number(),
  state: z.custom<RedactedGameState>(),
  you: youSliceSchema,
});

export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

/**
 * `room:event` (api-contract.md §2.2) — transient, non-state toasts.
 * `playerJoined` / `playerLeft` / `playerDisconnected` / `playerReconnected` /
 * `hostChanged` / `kicked` all carry `{ type, playerId, name }`; `timerExtended`
 * carries no extra data. Modeled as a discriminated union on `type` (rather
 * than one loose object) so a consumer's `switch` is exhaustively checked.
 */
const roomPlayerEventSchema = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    playerId: z.string(),
    name: z.string(),
  });

export const roomEventSchema = z.discriminatedUnion('type', [
  roomPlayerEventSchema('playerJoined'),
  roomPlayerEventSchema('playerLeft'),
  roomPlayerEventSchema('playerDisconnected'),
  roomPlayerEventSchema('playerReconnected'),
  roomPlayerEventSchema('hostChanged'),
  roomPlayerEventSchema('kicked'),
  z.object({ type: z.literal('timerExtended') }),
]);

export type RoomEvent = z.infer<typeof roomEventSchema>;

/** `chat:message` (api-contract.md §2.2) — fan-out of `chat:send`; ephemeral, never replayed on resync. */
export const chatMessageSchema = z.object({
  from: z.object({ id: z.string(), name: z.string() }),
  text: z.string(),
  at: z.number(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * `voice:roster` (api-contract.md §2.2) — the server→client mute mirror. Design
 * decision: the whole point of `voice:state`
 * is that participants who are NOT themselves connected to LiveKit (declined the mic prompt,
 * or are just watching) still need to see WHO IS MUTED in the player strip — LiveKit's own
 * mute events only reach clients that joined that LiveKit room. So the server fans the
 * CURRENT mute state of every player who has ever sent `voice:state` this room-session out to
 * the whole game-socket room (not just other LiveKit participants) as a full map, keyed by
 * playerId — simpler and self-healing for a late joiner/resync than a diff protocol would be,
 * and rooms top out at 20 players so the payload stays tiny. Sent: (a) to the whole room
 * whenever any player's `voice:state` changes, and (b) to a single just-(re)joined socket
 * right after its `room:join`/`room:sync` bind, so it doesn't have to wait for someone else to
 * toggle mute to see the current icons. Deliberately NOT part of `room:snapshot` — voice
 * presence is cosmetic to the engine and must never enter `GameState` (system-design.md §8);
 * this is its own tiny, ephemeral channel, same spirit as `chat:message`.
 */
export const voiceRosterSchema = z.object({
  muted: z.record(z.string(), z.boolean()),
});

export type VoiceRoster = z.infer<typeof voiceRosterSchema>;
