import type { GrudgeDragAction } from '../actions.js';
import type { ApplyResult } from '../apply-action.js';
import { GRUDGE_DECISION_TIMEOUT_SEC, REVEAL_AUTO_ADVANCE_SEC, RIVALS_POINT_DELTA } from '../constants.js';
import { checkWin } from '../check-win.js';
import type { Faction, GamePlayer, GameState } from '../types.js';
import { enterNextClueRound } from './clue.js';
import {
  aliveLovebirdsPartner,
  applyJesterFirstOutBonus,
  findPlayer,
  ok,
  reject,
} from './shared.js';

/**
 * The shared "chained elimination" machinery for the Lovebirds (partner falls with you)
 * and Grudge (drag one more player down) special roles. See `packages/engine/ROLES.md`'s
 * Mirror/Lovebirds/Grudge sections and arch/data-model.md §4 for the full design write-up.
 * This module is the ONE small shared helper wave 2 needed beyond "one narrow branch per
 * mechanic" (ROLES.md §3's guidance) — Lovebirds and Grudge both walk the exact same
 * reveal-one-card-at-a-time, win-check-once state machine, so it lives here once instead of
 * twice.
 *
 * State shape recap (data-model.md): `GameState.pendingElimination` is the ONE card
 * currently showing in the `reveal` phase; `GameState.pendingCascade` is the queue of
 * player ids still waiting their turn — every id in it is ALREADY marked `alive: false`
 * with `eliminatedRound` set, the queue only tracks reveal ORDER. `checkWin` runs exactly
 * once, only after the queue fully drains (`resolveAfterElimination` below).
 */

/** Adds `amount` to `playerId`'s running total — never overwrites (data-model.md §3
 * `scoreboard` accumulates across rematches). Shared by every scoring path below. */
function addScore(
  scoreboard: Record<string, number>,
  playerId: string,
  amount: number,
): Record<string, number> {
  return { ...scoreboard, [playerId]: (scoreboard[playerId] ?? 0) + amount };
}

/**
 * The Rivals special role's game-end scoring (copy.md §3.2 "first one eliminated
 * loses 2 points, the survivor gains 2"). Applied once, at game-over time, from BOTH ways a
 * game can end (`enterGameOverForWin` / `enterGameOverForGuess` below) — never mid-game,
 * unlike the Jester's immediate first-out bonus.
 *
 * "First eliminated" is derived purely from `eliminatedRound` (never-eliminated ranks as
 * "later than everyone" via `Infinity`, so a survivor always outranks an eliminated rival):
 * - Both null (both survived to game end) -> equal rank -> NO points either way (spec).
 * - Both non-null and EQUAL (caught in the same round — e.g. one Rival was the primary
 *   target and the other fell as a Lovebirds/Grudge cascade member in the same chain) ->
 *   equal rank -> NO points either way. Documented tiebreak decision: there's no reliable
 *   sub-round ordering to say which of the two "really" went first, so this is treated the
 *   same as "both survived" rather than picking an arbitrary winner.
 * - Otherwise: strictly smaller `eliminatedRound` (or `null`, ranked last) wins — the
 *   smaller one is first-out (-2), the other is the survivor (+2).
 *
 * No-ops (returns `scoreboard` unchanged) if `rivals` isn't enabled — detected structurally
 * by "exactly two players hold `specialRole === 'rivals'`" rather than reading
 * `settings.specialRoles`, mirroring how the Jester bonus keys off `specialRole` presence.
 */
function applyRivalsScoring(
  players: GamePlayer[],
  scoreboard: Record<string, number>,
): Record<string, number> {
  const rivals = players.filter((p) => p.specialRole === 'rivals');
  if (rivals.length !== 2) return scoreboard;
  const [a, b] = rivals as [GamePlayer, GamePlayer];

  const rank = (p: GamePlayer): number => (p.eliminatedRound === null ? Infinity : p.eliminatedRound);
  const ra = rank(a);
  const rb = rank(b);
  if (ra === rb) return scoreboard; // both survived, or fell together — no points either way

  const [firstOut, survivor] = ra < rb ? [a, b] : [b, a];
  const withLoss = addScore(scoreboard, firstOut.id, -RIVALS_POINT_DELTA);
  return addScore(withLoss, survivor.id, RIVALS_POINT_DELTA);
}

