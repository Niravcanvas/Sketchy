import type { GameAction } from './actions.js';
import { TIMER_EXTEND_MS } from './constants.js';
import type { GameEffect } from './effects.js';
import * as cascadeReducers from './reducers/cascade.js';
import * as clueReducers from './reducers/clue.js';
import * as dealReducers from './reducers/deal.js';
import * as lobbyReducers from './reducers/lobby.js';
import * as revealReducers from './reducers/reveal.js';
import { findPlayer, isHost, ok, reject } from './reducers/shared.js';
import * as voteReducers from './reducers/vote.js';
import type { GameState } from './types.js';

/**
 * Engine-level error codes `applyAction` can return in `ApplyResult.error`.
 * This is the subset of `ErrorCode` (@sketchy/shared/contract/errors) that
 * originates from reducer validation rather than transport/auth/HTTP concerns
 * — the engine cannot import `@sketchy/shared` (purity rule, conventions.md
 * §1), so this union is kept in sync by hand with api-contract.md §0.
 */
export type EngineErrorCode =
  | 'validation'
  | 'room_full'
  | 'name_taken_in_room'
  | 'not_host'
  | 'not_your_turn'
  | 'wrong_phase'
  | 'already_voted'
  | 'clue_repeated'
  | 'clue_is_secret_word'
  | 'too_spicy';

/** Return shape of `applyAction` — data-model.md §3. */
export interface ApplyResult {
  state: GameState;
  effects: GameEffect[];
  error?: EngineErrorCode;
}

/**
 * Host's once-per-phase +60s (game-design.md §6.3). Any phase with an active deadline
 * that hasn't been extended yet; otherwise `validation`. Lives here (rather than a
 * reducer module) because it doesn't belong to any one phase.
 */
function applyExtendTimer(
  state: GameState,
  action: Extract<GameAction, { type: 'extendTimer' }>,
): ApplyResult {
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');
  if (state.phaseEndsAt === null || state.timerExtended) return reject(state, 'validation');
  const endsAt = state.phaseEndsAt + TIMER_EXTEND_MS;
  return ok({ ...state, phaseEndsAt: endsAt, timerExtended: true }, [
    { type: 'startTimer', endsAt },
  ]);
}

/**
 * Presence is system-originated and never validated against an actor — it only fails when
 * the named player doesn't exist. Never touches `alive` or turn order (game-design.md §8).
 */
function applyPresence(
  state: GameState,
  action: Extract<GameAction, { type: 'presence' }>,
): ApplyResult {
  const player = findPlayer(state, action.playerId);
  if (!player) return reject(state, 'validation');
  const players = state.players.map((p) =>
    p.id === action.playerId ? { ...p, connected: action.connected } : p,
  );
  return ok({ ...state, players });
}

/**
 * Host migration (game-design.md §8). System/host-decided — the authority check (who may
 * trigger it, who inherits) lives in the host environment (`sockets/presence-timers.ts`
 * grace expiry, `sockets/play.ts` `host:transfer`). The engine's only job is to validate
 * that `newHostId` names a real seated player and set `hostId`. Re-assigning to the sitting
 * host is a harmless no-op accept. No effects — hostId is not secret and drives no timer.
 */
function applyMigrateHost(
  state: GameState,
  action: Extract<GameAction, { type: 'migrateHost' }>,
): ApplyResult {
  const target = findPlayer(state, action.newHostId);
  if (!target) return reject(state, 'validation');
  if (state.hostId === action.newHostId) return ok(state);
  return ok({ ...state, hostId: action.newHostId });
}

/**
 * Routes a stale-or-live server timeout to the reducer for whichever phase it names.
 * `action.phase !== state.phase` means the timer fired after the phase already moved on
 * (a harmless race, game-design.md §8) — rejected `wrong_phase` rather than acted on.
 * `lobby` / `game_over` never schedule a timer, so a (theoretical) timeout naming either
 * is a harmless no-op rather than an error, since `phase` DID match `state.phase`.
 */
