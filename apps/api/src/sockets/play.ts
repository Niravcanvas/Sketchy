import { randomUUID } from 'node:crypto';
import type { GameState } from '@sketchy/engine/types';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  clueSubmitPayloadSchema,
  dealAckPayloadSchema,
  gameRematchPayloadSchema,
  gameStartPayloadSchema,
  hostTransferPayloadSchema,
  mrWhiteGuessPayloadSchema,
  phaseAdvancePayloadSchema,
  specialGrudgePayloadSchema,
  specialJudgePayloadSchema,
  timerExtendPayloadSchema,
  turnSkipPayloadSchema,
  voteCastPayloadSchema,
} from '@sketchy/shared/contract/socket';
import type {
  BasicAck,
  ClueSubmitPayload,
  HostTransferPayload,
  MrWhiteGuessPayload,
  SpecialGrudgePayload,
  SpecialJudgePayload,
  VoteCastPayload,
} from '@sketchy/shared/contract/socket';
import { containsProfanity } from '@sketchy/shared/profanity';
import type { FastifyBaseLogger } from 'fastify';
import { getDb, getRedis } from '../db/client.js';
import { games } from '../db/schema.js';
import { allPackIdsAccessible } from '../routes/pack-access.js';
import { applyBroadcastAndSchedule } from '../rooms/apply-and-broadcast.js';
import { drawPairForRoom } from '../rooms/pair-draw.js';
import { migrateHostTo } from '../rooms/presence-timers.js';
import { delistPublicLobby } from '../rooms/public-lobbies.js';
import { ROOM_TTL_SECONDS, gameIdKey, loadRoom } from '../rooms/room-store.js';
import type { GameNamespace, GameSocket } from './types.js';
import { wireHandler } from './wire.js';

/**
 * Registers the online gameplay events for one connected socket
 * (api-contract.md §2.1): loop A (`game:start`, `deal:ack`,
 * `clue:submit`, `phase:advance`, `turn:skip`, `timer:extend`) plus loop B
 * (`vote:cast`, `mrwhite:guess`, `game:rematch`), plus the Judge
 * special role's `special:judge` and the Grudge special role's
 * `special:grudge`.
 *
 * Every handler follows the `wireHandler` pipeline (zod → rate limit
 * → handler → ack) and, on an accepted engine action, goes through
 * `applyBroadcastAndSchedule` (CAS-apply → broadcast the fresh snapshot →
 * route `effects` to the timer wheel + game persistence) — never a bare
 * `applyRoomAction` call, so no game-play transition can forget to arm/clear
 * its timer or persist its final state.
 */