/**
 * Scoring for a NATURAL win (checkWin resolved it, as opposed to a Mr. White steal —
 * game-design.md §6.7 / research/01 §6), PLUS the Rivals scoring layered on top (applies
 * regardless of which faction won):
 * - civilian win: +2 to every Civilian, alive or eliminated (team win).
 * - undercover win: +10 to each ALIVE Undercover.
 * - mrwhite survive-win: +6 to each ALIVE Mr. White.
 * - infiltrators joint win: +10 each alive Undercover AND +6 each alive Mr. White.
 */
export function enterGameOverForWin(state: GameState, faction: Faction): ApplyResult {
  let scoreboard = state.scoreboard;
  for (const p of state.players) {
    if (faction === 'civilian' && p.role === 'civilian') {
      scoreboard = addScore(scoreboard, p.id, 2);
    }
    if (
      (faction === 'undercover' || faction === 'infiltrators') &&
      p.role === 'undercover' &&
      p.alive
    ) {
      scoreboard = addScore(scoreboard, p.id, 10);
    }
    if ((faction === 'mrwhite' || faction === 'infiltrators') && p.role === 'mrwhite' && p.alive) {
      scoreboard = addScore(scoreboard, p.id, 6);
    }
  }
  scoreboard = applyRivalsScoring(state.players, scoreboard);
  const next: GameState = {
    ...state,
    phase: 'game_over',
    winnerFaction: faction,
    scoreboard,
    phaseEndsAt: null,
    timerExtended: false,
  };
  return ok(next, [{ type: 'clearTimer' }, { type: 'persistGame' }]);
}

/** Scoring for a Mr. White STEAL (correct guess) — +6 to the guesser only, even though
 * they're no longer alive (game-design.md §6.6), PLUS the Rivals scoring. */
export function enterGameOverForGuess(state: GameState, guesserId: string): ApplyResult {
  let scoreboard = addScore(state.scoreboard, guesserId, 6);
  scoreboard = applyRivalsScoring(state.players, scoreboard);
  const next: GameState = {
    ...state,
    phase: 'game_over',
    winnerFaction: 'mrwhite',
    scoreboard,
    phaseEndsAt: null,
    timerExtended: false,
  };
  return ok(next, [{ type: 'clearTimer' }, { type: 'persistGame' }]);
}

/**
 * Processes deferred mid-game departures (`hasLeft` players formally eliminated at this
 * phase boundary — game-design.md §8/§9), then checks for a winner ONCE: if one exists,
 * ends the game; otherwise starts the next clue round. Only ever called once
 * `pendingCascade` is fully drained and no `grudge_decision` is pending — the "run
 * checkWin once, after both fall" requirement falls out of that invariant for free, since
 * this is the ONLY place `checkWin` is invoked after an elimination.
 */
export function resolveAfterElimination(state: GameState, at: number): ApplyResult {
  const players = state.players.map((p) =>
    p.alive && p.hasLeft ? { ...p, alive: false, eliminatedRound: state.round } : p,
  );
  const afterDepartures: GameState = { ...state, players };
  const winner = checkWin(afterDepartures);
  if (winner) return enterGameOverForWin(afterDepartures, winner);
  return enterNextClueRound(afterDepartures, at);
}

/**
 * Marks `playerId` eliminated (alive:false, eliminatedRound=state.round) and awards the
 * Jester first-out bonus if applicable — the ONE place every elimination in a cascade
 * (primary or chained) gets marked, so the bonus check's "pre-elimination roster" is always
 * read at the correct moment (immediately before THIS specific player flips).
 */
