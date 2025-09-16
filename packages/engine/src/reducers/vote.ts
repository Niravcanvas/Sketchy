import type { CastVoteAction, JudgeDecideAction } from '../actions.js';
import type { ApplyResult } from '../apply-action.js';
import { JUDGE_DECISION_TIMEOUT_SEC } from '../constants.js';
import { createRng } from '../rng.js';
import type { GameState, VoteRecord } from '../types.js';
import { enterCascadeReveal } from './cascade.js';
import { enterNextClueRound } from './clue.js';
import { findPlayer, ok, reject, timerEffects } from './shared.js';

/** Ghost (`settings.specialRoles` containing `'ghost'` — game-design.md §9): ALL
 * eliminated players keep `vote:cast` rights, on top of the always-alive/not-left voters. A
 * room-wide SETTING, not a per-player `specialRole` (no player is ever assigned `'ghost'`). */
function eligibleVoterIds(state: GameState): string[] {
  const ghostActive = state.settings.specialRoles.includes('ghost');
  return state.players.filter((p) => !p.hasLeft && (p.alive || ghostActive)).map((p) => p.id);
}

function tallyBallots(votes: Record<string, string>): Map<string, number> {
  const tally = new Map<string, number>();
  for (const targetId of Object.values(votes)) {
    tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }
  return tally;
}

function topOf(tally: Map<string, number>): string[] {
  let max = 0;
  for (const count of tally.values()) max = Math.max(max, count);
  return [...tally.entries()].filter(([, count]) => count === max).map(([id]) => id);
}

/**
 * Routes a tie at the top of a (possibly Mirror-adjusted, see `resolveMirrorBounce` below)
 * tally: Judge special role (copy.md §3.2 "When a vote ties, the Judge decides
 * who's out — even after they've been eliminated") supersedes sudden-death entirely on the
 * FIRST tie of a round (`revoteCount === 0`); otherwise `tiebreak_clue`. A SECOND tie
 * (`revoteCount === 1`, i.e. this is already a sudden-death re-vote) never elects anyone —
 * no elimination, straight to the next clue round (game-design.md §6.4) — and, per the same
 * existing invariant, is unreachable when the Judge is active (every `revoteCount === 0` tie
 * routes to `judge_decision` instead of `tiebreak_clue`, so a re-vote never happens when a
 * Judge is seated). `findPlayer`-style lookup for the Judge deliberately ignores `alive` —
 * research/03: the Judge "stays active even after she herself is eliminated".
 *
 * Extracted so `closeVote`'s own tie AND the Mirror bounce's adjusted-tally tie
 * ("ties among bouncers → standard tiebreak flow") share this ONE implementation rather
 * than two copies. Mirror-agnostic by design: nothing here ever
 * checks `specialRole === 'mirror'` — the Mirror mechanic ONLY ever fires in
 * `closeVote`'s clean-plurality check, never in a tie resolution (`packages/engine/
 * ROLES.md`'s Mirror boundary note) — so a bounce that itself ties, or an ordinary vote
 * tie, are handled completely identically from here on.
 */
function routeTie(state: GameState, topIds: string[], at: number): ApplyResult {
  if (state.revoteCount === 0) {
    const judge = state.players.find((p) => p.specialRole === 'judge');
    if (judge) {
      const endsAt = at + JUDGE_DECISION_TIMEOUT_SEC * 1000;
      const next: GameState = {
        ...state,
        votes: {},
        tiedPlayerIds: topIds,
        phase: 'judge_decision',
        turnSeat: null,
        phaseEndsAt: endsAt,
        timerExtended: false,
        judgeRevealed: true,
      };
      return ok(next, timerEffects(endsAt));
    }

    // First tie → sudden-death: tied players each give one more clue, then re-vote among
    // just them. `revoteCount` stays 0 here — it becomes 1 only once the re-vote itself
    // starts (clue.ts's `recordClueAndAdvance`), so it always reflects "which vote is this".
    const endsAt =
      state.settings.clueTimerSec != null ? at + state.settings.clueTimerSec * 1000 : null;
    const next: GameState = {
      ...state,
      votes: {},
      tiedPlayerIds: topIds,
      phase: 'tiebreak_clue',
      turnSeat: 0,
      phaseEndsAt: endsAt,
      timerExtended: false,
    };
    return ok(next, timerEffects(endsAt));
  }

  // Second tie → no elimination this round.
  return enterNextClueRound({ ...state, votes: {} }, at);
}

