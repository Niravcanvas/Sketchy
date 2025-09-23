import { MIN_PLAYERS } from '@sketchy/engine/constants';
import { redactFor } from '@sketchy/engine/redact-for';
import { currentTurnOrder, isHost, pairedPartnerId } from '@sketchy/engine/reducers/shared';
import type { GameState } from '@sketchy/engine/types';
import { SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type { RoomSnapshot, YouSlice, YouSliceCanAct } from '@sketchy/shared/contract/socket';
import type { GameNamespace } from '../sockets/types.js';

/**
 * `YouSlice.canAct` (api-contract.md §2.2) — computed server-side so no
 * client ever re-derives permission logic. Each flag mirrors the exact
 * reducer precondition it stands in for (pinned semantics).
 */
function buildCanAct(state: GameState, playerId: string): YouSliceCanAct {
  const player = state.players.find((p) => p.id === playerId);
  const host = isHost(state, playerId);

  const turnOrder = currentTurnOrder(state);
  const currentTurnHolder = state.turnSeat !== null ? turnOrder[state.turnSeat] : undefined;
  const isClueTurn =
    (state.phase === 'clue' || state.phase === 'tiebreak_clue') &&
    currentTurnHolder?.id === playerId;

  // Ghost (settings.specialRoles containing 'ghost') keeps eliminated players'
  // vote:cast rights — mirrors reducers/vote.ts's eligibleVoterIds/applyCastVote exactly.
  const ghostActive = state.settings.specialRoles.includes('ghost');
  const canVote =
    state.phase === 'voting' &&
    !(player?.hasLeft ?? true) &&
    ((player?.alive ?? false) || ghostActive);

  // Judge special role: actionable only during judge_decision, only for the
  // player holding specialRole 'judge' — alive or eliminated (reducers/vote.ts
  // applyJudgeDecide has no `.alive` check either, research/03).
  const canJudge = state.phase === 'judge_decision' && player?.specialRole === 'judge';

  // Grudge special role: actionable only during grudge_decision, only for the
  // player who IS the just-eliminated `pendingElimination` AND holds specialRole 'grudge'
  // — mirrors reducers/cascade.ts `applyGrudgeDrag`'s own actor check exactly.
  const canGrudge =
    state.phase === 'grudge_decision' &&
    player?.specialRole === 'grudge' &&
    player.id === state.pendingElimination;

  return {
    submitClue: isClueTurn,
    vote: canVote,
    judge: canJudge,
    grudge: canGrudge,
    // judge_decision / grudge_decision (same shape): the
    // host may also force the same deterministic default
    // `resolveJudgeDecisionByDefault`/`resolveGrudgeDecisionByDefault` uses on timeout —
    // mirrors reducers/vote.ts, reducers/cascade.ts / apply-action.ts's `applyAdvancePhase`
    // exactly. No dedicated UI surfaces this yet (the automatic timeout already guarantees
    // the game can't stall); this flag being accurate is what a future "force decide"
    // affordance would key off.
    advancePhase:
      host &&
      (state.phase === 'discussion' ||
        state.phase === 'reveal' ||
        state.phase === 'judge_decision' ||
        state.phase === 'grudge_decision'),
    start: host && state.phase === 'lobby' && state.players.length >= MIN_PLAYERS,
    kick: host && state.phase === 'lobby',
    extendTimer: host && state.phaseEndsAt !== null && !state.timerExtended,
  };
}

/**
 * The caller's private `you` slice (data-model.md §4, api-contract.md §2.2).
 * `role`/`word`/`specialRole` are read from `redactFor(state, playerId)`'s
 * OWN entry — `redactFor` is the only redaction path, no ad-hoc field
 * picking off the raw `GameState`. `yourVote` is the one raw read allowed
 * server-side (it's the viewer's OWN ballot, not someone else's secret).
 * `lovebirdsPartnerId`/`rivalId` are read from the FULL, unredacted `state` via
 * `pairedPartnerId` — safe because this whole function only ever computes ONE viewer's own
 * private slice (never broadcast to anyone else), and `pairedPartnerId` itself returns
 * `null` unless `playerId` genuinely holds that paired role (arch/data-model.md "Phase 13
 * engine extension").
 */
export function buildYouSlice(state: GameState, playerId: string): YouSlice {
  const redacted = redactFor(state, playerId);
  const me = redacted.players.find((p) => p.id === playerId);

  return {
    playerId,
    role: me?.role ?? null,
    word: me?.word ?? null,
    specialRole: me?.specialRole ?? null,
    yourVote: state.votes[playerId] ?? null,
    canAct: buildCanAct(state, playerId),
    lovebirdsPartnerId: pairedPartnerId(state.players, playerId, 'lovebirds'),
    rivalId: pairedPartnerId(state.players, playerId, 'rivals'),
  };
}

/** `room:snapshot` payload for one viewer (api-contract.md §2.2): `state` is
 * ALWAYS the public spectator redaction; personal data rides only in `you`. */
export function buildSnapshot(state: GameState, ver: number, playerId: string): RoomSnapshot {
  return {
    ver,
    state: redactFor(state, 'spectator'),
    you: buildYouSlice(state, playerId),
  };
}

/**
 * Broadcasts a personalized `room:snapshot` to every socket currently
 * joined to the Socket.IO room `code`, "the only way state reaches
 * clients" (api-contract.md §2.2). Iterates LOCAL sockets only
 * (`namespace.sockets`, populated for every socket connected to THIS
 * process) — correct for the single-process deployment this project targets
 * (system-design.md §4.5 "dormant until multi-process"). A multi-process
 * deployment needs each process to independently redact for its own
 * locally-connected sockets in response to a cross-process "state changed"
 * signal (the adapter's pub/sub already carries the room membership, not a
 * per-viewer payload) — that fan-out wiring is documented debt for whenever
 * a second API process is introduced.
 */
export function broadcastSnapshots(namespace: GameNamespace, code: string, state: GameState, ver: number): void {
  const roomMembers = namespace.adapter.rooms.get(code);
  if (!roomMembers) {
    return;
  }
  for (const socketId of roomMembers) {
    const socket = namespace.sockets.get(socketId);
    const playerId = socket?.data.playerId;
    if (!socket || !playerId) {
      continue;
    }
    socket.emit(SERVER_EVENTS.roomSnapshot, buildSnapshot(state, ver, playerId));
  }
}
