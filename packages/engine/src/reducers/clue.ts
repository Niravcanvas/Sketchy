import type { SkipTurnAction, SubmitClueAction } from '../actions.js';
import type { ApplyResult } from '../apply-action.js';
import { CLUE_MAX_LEN, SKIPPED_CLUE } from '../constants.js';
import { createRng } from '../rng.js';
import type { Clue, GamePlayer, GameState } from '../types.js';
import { currentTurnOrder, isHost, normalizeText, ok, reject, timerEffects } from './shared.js';

function inClueRoundPhase(state: GameState): boolean {
  return state.phase === 'clue' || state.phase === 'tiebreak_clue';
}

/**
 * The Mime special role's per-round derivation (ROLES.md's Mime section — a
 * room-wide setting, NOT a dealt `specialRole` holder, because it needs to be a DIFFERENT
 * random player each round rather than one fixed for the whole game). `null` when the
 * setting is off. Deterministic given `seed` + `gamesPlayedInRoom` + the round number, same
 * per-purpose-generator convention as `assignSpecialRoles`/`resolveJudgeDecisionByDefault`
 * — a fresh, unstored `Rng` derived here every time, never carried in `GameState`. Draws
 * from ALIVE players only (an eliminated player can't mime); no anti-repeat constraint
 * against the previous round's Mime (documented simplification — copy.md §3.2 doesn't
 * require "a different player every round", just "one random player").
 */
function drawMimeForRound(state: GameState, round: number, alivePlayers: GamePlayer[]): string | null {
  if (!state.settings.specialRoles.includes('mime')) return null;
  if (alivePlayers.length === 0) return null;
  const rng = createRng(`${state.seed}:mime:${state.gamesPlayedInRoom}:${round}`);
  return (alivePlayers[rng.int(alivePlayers.length)] as GamePlayer).id;
}

/**
 * Appends `text` as `playerId`'s clue for the current turn and advances: to the next
 * turn-holder (re-arming the per-turn timer), or — if it was the last turn — out of the
 * clue round entirely (`clue` → `discussion`; `tiebreak_clue` → the re-vote `voting`).
 * Shared by `submitClue`, `skipTurn`, and both their `timeout` equivalents, so the
 * transition logic exists exactly once.
 */
function recordClueAndAdvance(
  state: GameState,
  playerId: string,
  text: string,
  at: number,
): ApplyResult {
  const order = currentTurnOrder(state);
  // A skipped turn is never "mimed" (no gesture happened).
  const mimed = text !== SKIPPED_CLUE && playerId === state.mimeId;
  const entry: Clue = { round: state.round, playerId, text, mimed };
  const clues = [...state.clues, entry];
  // turnSeat is always a valid index while in a clue-giving phase (invariant: set to 0 on
  // entry, only nulled when the round ends), so this assertion never actually lies.
  const nextIndex = (state.turnSeat as number) + 1;

  if (nextIndex < order.length) {
    const endsAt =
      state.settings.clueTimerSec != null ? at + state.settings.clueTimerSec * 1000 : null;
    const next: GameState = {
      ...state,
      clues,
      turnSeat: nextIndex,
      phaseEndsAt: endsAt,
      timerExtended: false,
    };
    return ok(next, timerEffects(endsAt));
  }

  if (state.phase === 'clue') {
    // Last speaker of a normal clue round → discussion (game-design.md §6.2).
    const endsAt =
      state.settings.discussionTimerSec != null
        ? at + state.settings.discussionTimerSec * 1000
        : null;
    const next: GameState = {
      ...state,
      clues,
      turnSeat: null,
      phase: 'discussion',
      phaseEndsAt: endsAt,
      timerExtended: false,
    };
    return ok(next, timerEffects(endsAt));
  }

  // Last speaker of tiebreak_clue → re-vote among the tied players (revoteCount becomes 1;
  // tiedPlayerIds is left set — it still restricts eligible targets during the re-vote).
  const endsAt =
    state.settings.voteTimerSec != null ? at + state.settings.voteTimerSec * 1000 : null;
  const next: GameState = {
    ...state,
    clues,
    turnSeat: null,
    phase: 'voting',
    revoteCount: 1,
    phaseEndsAt: endsAt,
    timerExtended: false,
  };
  return ok(next, timerEffects(endsAt));
}