/**
 * The Mirror special role's one-shot redirect (copy.md §3.2 "The first time the
 * table votes the Mirror out, the votes bounce back at the voters. Once."; ROLES.md's
 * Mirror section has the full design write-up). Called ONLY from `closeVote`'s clean-
 * plurality branch, when the sole top-voted player holds `specialRole === 'mirror'` and
 * hasn't used their power yet — this is the ONE place in the whole engine that ever checks
 * for the Mirror; nowhere else (Judge decisions, their timeout/host-escape default,
 * `applyGrudgeDrag`, cascade continuation) ever re-checks it, which is what makes "Mirror
 * triggers ONLY on vote pluralities" true by construction rather than by an explicit guard
 * scattered through every other elimination path.
 *
 * The eliminated player is "the most-voted AMONG THE BOUNCERS" — i.e. among the players
 * who voted for the Mirror. Each bouncer's
 * ballot bounces back onto its OWN CASTER (research/03: "all votes against them bounce back
 * onto whoever cast them"), so every alive bouncer starts with one self-vote; a bouncer who
 * ALSO drew ordinary votes that round accrues those too, which is what lets one bouncer
 * uniquely top the rest (a clean, deterministic redirect) — otherwise the bouncers tie and
 * it routes to the standard tiebreak flow. Crucially, candidacy is RESTRICTED to the
 * bouncers: a third player who merely collected ordinary votes that round (but never voted
 * the Mirror) is NEVER eliminated by the bounce, nor pulled into a bounce-caused tie — the
 * "adjusted tally" is scored only over bouncer candidates, not the whole ballot set.
 * A bouncer who is an eliminated Ghost (`settings.specialRoles` containing `'ghost'` — the
 * only way a non-alive player can cast a ballot at all) is the one exception:
 * their vote for the Mirror still counted toward the plurality that TRIGGERED the bounce
 * (a genuine "bouncer" ballot), but a dead player can't "fall" a
 * second time, so their bounced ballot is DROPPED rather than redirected onto them (which
 * would silently overwrite their real `eliminatedRound` — a correctness bug, not just a
 * flavor issue), and they are not an elimination candidate. Marks `usedSpecialPower`
 * regardless of outcome (clean redirect, a resulting tie, or the all-Ghosts empty case
 * below) — it only ever gets to fire once.
 */
function resolveMirrorBounce(
  state: GameState,
  mirrorId: string,
  votesSnapshot: Record<string, string>,
  baseRecord: VoteRecord,
  at: number,
): ApplyResult {
  // The "bouncers": voters whose ORIGINAL ballot targeted the Mirror. ONLY a bouncer can
  // ever be the redirect target ("the most-voted AMONG THE BOUNCERS is eliminated instead")
  // — a third player who merely drew ordinary votes that round is
  // NEVER dragged in by the Mirror's power, and never pulled into a bounce-caused tie. A
  // dead Ghost who voted the Mirror is a bouncer whose ballot is DROPPED (a dead player
  // can't "fall" a second time — redirecting onto them would silently overwrite their real
  // `eliminatedRound`), so they are never a candidate either.
  const aliveBouncers = new Set(
    Object.entries(votesSnapshot)
      .filter(([voter, target]) => target === mirrorId && findPlayer(state, voter)?.alive)
      .map(([voter]) => voter),
  );
  const players = state.players.map((p) =>
    p.id === mirrorId ? { ...p, usedSpecialPower: true } : p,
  );

  if (aliveBouncers.size === 0) {
    // Every bouncer was an eliminated Ghost (all dropped) — nobody living to redirect onto,
    // so the bounce simply fizzles: no elimination, straight to the next clue round. (Also
    // covers the impossible "no bouncers at all" case defensively.)
    const withHistory: GameState = {
      ...state,
      players,
      votes: {},
      voteHistory: [...state.voteHistory, baseRecord],
    };
    return enterNextClueRound(withHistory, at);
  }

  // Adjusted tally: each alive bouncer's ballot bounces onto ITSELF; every OTHER ballot
  // stands, so a bouncer who was ALSO an ordinary vote target still accrues those votes and
  // can uniquely top the bouncers ("the most-voted among the bouncers ... deterministic").
  // Votes for a NON-bouncer are still counted here but simply never consulted — candidacy
  // for elimination is restricted to `aliveBouncers` below.
  const adjusted: Record<string, string> = {};
  for (const [voter, target] of Object.entries(votesSnapshot)) {
    if (target === mirrorId) {
      if (aliveBouncers.has(voter)) adjusted[voter] = voter; // bounces onto the living caster
      continue; // dead-Ghost bouncer: dropped (see above)
    }
    adjusted[voter] = target;
  }
  const tally = tallyBallots(adjusted);

  // Most-voted AMONG THE BOUNCERS: candidacy restricted to `aliveBouncers`, external votes
  // for a bouncer still counted toward their total.
  let max = 0;
  for (const bouncer of aliveBouncers) max = Math.max(max, tally.get(bouncer) ?? 0);
  const topBouncers = [...aliveBouncers].filter((b) => (tally.get(b) ?? 0) === max);

  if (topBouncers.length === 1) {
    const eliminatedId = topBouncers[0] as string;
    const withHistory: GameState = {
      ...state,
      players,
      votes: {},
      voteHistory: [...state.voteHistory, { ...baseRecord, eliminated: eliminatedId }],
    };
    return enterCascadeReveal(withHistory, eliminatedId, at, true);
  }

  // Tied among the top bouncers -> the standard tie-routing flow (deterministic —
  // "ties among bouncers → standard tiebreak flow"). Note: `mirrorBounced` is deliberately
  // NOT set here — the distinct "bounce" reveal beat only decorates a DIRECT
  // redirect-to-elimination; a bounce that itself ties falls through to the ordinary
  // tiebreak/judge_decision copy from here on (a documented scope decision — threading the
  // bounce flavor through a second tie would need yet another field surviving
  // `tiebreak_clue`/`judge_decision`, for a beat that only matters once the dust settles
  // anyway).
  const withHistory: GameState = {
    ...state,
    players,
    votes: {},
    voteHistory: [...state.voteHistory, baseRecord],
  };
  return routeTie(withHistory, topBouncers, at);
}