function applyTimeout(
  state: GameState,
  action: Extract<GameAction, { type: 'timeout' }>,
): ApplyResult {
  if (action.phase !== state.phase) return reject(state, 'wrong_phase');
  switch (state.phase) {
    case 'dealing':
      return dealReducers.timeoutDealing(state, action.at);
    case 'clue':
    case 'tiebreak_clue':
      return clueReducers.timeoutClue(state, action.at);
    case 'discussion':
      // Interpretation: the discussion timer running out advances to voting exactly like
      // the host's early `advancePhase` would (game-design.md §6.3: "advance... early"
      // implies the untimed-out default is the same transition).
      return voteReducers.enterVotingFromDiscussion(state, action.at);
    case 'voting':
      return voteReducers.timeoutVoting(state, action.at);
    case 'judge_decision':
      // The Judge is unreachable and `JUDGE_DECISION_TIMEOUT_SEC` has elapsed (vote.ts's
      // `closeVote` always times this phase) — auto-resolve via the same deterministic
      // default the host's early `advancePhase` uses below (game-design.md §8 "never block
      // on a ghost").
      return voteReducers.resolveJudgeDecisionByDefault(state, action.at);
    case 'grudge_decision':
      // The Grudge is unreachable and `GRUDGE_DECISION_TIMEOUT_SEC` has elapsed — auto-resolve
      // to "drags nobody down" (cascade.ts's `resolveGrudgeDecisionByDefault`), same
      // host-liveness-parity shape as the Judge above.
      return cascadeReducers.resolveGrudgeDecisionByDefault(state, action.at);
    case 'reveal':
      return revealReducers.resolveRevealPhase(state, action.at);
    case 'mrwhite_guess':
      return revealReducers.timeoutMrWhiteGuess(state, action.at);
    case 'lobby':
    case 'game_over':
      return ok(state);
  }
}

/**
 * Host advances early (api-contract.md §2.1 `phase:advance`). `discussion` → `voting`;
 * `reveal` → identical to `continueReveal`; `judge_decision` → the same deterministic
 * default the timeout uses (the host doesn't have to wait out `JUDGE_DECISION_TIMEOUT_SEC`
 * if the Judge is visibly gone); `grudge_decision` → the same "drags nobody" default the
 * timeout uses, same host-liveness-parity reasoning. Any other phase → `wrong_phase`.
 */
function applyAdvancePhase(
  state: GameState,
  action: Extract<GameAction, { type: 'advancePhase' }>,
): ApplyResult {
  if (
    state.phase !== 'discussion' &&
    state.phase !== 'reveal' &&
    state.phase !== 'judge_decision' &&
    state.phase !== 'grudge_decision'
  ) {
    return reject(state, 'wrong_phase');
  }
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');
  if (state.phase === 'discussion') return voteReducers.enterVotingFromDiscussion(state, action.at);
  if (state.phase === 'judge_decision') {
    return voteReducers.resolveJudgeDecisionByDefault(state, action.at);
  }
  if (state.phase === 'grudge_decision') {
    return cascadeReducers.resolveGrudgeDecisionByDefault(state, action.at);
  }
  return revealReducers.resolveRevealPhase(state, action.at);
}

/**
 * The ONE entry point for mutating a `GameState` (data-model.md §3). Pure: given the same
 * `state` + `action`, always produces the same `ApplyResult`. Reducers never throw and
 * never mutate `state` — a rejection returns the SAME `state` reference with `effects: []`
 * and an `error` code.
 */
export function applyAction(state: GameState, action: GameAction): ApplyResult {
  switch (action.type) {
    case 'join':
      return lobbyReducers.applyJoin(state, action);
    case 'leave':
      return lobbyReducers.applyLeave(state, action);
    case 'setReady':
      return lobbyReducers.applySetReady(state, action);
    case 'updateSettings':
      return lobbyReducers.applyUpdateSettings(state, action);
    case 'kick':
      return lobbyReducers.applyKick(state, action);
    case 'start':
      return dealReducers.applyStart(state, action);
    case 'ackWord':
      return dealReducers.applyAckWord(state, action);
    case 'submitClue':
      return clueReducers.applySubmitClue(state, action);
    case 'skipTurn':
      return clueReducers.applySkipTurn(state, action);
    case 'advancePhase':
      return applyAdvancePhase(state, action);
    case 'continueReveal':
      return revealReducers.applyContinueReveal(state, action);
    case 'castVote':
      return voteReducers.applyCastVote(state, action);
    case 'mrWhiteGuess':
      return revealReducers.applyMrWhiteGuess(state, action);
    case 'rematch':
      return revealReducers.applyRematch(state, action);
    case 'extendTimer':
      return applyExtendTimer(state, action);
    case 'judgeDecide':
      return voteReducers.applyJudgeDecide(state, action);
    case 'grudgeDrag':
      return cascadeReducers.applyGrudgeDrag(state, action);
    case 'timeout':
      return applyTimeout(state, action);
    case 'presence':
      return applyPresence(state, action);
    case 'migrateHost':
      return applyMigrateHost(state, action);
  }
}