function markEliminated(
  state: GameState,
  playerId: string,
): { players: GamePlayer[]; scoreboard: Record<string, number> } {
  const scoreboard = applyJesterFirstOutBonus(state.players, state.scoreboard, playerId);
  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, alive: false, eliminatedRound: state.round } : p,
  );
  return { players, scoreboard };
}

/**
 * Starts a FRESH chained-elimination reveal sequence from a vote close or Judge decision
 * (`reducers/vote.ts` — `closeVote`'s clean-plurality branch, the Mirror-bounce redirect,
 * and `eliminateFromJudgeDecision`). Marks `primaryId` eliminated; if they hold `lovebirds`
 * and their partner is still alive, the partner is ALSO marked eliminated (same round) and
 * queued right behind the primary — the "chained two-card reveal".
 * `mirrorBounced` decorates the reveal with the one-shot Mirror bounce beat (`false` for
 * every other elimination path — a Judge decision, and that decision's own timeout/host-
 * escape default, NEVER set this; see ROLES.md's Mirror boundary note).
 */
export function enterCascadeReveal(
  state: GameState,
  primaryId: string,
  at: number,
  mirrorBounced: boolean,
): ApplyResult {
  const primary = markEliminated(state, primaryId);
  let players = primary.players;
  let cascade: string[] = [];

  const partner = aliveLovebirdsPartner(players, primaryId);
  if (partner) {
    const partnerElim = markEliminated({ ...state, players }, partner.id);
    players = partnerElim.players;
    cascade = [partner.id];
  }

  const endsAt = at + REVEAL_AUTO_ADVANCE_SEC * 1000;
  const next: GameState = {
    ...state,
    players,
    scoreboard: primary.scoreboard,
    tiedPlayerIds: null,
    pendingElimination: primaryId,
    pendingCascade: cascade,
    phase: 'reveal',
    phaseEndsAt: endsAt,
    timerExtended: false,
    mirrorBounced,
  };
  return ok(next, [
    { type: 'revealRole', playerId: primaryId },
    { type: 'startTimer', endsAt },
  ]);
}

/**
 * Continues (or finishes) an already-active chained-elimination sequence once
 * `justRevealedId`'s own card has been shown — called from `reducers/reveal.ts`
 * (`resolveRevealPhase`'s non-Mr.-White branch, and `resolveGuess`'s wrong-guess branch)
 * and, internally, after a `grudge_decision` resolves. Three outcomes, checked in order:
 *
 * 1. `justRevealedId` holds `grudge` and hasn't used their power yet -> enters
 *    `grudge_decision` (their own one-shot pick — research/03: "when eliminated, drags one
 *    more player down with them"). `pendingCascade` is left untouched; there can be at
 *    most one Grudge holder per game (single-holder role), so this can never re-trigger.
 * 2. Otherwise, if the queue has more cards waiting -> pop the next one, re-enter `reveal`
 *    for it (fresh 8s auto-advance timer) — the "walk the chain one card at a time" beat.
 * 3. Otherwise the whole cascade has drained -> `resolveAfterElimination` (departures +
 *    checkWin ONCE + next round).
 */
export function advanceCascadeOrResolve(
  state: GameState,
  justRevealedId: string,
  at: number,
): ApplyResult {
  const revealed = findPlayer(state, justRevealedId);
  if (revealed && revealed.specialRole === 'grudge' && !revealed.usedSpecialPower) {
    const endsAt = at + GRUDGE_DECISION_TIMEOUT_SEC * 1000;
    const next: GameState = {
      ...state,
      phase: 'grudge_decision',
      phaseEndsAt: endsAt,
      timerExtended: false,
    };
    return ok(next, [{ type: 'startTimer', endsAt }]);
  }
  return continueOrFinishCascade(state, at);
}

/** The queue-pop-or-finish half of `advanceCascadeOrResolve` — factored out so
 * `applyGrudgeDrag`/`resolveGrudgeDecisionByDefault` below can jump straight here (a
 * Grudge's OWN card was already checked by the time either of those runs). */