/**
 * Closes the current vote: tallies `state.votes`, records the `VoteRecord` BEFORE
 * clearing ballots, then resolves to one of: reveal (unique plurality, or the Mirror's
 * bounce redirect), tiebreak_clue/judge_decision (a tie), a fresh clue round (all-abstain,
 * or second tie), per game-design.md §6.4. Shared by `castVote` (when the last eligible
 * voter casts) and `timeout{voting}`.
 */
export function closeVote(state: GameState, at: number): ApplyResult {
  const tally = tallyBallots(state.votes);

  const baseRecord: VoteRecord = {
    round: state.round,
    revote: state.revoteCount === 1,
    votes: { ...state.votes },
    eliminated: null,
  };

  if (tally.size === 0) {
    // All abstain: no elimination, straight back to a fresh clue round (no reveal).
    const withHistory: GameState = {
      ...state,
      votes: {},
      voteHistory: [...state.voteHistory, baseRecord],
    };
    return enterNextClueRound(withHistory, at);
  }

  const topIds = topOf(tally);

  if (topIds.length === 1) {
    const targetId = topIds[0] as string;

    // Mirror: the sole top-voted player's first-ever plurality bounces instead
    // of eliminating them — see `resolveMirrorBounce` above.
    const mirror = state.players.find(
      (p) => p.id === targetId && p.specialRole === 'mirror' && !p.usedSpecialPower,
    );
    if (mirror) {
      return resolveMirrorBounce(state, mirror.id, state.votes, baseRecord, at);
    }

    const withHistory: GameState = {
      ...state,
      votes: {},
      voteHistory: [...state.voteHistory, { ...baseRecord, eliminated: targetId }],
    };
    return enterCascadeReveal(withHistory, targetId, at, false);
  }

  // Tie at the top — never a Mirror concern (a tie means nobody got a CLEAN plurality, and
  // the bounce only ever triggers off "the sole top target holds specialRole mirror").
  const withHistory: GameState = { ...state, voteHistory: [...state.voteHistory, baseRecord] };
  return routeTie({ ...withHistory, votes: {} }, topIds, at);
}

/**
 * `judgeDecide` — the Judge's tie-breaking call (api-contract.md §2.1 `special:judge`).
 * `judge_decision` phase only. The actor must hold `specialRole === 'judge'`
 * (alive OR eliminated, per the role's own doc comment); `targetId` must be one of the
 * `tiedPlayerIds` the engine routed here. Resolves via `enterCascadeReveal` —
 * exactly like `closeVote`'s clean-plurality branch, `mirrorBounced: false` always (a Judge
 * decision is never a vote plurality, so it can never trigger the Mirror — ROLES.md's
 * boundary note). The tie's own `VoteRecord` was already logged (with `eliminated: null`)
 * by `closeVote` before this phase was entered, and is NOT rewritten here: neither the
 * Judge's decision nor its timeout/host-escape fallback is itself a vote.
 */
