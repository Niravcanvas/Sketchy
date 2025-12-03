import type { ContinueRevealAction, MrWhiteGuessAction, RematchAction } from '../actions.js';
import type { ApplyResult } from '../apply-action.js';
import { MIN_PLAYERS, MRWHITE_GUESS_SEC } from '../constants.js';
import type { GamePlayer, GameState } from '../types.js';
import { beginDealing } from './deal.js';
import { advanceCascadeOrResolve, enterGameOverForGuess } from './cascade.js';
import { findPlayer, isHost, isValidRoleMath, isValidSpecialRoles, ok, reject } from './shared.js';

// Game-over scoring (`enterGameOverForWin`/`enterGameOverForGuess`) and the shared
// "process departures, checkWin once, next round" resolution
// (`resolveAfterElimination`) live in `reducers/cascade.ts` — that module also owns the
// Lovebirds/Grudge chained-elimination walk, which needs the exact same win-check-once
// resolution this file used before any special roles existed. Re-exported from there rather
// than duplicated; see cascade.ts's file header for the full write-up.
export { enterGameOverForWin } from './cascade.js';

/**
 * Shared by `continueReveal`, `advancePhase` (when `phase === 'reveal'`), and
 * `timeout{reveal}`. If the just-eliminated player is Mr. White (and hasn't already left —
 * a left player forfeits the guess), routes to their guess window; otherwise hands off to
 * `advanceCascadeOrResolve` (`reducers/cascade.ts`) — continues a chained-elimination
 * sequence (Lovebirds/Grudge) if one is in progress, or resolves departures/win-check/next
 * round if not.
 */
export function resolveRevealPhase(state: GameState, at: number): ApplyResult {
  // pendingElimination is always set while phase === 'reveal' (invariant: set by the vote
  // close that entered this phase, cleared only when the next clue round begins).
  const pendingId = state.pendingElimination as string;
  const eliminated = findPlayer(state, pendingId)!;
  if (eliminated.role === 'mrwhite' && !eliminated.hasLeft) {
    const endsAt = at + MRWHITE_GUESS_SEC * 1000;
    const next: GameState = {
      ...state,
      phase: 'mrwhite_guess',
      phaseEndsAt: endsAt,
      timerExtended: false,
    };
    return ok(next, [{ type: 'startTimer', endsAt }]);
  }
  return advanceCascadeOrResolve(state, pendingId, at);
}

/** `continueReveal` — host-only, `reveal` only (api-contract.md §2.1). */
export function applyContinueReveal(state: GameState, action: ContinueRevealAction): ApplyResult {
  if (state.phase !== 'reveal') return reject(state, 'wrong_phase');
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');
  return resolveRevealPhase(state, action.at);
}

/** NFD-decompose and strip combining marks so "Café" ≈ "cafe" (game-design.md §6.6). */
function normalizeGuess(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolveGuess(state: GameState, text: string, at: number): ApplyResult {
  // pendingElimination is always set while phase === 'mrwhite_guess' (invariant).
  const guesserId = state.pendingElimination as string;
  const correct = normalizeGuess(text) === normalizeGuess(state.pair.civilianWord);
  const withGuess: GameState = { ...state, lastGuess: { playerId: guesserId, text, correct } };
  if (correct) return enterGameOverForGuess(withGuess, guesserId);
  // A WRONG guess means the elimination stands — hand off to
  // `advanceCascadeOrResolve` (not straight to `resolveAfterElimination`) so a Mr. White who
  // is ALSO the Grudge still gets their drag-down decision before the round resolves.
  return advanceCascadeOrResolve(withGuess, guesserId, at);
}

/** `mrWhiteGuess` — only the just-eliminated Mr. White, `mrwhite_guess` only
 * (api-contract.md §2.1 `mrwhite:guess`). */
export function applyMrWhiteGuess(state: GameState, action: MrWhiteGuessAction): ApplyResult {
  if (state.phase !== 'mrwhite_guess') return reject(state, 'wrong_phase');
  if (action.playerId !== state.pendingElimination) return reject(state, 'validation');
  return resolveGuess(state, action.text, action.at);
}

/** `timeout{mrwhite_guess}` — treated as a wrong guess with empty text. */
export function timeoutMrWhiteGuess(state: GameState, at: number): ApplyResult {
  return resolveGuess(state, '', at);
}

/** `rematch` — host-only, `game_over` only (api-contract.md §2.1 `game:rematch`). Players
 * who `hasLeft` are dropped (seats compacted); everyone else keeps seat/settings/scoreboard.
 * Deals immediately with the fresh `pair` — goes straight back to `dealing`. */
export function applyRematch(state: GameState, action: RematchAction): ApplyResult {
  if (state.phase !== 'game_over') return reject(state, 'wrong_phase');
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');

  const remaining = state.players.filter((p) => !p.hasLeft).map((p, seat) => ({ ...p, seat }));

  if (remaining.length < MIN_PLAYERS) return reject(state, 'validation');
  if (
    !isValidRoleMath(state.settings.undercoverCount, state.settings.mrWhiteCount, remaining.length)
  ) {
    return reject(state, 'validation');
  }
  if (!isValidSpecialRoles(state.settings.specialRoles, remaining.length)) {
    return reject(state, 'validation');
  }

  // The host may have `hasLeft` (and so be dropped above) without `hostId` having been
  // reassigned yet — departures aren't a lobby `leave`, so hand-off is resolved here.
  const hostStillPresent = remaining.some((p) => p.id === state.hostId);
  const hostId = hostStillPresent ? state.hostId : (remaining[0] as GamePlayer).id;
  const resetState: GameState = {
    ...state,
    players: remaining,
    hostId,
    gamesPlayedInRoom: state.gamesPlayedInRoom + 1,
    voteHistory: [],
    lastGuess: null,
    winnerFaction: null,
  };
  const next = beginDealing(resetState, action.pair, action.at);
  return ok(next, [{ type: 'startTimer', endsAt: next.phaseEndsAt as number }]);
}