/** `submitClue` — the current turn-holder only, `clue` / `tiebreak_clue` only
 * (api-contract.md §2.1 `clue:submit`). */
export function applySubmitClue(state: GameState, action: SubmitClueAction): ApplyResult {
  if (!inClueRoundPhase(state)) return reject(state, 'wrong_phase');

  const order = currentTurnOrder(state);
  // turnSeat is always a valid index into `order` while in a clue-giving phase (invariant).
  const turnHolder = order[state.turnSeat as number] as GamePlayer;
  if (turnHolder.id !== action.playerId) return reject(state, 'not_your_turn');

  const text = action.text.trim();
  if (text.length < 1 || text.length > CLUE_MAX_LEN) return reject(state, 'validation');

  const normalized = normalizeText(text);
  const civilian = normalizeText(state.pair.civilianWord);
  const undercover = normalizeText(state.pair.undercoverWord);
  if (normalized === civilian || normalized === undercover)
    return reject(state, 'clue_is_secret_word');

  // Skip markers are deliberately excluded from the repeat check — every skipped turn this
  // game shares the same literal text, which must never itself count as a "repeat".
  const isRepeat = state.clues.some(
    (c) => c.text !== SKIPPED_CLUE && normalizeText(c.text) === normalized,
  );
  if (isRepeat) return reject(state, 'clue_repeated');

  return recordClueAndAdvance(state, action.playerId, text, action.at);
}

/** `skipTurn` — host-only, `clue` / `tiebreak_clue` only (api-contract.md §2.1
 * `turn:skip`). */
export function applySkipTurn(state: GameState, action: SkipTurnAction): ApplyResult {
  if (!inClueRoundPhase(state)) return reject(state, 'wrong_phase');
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');

  const order = currentTurnOrder(state);
  const turnHolder = order[state.turnSeat as number] as GamePlayer;

  return recordClueAndAdvance(state, turnHolder.id, SKIPPED_CLUE, action.at);
}

/** `timeout{clue|tiebreak_clue}` — system-originated equivalent of `skipTurn`. */
export function timeoutClue(state: GameState, at: number): ApplyResult {
  const order = currentTurnOrder(state);
  const turnHolder = order[state.turnSeat as number] as GamePlayer;
  return recordClueAndAdvance(state, turnHolder.id, SKIPPED_CLUE, at);
}

/**
 * Enters a fresh clue round: `round` increments, ballots/tie state clear, turn order
 * resets to the first alive player by seat (NOT a rotation — every round restarts at seat
 * 0 of the alive list, game-design.md §6.2). Shared entry point for: all-acked dealing,
 * `timeout{dealing}`, all-abstain/second-tie vote closes, and post-reveal "no winner yet".
 */
export function enterNextClueRound(state: GameState, at: number): ApplyResult {
  const endsAt =
    state.settings.clueTimerSec != null ? at + state.settings.clueTimerSec * 1000 : null;
  const nextRound = state.round + 1;
  const next: GameState = {
    ...state,
    round: nextRound,
    votes: {},
    tiedPlayerIds: null,
    revoteCount: 0,
    pendingElimination: null,
    turnSeat: 0,
    phase: 'clue',
    phaseEndsAt: endsAt,
    timerExtended: false,
    // Any in-progress chained-elimination sequence is, by construction, always
    // fully drained (pendingCascade empty, no grudge_decision pending) before a NEW clue
    // round can begin — reset defensively so a stray value can never survive into the next
    // round. Same for the one-shot Mirror-bounce reveal flag.
    pendingCascade: [],
    mirrorBounced: false,
    mimeId: drawMimeForRound(state, nextRound, state.players.filter((p) => p.alive)),
  };
  return ok(next, timerEffects(endsAt));
}