export function applyJudgeDecide(state: GameState, action: JudgeDecideAction): ApplyResult {
  if (state.phase !== 'judge_decision') return reject(state, 'wrong_phase');

  const judge = findPlayer(state, action.playerId);
  if (!judge || judge.specialRole !== 'judge') return reject(state, 'validation');

  const tied = state.tiedPlayerIds ?? [];
  if (!tied.includes(action.targetId)) return reject(state, 'validation');

  return enterCascadeReveal(state, action.targetId, action.at, false);
}

/**
 * `judge_decision`'s auto-resolution when the Judge is unreachable —
 * fired by `timeout{judge_decision}` (`JUDGE_DECISION_TIMEOUT_SEC` elapses) OR the host's
 * early `advancePhase` (game-design.md §8 "never block on a ghost"; mirrors how
 * `advancePhase` already lets the host skip `discussion`/`reveal` early). Picks one of
 * `tiedPlayerIds` deterministically via the engine's seeded RNG (conventions.md §4 — same
 * draw-a-fresh-generator-per-purpose convention as `assignSpecialRoles`), so replays stay
 * identical; this is NOT a vote, just "someone still has to go" — the same spirit as an
 * ordinary clean-plurality elimination. No actor-authority check (system/host-driven, same
 * as `applyTimeout`/`migrateHost`) — the caller (`apply-action.ts`) already gates who may
 * invoke it (the timer wheel, or the host via `advancePhase`). `mirrorBounced: false` —
 * same boundary as `applyJudgeDecide` (ROLES.md).
 */
export function resolveJudgeDecisionByDefault(state: GameState, at: number): ApplyResult {
  if (state.phase !== 'judge_decision') return reject(state, 'wrong_phase');

  const tied = state.tiedPlayerIds ?? [];
  if (tied.length === 0) return reject(state, 'validation');

  const rng = createRng(`${state.seed}:judge-decision-default:${state.round}`);
  const targetId = tied[rng.int(tied.length)] as string;
  return enterCascadeReveal(state, targetId, at, false);
}

/** `castVote` — `voting` only (api-contract.md §2.1 `vote:cast`). Ballots are changeable
 * until the vote closes; re-submitting the SAME target is a harmless no-op. Eliminated
 * voters are normally rejected UNLESS Ghost is enabled (game-design.md §9) — see
 * `eligibleVoterIds` above for the identical carve-out on the "everyone voted" check. */
export function applyCastVote(state: GameState, action: CastVoteAction): ApplyResult {
  if (state.phase !== 'voting') return reject(state, 'wrong_phase');

  const voter = findPlayer(state, action.playerId);
  if (!voter || voter.hasLeft) return reject(state, 'validation');
  const ghostActive = state.settings.specialRoles.includes('ghost');
  if (!voter.alive && !ghostActive) return reject(state, 'validation');

  const target = findPlayer(state, action.targetId);
  if (!target || !target.alive) return reject(state, 'validation');
  if (target.id === voter.id) return reject(state, 'validation');

  // tiedPlayerIds is always set during a re-vote (invariant: cleared only when a fresh
  // clue round starts, which also resets revoteCount to 0).
  if (state.revoteCount === 1 && !(state.tiedPlayerIds as string[]).includes(target.id)) {
    return reject(state, 'validation');
  }

  if (state.votes[voter.id] === target.id) return reject(state, 'already_voted');

  const votes = { ...state.votes, [voter.id]: target.id };
  const eligible = eligibleVoterIds(state);
  const allVoted = eligible.every((id) => Object.hasOwn(votes, id));

  if (!allVoted) return ok({ ...state, votes });
  return closeVote({ ...state, votes }, action.at);
}

/** `timeout{voting}` — closes the vote with whoever has cast so far; non-voters abstain. */
export function timeoutVoting(state: GameState, at: number): ApplyResult {
  return closeVote(state, at);
}

/** Host `advancePhase` / `timeout{discussion}` — `discussion` → `voting`
 * (game-design.md §6.3). */
export function enterVotingFromDiscussion(state: GameState, at: number): ApplyResult {
  const endsAt =
    state.settings.voteTimerSec != null ? at + state.settings.voteTimerSec * 1000 : null;
  const next: GameState = { ...state, phase: 'voting', phaseEndsAt: endsAt, timerExtended: false };
  return ok(next, timerEffects(endsAt));
}