function continueOrFinishCascade(state: GameState, at: number): ApplyResult {
  if (state.pendingCascade.length > 0) {
    const [nextId, ...rest] = state.pendingCascade;
    const endsAt = at + REVEAL_AUTO_ADVANCE_SEC * 1000;
    const next: GameState = {
      ...state,
      pendingElimination: nextId as string,
      pendingCascade: rest,
      phase: 'reveal',
      phaseEndsAt: endsAt,
      timerExtended: false,
    };
    return ok(next, [
      { type: 'revealRole', playerId: nextId as string },
      { type: 'startTimer', endsAt },
    ]);
  }
  return resolveAfterElimination(state, at);
}

/**
 * `grudgeDrag` — the Grudge's drag-down choice (api-contract.md §2.1 `special:grudge`).
 * `grudge_decision` phase only; the actor must BE the just-revealed Grudge
 * (`state.pendingElimination`, mirroring `mrWhiteGuess`'s actor check) and still hold
 * `specialRole === 'grudge'` (defensive, mirrors `judgeDecide`'s belt-and-suspenders
 * check). `targetId` must name a currently ALIVE player (research/03: "drags one more
 * player down with them (their choice)") — an already-eliminated/already-queued player can
 * never be targeted, which is exactly what keeps the cascade bounded: the engine caps at
 * full resolution. If the dragged target is ALSO a Lovebird with an alive partner, that
 * partner cascades too — same chaining rule as the primary elimination.
 */
export function applyGrudgeDrag(state: GameState, action: GrudgeDragAction): ApplyResult {
  if (state.phase !== 'grudge_decision') return reject(state, 'wrong_phase');

  const grudge = findPlayer(state, action.playerId);
  if (!grudge || grudge.specialRole !== 'grudge' || grudge.id !== state.pendingElimination) {
    return reject(state, 'validation');
  }

  const target = findPlayer(state, action.targetId);
  if (!target || !target.alive) return reject(state, 'validation');

  const targetElim = markEliminated(state, target.id);
  let players = targetElim.players.map((p) =>
    p.id === grudge.id ? { ...p, usedSpecialPower: true } : p,
  );
  let cascade = [...state.pendingCascade, target.id];

  const partner = aliveLovebirdsPartner(players, target.id);
  if (partner) {
    const partnerElim = markEliminated({ ...state, players }, partner.id);
    players = partnerElim.players;
    cascade = [...cascade, partner.id];
  }

  const next: GameState = {
    ...state,
    players,
    scoreboard: targetElim.scoreboard,
    pendingCascade: cascade,
  };
  return continueOrFinishCascade(next, action.at);
}

/**
 * `grudge_decision`'s auto-resolution when the Grudge is unreachable — fired by
 * `timeout{grudge_decision}` (`GRUDGE_DECISION_TIMEOUT_SEC` elapses) OR the host's early
 * `advancePhase` (mirrors `resolveJudgeDecisionByDefault`'s host-liveness-parity escape
 * hatch exactly — see `packages/engine/ROLES.md`). UNLIKE the Judge, the default here is
 * "drags NOBODY down" (copy.md §3.2: "defaults to nobody on expiry") — a deliberately
 * different fallback shape, since "no drag" is itself a valid,
 * unremarkable outcome of the Grudge's power (as opposed to the Judge's tie, which MUST
 * eliminate someone). Still marks `usedSpecialPower` — the Grudge only ever gets the one
 * decision point (their own elimination), so there's nothing left to protect against a
 * second trigger, but the flag stays accurate for anything that wants to show "the Grudge
 * chose not to drag anyone down" after the fact.
 */
export function resolveGrudgeDecisionByDefault(state: GameState, at: number): ApplyResult {
  if (state.phase !== 'grudge_decision') return reject(state, 'wrong_phase');

  const grudgeId = state.pendingElimination as string;
  const players = state.players.map((p) =>
    p.id === grudgeId ? { ...p, usedSpecialPower: true } : p,
  );
  return continueOrFinishCascade({ ...state, players }, at);
}