export function registerPlayHandlers(
  namespace: GameNamespace,
  socket: GameSocket,
  logger: FastifyBaseLogger,
): void {
  socket.on(
    CLIENT_EVENTS.gameStart,
    wireHandler(logger, socket, CLIENT_EVENTS.gameStart, gameStartPayloadSchema, 'action', (_payload, ack) =>
      handleGameStart(namespace, socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.dealAck,
    wireHandler(logger, socket, CLIENT_EVENTS.dealAck, dealAckPayloadSchema, 'action', (_payload, ack) =>
      handleDealAck(namespace, socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.clueSubmit,
    wireHandler(logger, socket, CLIENT_EVENTS.clueSubmit, clueSubmitPayloadSchema, 'action', (payload, ack) =>
      handleClueSubmit(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.phaseAdvance,
    wireHandler(logger, socket, CLIENT_EVENTS.phaseAdvance, phaseAdvancePayloadSchema, 'action', (_payload, ack) =>
      handlePhaseAdvance(namespace, socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.turnSkip,
    wireHandler(logger, socket, CLIENT_EVENTS.turnSkip, turnSkipPayloadSchema, 'action', (_payload, ack) =>
      handleTurnSkip(namespace, socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.timerExtend,
    wireHandler(logger, socket, CLIENT_EVENTS.timerExtend, timerExtendPayloadSchema, 'action', (_payload, ack) =>
      handleTimerExtend(namespace, socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.voteCast,
    wireHandler(logger, socket, CLIENT_EVENTS.voteCast, voteCastPayloadSchema, 'action', (payload, ack) =>
      handleVoteCast(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.mrWhiteGuess,
    wireHandler(logger, socket, CLIENT_EVENTS.mrWhiteGuess, mrWhiteGuessPayloadSchema, 'action', (payload, ack) =>
      handleMrWhiteGuess(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.gameRematch,
    wireHandler(logger, socket, CLIENT_EVENTS.gameRematch, gameRematchPayloadSchema, 'action', (_payload, ack) =>
      handleRematch(namespace, socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.hostTransfer,
    wireHandler(logger, socket, CLIENT_EVENTS.hostTransfer, hostTransferPayloadSchema, 'action', (payload, ack) =>
      handleHostTransfer(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.specialJudge,
    wireHandler(logger, socket, CLIENT_EVENTS.specialJudge, specialJudgePayloadSchema, 'action', (payload, ack) =>
      handleSpecialJudge(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.specialGrudge,
    wireHandler(logger, socket, CLIENT_EVENTS.specialGrudge, specialGrudgePayloadSchema, 'action', (payload, ack) =>
      handleSpecialGrudge(namespace, socket, payload, ack),
    ),
  );
}

/**
 * Inserts a fresh `games` row (data-model.md §1) from the POST-APPLY state and
 * records it as the room's running game in Redis. Shared by `game:start` and
 * `game:rematch` — a rematch is a NEW game (its own row, its own
 * `game_players`), so it re-runs the exact same row-creation the first start
 * did. Reads the RESOLVED `state.pair`: the engine flips which side is Civilian
 * at deal time (`packages/engine/src/reducers/deal.ts`), so the pre-flip drawn
 * pair must never be stored.
 */
async function insertGameRow(code: string, state: GameState): Promise<void> {
  const gameId = randomUUID();
  await getDb()
    .insert(games)
    .values({
      id: gameId,
      roomCode: code,
      mode: state.mode,
      hostPlayerId: state.hostId,
      settings: state.settings,
      pairId: state.pair.pairId,
      civilianWord: state.pair.civilianWord,
      undercoverWord: state.pair.undercoverWord,
      startedAt: new Date(),
    });
  await getRedis().set(gameIdKey(code), gameId, 'EX', ROOM_TTL_SECONDS);
}

async function handleGameStart(
  namespace: GameNamespace,
  socket: GameSocket,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  const room = await loadRoom(code);
  if (!room) {
    ack({ ok: false, error: 'room_not_found' });
    return;
  }

  // Draw-time access check: a private/unlisted
  // custom pack referenced in `settings.packIds` must still be accessible to
  // the CALLER (official/owned/imported — `routes/pack-access.ts`, the same
  // gate `lobby:settings` already applied when the selection was made).
  // Re-checked here, not just trusted from settings time, because access can
  // change in between (the owner deletes the pack, revisits visibility,
  // etc.) — a room "using someone's private pack" only keeps working for
  // everyone as long as WHOEVER is starting the game still has standing for
  // every pack it draws from. Only the actual host's `start` can ever
  // succeed past this point anyway (the engine rejects non-host `start`), so
  // checking the caller here — even before we know they're the host — costs
  // nothing extra in the common case and fails closed in the uncommon one.
  if (!(await allPackIdsAccessible(room.state.settings.packIds, playerId))) {
    ack({ ok: false, error: 'pack_forbidden' });
    return;
  }

  // Drawn against a plain pre-read of `settings` (mirrors
  // `handleLobbySettings`'s pack-official pre-check, sockets/lobby.ts) rather
  // than inside the CAS transaction below — a judgment call: the pair is
  // SPENT (rooms/pair-draw.ts SADDs it into `usedPairs` immediately) even if
  // the `start` dispatch then rejects (not host, role math, a settings race).
  // Accepted as a minor inefficiency, not a correctness bug — the recycle
  // step in `drawPairForRoom` means the pool never actually runs dry from it.
  const pair = await drawPairForRoom(code, room.state.settings);
  if (!pair) {
    ack({ ok: false, error: 'empty_pool' });
    return;
  }

  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'start',
    playerId,
    pair,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }

  // Create the `games` row (started_at) from the POST-APPLY state; game-over
  // completes it (rooms/persist-game.ts).
  await insertGameRow(code, result.state);

  // A public room that just started a game leaves the browse index —
  // no mid-game drop-ins. Idempotent for private rooms
  // (they were never listed).
  if (result.state.mode === 'online_public') {
    await delistPublicLobby(code);
  }

  ack({ ok: true });
}

async function handleDealAck(
  namespace: GameNamespace,
  socket: GameSocket,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'ackWord',
    playerId,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

async function handleClueSubmit(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: ClueSubmitPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  // Profanity is checked here (same filter as chat, sockets/lobby.ts
  // `handleChatSend`) BEFORE the engine ever sees the text — the engine has
  // no notion of profanity, only turn/phase/length/repeat/secret-word.
  // Public rooms use the STRICT filter (a cheap pre-read of the room's mode).
  const room = await loadRoom(code);
  const strict = room?.state.mode === 'online_public';
  if (containsProfanity(payload.text, { strict })) {
    ack({ ok: false, error: 'profanity' });
    return;
  }

  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'submitClue',
    playerId,
    text: payload.text,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

async function handleTurnSkip(
  namespace: GameNamespace,
  socket: GameSocket,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'skipTurn',
    playerId,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

async function handlePhaseAdvance(
  namespace: GameNamespace,
  socket: GameSocket,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'advancePhase',
    playerId,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

async function handleTimerExtend(
  namespace: GameNamespace,
  socket: GameSocket,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'extendTimer',
    playerId,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  // copy.md §8 has a dedicated "timer extended" toast line — the room:event
  // fan-out that drives it (api-contract.md §2.2 room:event `timerExtended`).
  namespace.to(code).emit(SERVER_EVENTS.roomEvent, { type: 'timerExtended' });
  ack({ ok: true });
}

async function handleVoteCast(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: VoteCastPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  // The engine owns every ballot rule (phase/alive/self/tied-target/
  // already-voted) and closes the vote itself the instant the last eligible
  // ballot lands — this handler just records the ballot and lets the resulting
  // effects (reveal timer, or the tiebreak clue timer) route as usual.
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'castVote',
    playerId,
    targetId: payload.targetId,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

/**
 * `special:judge` — the Judge special role's tie-breaking call
 * (api-contract.md §2.1). No pre-check here beyond phase/actor/target — those are exactly
 * the engine's `judgeDecide` reducer's job (`judge_decision` only, actor must hold
 * `specialRole === 'judge'`, target must be one of `tiedPlayerIds`), same division of
 * labor as every other gameplay handler in this file.
 */
async function handleSpecialJudge(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: SpecialJudgePayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'judgeDecide',
    playerId,
    targetId: payload.targetId,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

/**
 * `special:grudge` — the Grudge special role's drag-down choice
 * (api-contract.md §2.1). No pre-check here beyond phase/actor/target — those are exactly
 * the engine's `grudgeDrag` reducer's job (`grudge_decision` only, actor must BE the
 * just-eliminated `pendingElimination` and hold `specialRole === 'grudge'`, target must be
 * currently alive), same division of labor as `handleSpecialJudge` above.
 */
async function handleSpecialGrudge(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: SpecialGrudgePayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'grudgeDrag',
    playerId,
    targetId: payload.targetId,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

async function handleMrWhiteGuess(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: MrWhiteGuessPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  // Wire payload is `{ word }`; the engine action field is `text` (its match
  // is case/diacritic-insensitive — reveal.ts `normalizeGuess`). A correct
  // guess enters `game_over` (Mr. White steal) → `persistGame`; a wrong one
  // resolves the standing elimination and play continues.
  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'mrWhiteGuess',
    playerId,
    text: payload.word,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  ack({ ok: true });
}

async function handleRematch(
  namespace: GameNamespace,
  socket: GameSocket,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  const room = await loadRoom(code);
  if (!room) {
    ack({ ok: false, error: 'room_not_found' });
    return;
  }

  // Same draw-time access re-check as `game:start` (see that handler's note)
  // — a rematch draws a fresh pair too.
  if (!(await allPackIdsAccessible(room.state.settings.packIds, playerId))) {
    ack({ ok: false, error: 'pack_forbidden' });
    return;
  }

  // Same pre-CAS draw as `game:start` (see that handler's note): a fresh pair
  // de-duped against `room:{code}:usedPairs` (game-design.md §6.7 "fresh pair,
  // de-duped"). Drawing before the `rematch` dispatch means a rejected rematch
  // (non-host, wrong phase, bad role math after leavers) spends a pair — the
  // accepted minor inefficiency the recycle step in `drawPairForRoom` covers.
  const pair = await drawPairForRoom(code, room.state.settings);
  if (!pair) {
    ack({ ok: false, error: 'empty_pool' });
    return;
  }

  const result = await applyBroadcastAndSchedule(namespace, code, {
    type: 'rematch',
    playerId,
    pair,
    at: Date.now(),
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }

  // A rematch is a NEW game (the previous one was persisted on its game_over) —
  // create its `games` row and point `room:{code}:gameId` at it, exactly like
  // `game:start`. The engine carried the session scoreboard over in state.
  await insertGameRow(code, result.state);

  ack({ ok: true });
}

/**
 * `host:transfer` — the sitting host manually hands the pencil to another seated
 * player (game-design.md §8). Host-only, enforced in the CAS closure so the check
 * and the swap are atomic; the engine's `migrateHost` then validates the target is
 * a real seated player. `migrateHostTo` broadcasts + fans out `hostChanged`.
 */
async function handleHostTransfer(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: HostTransferPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  const room = await loadRoom(code);
  if (!room) {
    ack({ ok: false, error: 'room_not_found' });
    return;
  }
  if (room.state.hostId !== playerId) {
    ack({ ok: false, error: 'not_host' });
    return;
  }
  if (!room.state.players.some((p) => p.id === payload.targetId)) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  const migrated = await migrateHostTo(namespace, code, payload.targetId);
  if (!migrated) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  ack({ ok: true });
}
