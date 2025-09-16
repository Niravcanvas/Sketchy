import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { JUDGE_DECISION_TIMEOUT_SEC } from '../constants.js';
import { resolveJudgeDecisionByDefault } from './vote.js';
import { makePlayer, makeState } from '../test-support.js';
import type { GamePlayer, GameState } from '../types.js';

// p0 civilian, p1 civilian, p2 undercover, p3 mrwhite; all alive, voting phase.
function votingState(overrides: Partial<GameState> = {}): GameState {
  return makeState({ phase: 'voting', round: 1, hostId: 'p0', ...overrides });
}

describe('castVote', () => {
  it('rejects outside voting (wrong_phase)', () => {
    const state = { ...votingState(), phase: 'discussion' as const };
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBe('wrong_phase');
    expect(result.state).toBe(state);
  });

  it('rejects an unknown voter (validation)', () => {
    const state = votingState();
    const result = applyAction(state, {
      type: 'castVote',
      at: 1,
      playerId: 'ghost',
      targetId: 'p1',
    });
    expect(result.error).toBe('validation');
  });

  it('rejects a dead voter (validation)', () => {
    const state = votingState({
      players: votingState().players.map((p) => (p.id === 'p0' ? { ...p, alive: false } : p)),
    });
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBe('validation');
  });

  it('rejects a voter who has left (validation)', () => {
    const state = votingState({
      players: votingState().players.map((p) => (p.id === 'p0' ? { ...p, hasLeft: true } : p)),
    });
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBe('validation');
  });

  it('rejects an unknown target (validation)', () => {
    const state = votingState();
    const result = applyAction(state, {
      type: 'castVote',
      at: 1,
      playerId: 'p0',
      targetId: 'ghost',
    });
    expect(result.error).toBe('validation');
  });

  it('rejects a dead target (validation)', () => {
    const state = votingState({
      players: votingState().players.map((p) => (p.id === 'p1' ? { ...p, alive: false } : p)),
    });
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBe('validation');
  });

  it('rejects voting for yourself (validation)', () => {
    const state = votingState();
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p0' });
    expect(result.error).toBe('validation');
  });

  it('during a revote, rejects a target outside tiedPlayerIds (validation)', () => {
    const state = votingState({ revoteCount: 1, tiedPlayerIds: ['p1', 'p3'] });
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p2' });
    expect(result.error).toBe('validation');
  });

  it('during a revote, allows a target inside tiedPlayerIds', () => {
    const state = votingState({ revoteCount: 1, tiedPlayerIds: ['p1', 'p3'] });
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBeUndefined();
  });

  it('records a ballot without closing when voters remain', () => {
    const state = votingState();
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('voting');
    expect(result.state.votes).toEqual({ p0: 'p1' });
  });

  it('allows changing your ballot to a different target', () => {
    const once = applyAction(votingState(), {
      type: 'castVote',
      at: 1,
      playerId: 'p0',
      targetId: 'p1',
    }).state;
    const changed = applyAction(once, { type: 'castVote', at: 2, playerId: 'p0', targetId: 'p2' });
    expect(changed.error).toBeUndefined();
    expect(changed.state.votes).toEqual({ p0: 'p2' });
  });

  it('re-submitting the SAME target is a harmless no-op (already_voted)', () => {
    const once = applyAction(votingState(), {
      type: 'castVote',
      at: 1,
      playerId: 'p0',
      targetId: 'p1',
    }).state;
    const again = applyAction(once, { type: 'castVote', at: 2, playerId: 'p0', targetId: 'p1' });
    expect(again.error).toBe('already_voted');
    expect(again.state).toBe(once);
  });

  it('closes the vote once every eligible (alive, not-left) voter has cast', () => {
    let state = votingState();
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p2' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p2' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p2' }).state;
    const result = applyAction(state, { type: 'castVote', at: 4, playerId: 'p2', targetId: 'p0' });
    expect(result.state.phase).toBe('reveal');
  });

  it('a player who has left does not count toward "everyone voted"', () => {
    const state = votingState({
      players: votingState().players.map((p) => (p.id === 'p3' ? { ...p, hasLeft: true } : p)),
    });
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p0' }).state;
    const result = applyAction(s, { type: 'castVote', at: 3, playerId: 'p2', targetId: 'p0' });
    // p3 has left and is excluded from the eligible set, so 3 ballots (p0,p1,p2) close it.
    expect(result.state.phase).toBe('reveal');
  });
});

describe('vote close — tally outcomes', () => {
  it('unique plurality -> reveal, eliminated player alive:false, revealRole + 8s timer effects', () => {
    let state = votingState();
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p2' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p2' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p2' }).state;
    const result = applyAction(state, {
      type: 'castVote',
      at: 4000,
      playerId: 'p2',
      targetId: 'p0',
    });

    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p2');
    expect(result.state.players.find((p) => p.id === 'p2')).toMatchObject({
      alive: false,
      eliminatedRound: 1,
    });
    expect(result.state.phaseEndsAt).toBe(4000 + 8000);
    expect(result.effects).toEqual([
      { type: 'revealRole', playerId: 'p2' },
      { type: 'startTimer', endsAt: 4000 + 8000 },
    ]);
    expect(result.state.votes).toEqual({});
  });

  it('records a voteHistory entry BEFORE clearing votes', () => {
    let state = votingState();
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p2' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p2' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p2' }).state;
    const result = applyAction(state, { type: 'castVote', at: 4, playerId: 'p2', targetId: 'p0' });
    expect(result.state.voteHistory).toEqual([
      {
        round: 1,
        revote: false,
        votes: { p0: 'p2', p1: 'p2', p3: 'p2', p2: 'p0' },
        eliminated: 'p2',
      },
    ]);
  });

  it('all-abstain (timeout with zero ballots) -> no elimination, straight to next clue round', () => {
    const state = votingState();
    const result = applyAction(state, { type: 'timeout', at: 1000, phase: 'voting' });
    expect(result.state.phase).toBe('clue');
    expect(result.state.round).toBe(2);
    expect(result.state.pendingElimination).toBeNull();
    expect(result.state.voteHistory).toEqual([
      { round: 1, revote: false, votes: {}, eliminated: null },
    ]);
  });

  it('timeout{voting} closes with whoever voted; non-voters abstain', () => {
    const once = applyAction(votingState(), {
      type: 'castVote',
      at: 1,
      playerId: 'p0',
      targetId: 'p2',
    }).state;
    const result = applyAction(once, { type: 'timeout', at: 1000, phase: 'voting' });
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p2');
  });

  it('first tie -> tiebreak_clue with tiedPlayerIds set, revoteCount stays 0', () => {
    let state = votingState();
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p1' }).state;
    const result = applyAction(state, {
      type: 'castVote',
      at: 4000,
      playerId: 'p1',
      targetId: 'p3',
    });
    // p1: 2 votes (p0,p3), p3: 2 votes (p2,p1) -> tie.
    expect(result.state.phase).toBe('tiebreak_clue');
    expect(result.state.revoteCount).toBe(0);
    expect(result.state.turnSeat).toBe(0);
    expect(new Set(result.state.tiedPlayerIds)).toEqual(new Set(['p1', 'p3']));
    expect(result.state.phaseEndsAt).toBe(4000 + 60_000); // default clueTimerSec
  });

  it('first tie -> untimed tiebreak_clue when clueTimerSec is null', () => {
    const state = votingState({ settings: { ...votingState().settings, clueTimerSec: null } });
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    s = applyAction(s, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p1' }).state;
    const result = applyAction(s, { type: 'castVote', at: 4, playerId: 'p1', targetId: 'p3' });
    expect(result.state.phase).toBe('tiebreak_clue');
    expect(result.state.phaseEndsAt).toBeNull();
    expect(result.effects).toEqual([{ type: 'clearTimer' }]);
  });

  it('second tie (revoteCount already 1) -> no elimination, next clue round', () => {
    const state = votingState({ revoteCount: 1, tiedPlayerIds: ['p1', 'p3'], round: 2 });
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    s = applyAction(s, { type: 'castVote', at: 3, playerId: 'p1', targetId: 'p3' }).state;
    const result = applyAction(s, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p1' });
    expect(result.state.phase).toBe('clue');
    expect(result.state.round).toBe(3);
    expect(result.state.tiedPlayerIds).toBeNull();
    expect(result.state.pendingElimination).toBeNull();
  });

  it('a revote CAN resolve to a unique plurality (elimination), not just repeat the tie', () => {
    const state = votingState({ revoteCount: 1, tiedPlayerIds: ['p1', 'p3'] });
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p1' }).state;
    s = applyAction(s, { type: 'castVote', at: 3, playerId: 'p1', targetId: 'p3' }).state;
    const result = applyAction(s, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p1' });
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p1');
  });
});

describe('enterVotingFromDiscussion (advancePhase / timeout{discussion})', () => {
  it('advancePhase: host-only, discussion -> voting', () => {
    const state = makeState({ phase: 'discussion', hostId: 'p0', phaseEndsAt: 500 });
    const result = applyAction(state, { type: 'advancePhase', at: 1000, playerId: 'p0' });
    expect(result.state.phase).toBe('voting');
    expect(result.state.phaseEndsAt).toBe(1000 + 45_000); // default voteTimerSec
  });

  it('advancePhase rejects a non-host actor (not_host)', () => {
    const state = makeState({ phase: 'discussion', hostId: 'p0' });
    const result = applyAction(state, { type: 'advancePhase', at: 1, playerId: 'p1' });
    expect(result.error).toBe('not_host');
  });

  it('advancePhase rejects any phase other than discussion/reveal (wrong_phase)', () => {
    const state = makeState({ phase: 'lobby', hostId: 'p0' });
    const result = applyAction(state, { type: 'advancePhase', at: 1, playerId: 'p0' });
    expect(result.error).toBe('wrong_phase');
  });

  it('timeout{discussion} advances to voting exactly like advancePhase', () => {
    const state = makeState({ phase: 'discussion', hostId: 'p0' });
    const result = applyAction(state, { type: 'timeout', at: 1, phase: 'discussion' });
    expect(result.state.phase).toBe('voting');
  });

  it('untimed voting when voteTimerSec is null', () => {
    const state = makeState({
      phase: 'discussion',
      hostId: 'p0',
      settings: { ...makeState().settings, voteTimerSec: null },
    });
    const result = applyAction(state, { type: 'advancePhase', at: 1, playerId: 'p0' });
    expect(result.state.phaseEndsAt).toBeNull();
    expect(result.effects).toEqual([{ type: 'clearTimer' }]);
  });
});

// --- The Judge special role (tie arbitration) -----------------------------------

/** `votingState` with `specialRole: 'judge'` layered onto `playerId` (any base role/alive
 * status — the Judge is orthogonal to both). */
function withJudge(playerId: string, overrides: Partial<GameState> = {}): GameState {
  const state = votingState(overrides);
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, specialRole: 'judge' } : p)),
  };
}

describe('closeVote — Judge special role supersedes tiebreak_clue on a first tie', () => {
  it('routes a first tie to judge_decision instead of tiebreak_clue when a Judge exists', () => {
    let state = withJudge('p2'); // p2 (undercover, alive) holds Judge
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p1' }).state;
    const result = applyAction(state, {
      type: 'castVote',
      at: 4000,
      playerId: 'p1',
      targetId: 'p3',
    });
    // p1: 2 votes (p0,p3), p3: 2 votes (p2,p1) -> tie, same tally as the plain tiebreak test.
    expect(result.state.phase).toBe('judge_decision');
    expect(new Set(result.state.tiedPlayerIds)).toEqual(new Set(['p1', 'p3']));
    expect(result.state.turnSeat).toBeNull();
    // judge_decision is always timed (JUDGE_DECISION_TIMEOUT_SEC) so an
    // unreachable Judge can never stall the game — see resolveJudgeDecisionByDefault tests.
    expect(result.state.phaseEndsAt).toBe(4000 + JUDGE_DECISION_TIMEOUT_SEC * 1000);
    expect(result.state.judgeRevealed).toBe(true);
    expect(result.effects).toEqual([
      { type: 'startTimer', endsAt: 4000 + JUDGE_DECISION_TIMEOUT_SEC * 1000 },
    ]);
    // The tie's own VoteRecord is logged (eliminated: null) — the Judge hasn't decided yet.
    expect(result.state.voteHistory.at(-1)).toMatchObject({ eliminated: null });
  });

  it('still routes to judge_decision when the Judge has ALREADY been eliminated (research/03)', () => {
    // p2 (the Judge) is already out; the 3 remaining alive voters are p0/p1/p3. A round-robin
    // ballot (p0->p1, p1->p3, p3->p0) ties all three at 1 vote each.
    const state = votingState({
      players: votingState().players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1, specialRole: 'judge' } : p,
      ),
    });
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p3' }).state;
    const result = applyAction(s, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p0' });
    expect(result.state.phase).toBe('judge_decision');
    expect(new Set(result.state.tiedPlayerIds)).toEqual(new Set(['p0', 'p1', 'p3']));
    expect(result.state.judgeRevealed).toBe(true);
  });

  it('second tie (revoteCount already 1) is unaffected by a Judge — no re-routing mid-revote', () => {
    // Structurally unreachable in real play (the Judge intercepts every revoteCount===0 tie
    // before a revote ever starts), but pins that the Judge check is scoped to that branch.
    const state = withJudge('p2', { revoteCount: 1, tiedPlayerIds: ['p1', 'p3'], round: 2 });
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    s = applyAction(s, { type: 'castVote', at: 3, playerId: 'p1', targetId: 'p3' }).state;
    const result = applyAction(s, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p1' });
    expect(result.state.phase).toBe('clue');
    expect(result.state.tiedPlayerIds).toBeNull();
  });
});

// judge_decision's auto-resolution when the Judge is unreachable
// (timeout OR the host's early advancePhase) — closes a liveness gap (game-design.md §8
// "never block on a ghost").
describe('resolveJudgeDecisionByDefault', () => {
  function judgeDecisionState(overrides: Partial<GameState> = {}): GameState {
    return withJudge('p2', {
      phase: 'judge_decision',
      tiedPlayerIds: ['p1', 'p3'],
      votes: {},
      ...overrides,
    });
  }

  it('rejects outside judge_decision (wrong_phase)', () => {
    const state = { ...judgeDecisionState(), phase: 'voting' as const };
    const result = resolveJudgeDecisionByDefault(state, 1);
    expect(result.error).toBe('wrong_phase');
    expect(result.state).toBe(state);
  });

  it('rejects if tiedPlayerIds is empty (defensive — should be unreachable in real play)', () => {
    const state = judgeDecisionState({ tiedPlayerIds: [] });
    const result = resolveJudgeDecisionByDefault(state, 1);
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });

  it('eliminates one of tiedPlayerIds, enters reveal, clears tiedPlayerIds — no actor needed', () => {
    const state = judgeDecisionState();
    const result = resolveJudgeDecisionByDefault(state, 100);
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('reveal');
    expect(result.state.tiedPlayerIds).toBeNull();
    expect(['p1', 'p3']).toContain(result.state.pendingElimination);
    const eliminated = result.state.players.find((p) => p.id === result.state.pendingElimination)!;
    expect(eliminated.alive).toBe(false);
    expect(result.effects).toEqual([
      { type: 'revealRole', playerId: result.state.pendingElimination },
      { type: 'startTimer', endsAt: 100 + 8000 },
    ]);
  });

  it('is deterministic: same seed + same round -> same pick every time', () => {
    const state = judgeDecisionState();
    const picks = Array.from(
      { length: 5 },
      () => resolveJudgeDecisionByDefault(state, 1).state.pendingElimination,
    );
    expect(new Set(picks).size).toBe(1);
  });

  it('timeout{judge_decision} routes here and resolves the tie', () => {
    const state = judgeDecisionState();
    const result = applyAction(state, { type: 'timeout', at: 1, phase: 'judge_decision' });
    expect(result.state.phase).toBe('reveal');
    expect(['p1', 'p3']).toContain(result.state.pendingElimination);
  });

  it("the host's early advancePhase also resolves the tie (escape hatch, mirrors discussion/reveal)", () => {
    const state = judgeDecisionState(); // hostId: 'p0' via votingState()
    const result = applyAction(state, { type: 'advancePhase', at: 1, playerId: 'p0' });
    expect(result.state.phase).toBe('reveal');
    expect(['p1', 'p3']).toContain(result.state.pendingElimination);
  });

  it('a non-host advancePhase during judge_decision is still rejected (not_host)', () => {
    const state = judgeDecisionState();
    const result = applyAction(state, { type: 'advancePhase', at: 1, playerId: 'p1' });
    expect(result.error).toBe('not_host');
    expect(result.state).toBe(state);
  });

  it('awards the Jester first-out bonus when the default pick happens to be the first-out Jester', () => {
    const state = judgeDecisionState({
      players: judgeDecisionState().players.map((p) =>
        p.id === 'p1' || p.id === 'p3' ? { ...p, specialRole: 'jester' as const } : p,
      ),
      // Force the deterministic pick by narrowing tiedPlayerIds to a single candidate —
      // whichever of p1/p3 is eliminated, both hold Jester, so the bonus always applies.
    });
    const result = resolveJudgeDecisionByDefault(state, 1);
    const eliminatedId = result.state.pendingElimination as string;
    expect(result.state.scoreboard[eliminatedId]).toBe(4);
  });
});

describe('applyJudgeDecide', () => {
  function judgeDecisionState(overrides: Partial<GameState> = {}): GameState {
    return withJudge('p2', {
      phase: 'judge_decision',
      tiedPlayerIds: ['p1', 'p3'],
      votes: {},
      ...overrides,
    });
  }

  it('rejects outside judge_decision (wrong_phase)', () => {
    const state = { ...judgeDecisionState(), phase: 'voting' as const };
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p2',
      targetId: 'p1',
    });
    expect(result.error).toBe('wrong_phase');
    expect(result.state).toBe(state);
  });

  it('rejects an actor who does not hold specialRole judge (validation)', () => {
    const state = judgeDecisionState();
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(result.error).toBe('validation');
  });

  it('rejects a target outside tiedPlayerIds (validation)', () => {
    const state = judgeDecisionState();
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p2',
      targetId: 'p0',
    });
    expect(result.error).toBe('validation');
  });

  it('resolves like a clean-plurality vote close: eliminates the target, enters reveal', () => {
    const state = judgeDecisionState();
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 4000,
      playerId: 'p2',
      targetId: 'p1',
    });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p1');
    expect(result.state.tiedPlayerIds).toBeNull();
    expect(result.state.players.find((p) => p.id === 'p1')).toMatchObject({
      alive: false,
      eliminatedRound: state.round,
    });
    expect(result.state.phaseEndsAt).toBe(4000 + 8000);
    expect(result.effects).toEqual([
      { type: 'revealRole', playerId: 'p1' },
      { type: 'startTimer', endsAt: 4000 + 8000 },
    ]);
  });

  it('the eliminated Judge (from before this tie) can still decide it', () => {
    const state = judgeDecisionState({
      players: votingState().players.map((p) =>
        p.id === 'p2'
          ? { ...p, alive: false, eliminatedRound: 1, specialRole: 'judge' }
          : p,
      ),
      tiedPlayerIds: ['p0', 'p3'],
    });
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p2',
      targetId: 'p3',
    });
    expect(result.error).toBeUndefined();
    expect(result.state.pendingElimination).toBe('p3');
  });

  it('the Judge may name themself if they are one of the tied players', () => {
    const state = judgeDecisionState({ tiedPlayerIds: ['p1', 'p2'] });
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p2',
      targetId: 'p2',
    });
    expect(result.error).toBeUndefined();
    expect(result.state.pendingElimination).toBe('p2');
  });
});

// --- The Ghost special role (eliminated players keep voting) -------------------

describe('castVote / closeVote — Ghost special role', () => {
  function ghostState(overrides: Partial<GameState> = {}): GameState {
    return votingState({
      settings: { ...votingState().settings, specialRoles: ['ghost'] },
      ...overrides,
    });
  }

  it('rejects an eliminated voter when ghost is NOT enabled (unchanged baseline)', () => {
    const state = votingState({
      players: votingState().players.map((p) => (p.id === 'p0' ? { ...p, alive: false } : p)),
    });
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBe('validation');
  });

  it('allows an eliminated voter to cast a ballot when ghost is enabled', () => {
    const state = ghostState({
      players: votingState().players.map((p) =>
        p.id === 'p0' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    const result = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' });
    expect(result.error).toBeUndefined();
    expect(result.state.votes).toEqual({ p0: 'p1' });
  });

  it("a ghost's ballot still can't target another eliminated player or itself", () => {
    const state = ghostState({
      players: votingState().players.map((p) =>
        p.id === 'p0' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    const targetSelf = applyAction(state, {
      type: 'castVote',
      at: 1,
      playerId: 'p0',
      targetId: 'p0',
    });
    expect(targetSelf.error).toBe('validation');
  });

  it("the eligible-voter count (waiting on 'everyone voted') INCLUDES ghosts", () => {
    const state = ghostState({
      players: votingState().players.map((p) =>
        p.id === 'p0' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    // p1, p2, p3 (alive) all vote for p0 — but p0 (the ghost) hasn't voted yet, so the vote
    // must NOT close without their ballot too.
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p1', targetId: 'p2' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    const stillOpen = applyAction(s, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p1' });
    expect(stillOpen.state.phase).toBe('voting');
    // Now the ghost casts theirs too — the vote closes.
    const closed = applyAction(stillOpen.state, {
      type: 'castVote',
      at: 4,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(closed.state.phase).not.toBe('voting');
  });

  it("a ghost's ballot changes the outcome from a clean plurality to a tie", () => {
    const state = ghostState({
      players: votingState().players.map((p) =>
        p.id === 'p0' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    // Without the ghost: p1->p3, p2->p3, p3->p1 gives p3 a clean plurality (2 votes).
    // The ghost (p0) votes p1 instead, splitting it into a genuine tie (p3:2, p1:2).
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p1', targetId: 'p3' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    s = applyAction(s, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p1' }).state;
    const result = applyAction(s, { type: 'castVote', at: 4, playerId: 'p0', targetId: 'p1' });
    expect(result.state.phase).toBe('tiebreak_clue');
    expect(new Set(result.state.tiedPlayerIds)).toEqual(new Set(['p1', 'p3']));
  });

  it("a ghost's ballot can also swing a tie into a clean plurality", () => {
    const state = ghostState({
      players: votingState().players.map((p) =>
        p.id === 'p0' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    // Without the ghost: a round-robin among the 3 alive voters (p1->p2, p2->p3, p3->p1)
    // ties all three at 1 vote each. The ghost (p0) then breaks it in p2's favor.
    let s = applyAction(state, { type: 'castVote', at: 1, playerId: 'p1', targetId: 'p2' }).state;
    s = applyAction(s, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p3' }).state;
    const beforeGhost = applyAction(s, {
      type: 'castVote',
      at: 3,
      playerId: 'p3',
      targetId: 'p1',
    }).state;
    // Still open: the ghost (p0) hasn't voted yet, so the eligible set isn't done.
    expect(beforeGhost.phase).toBe('voting');
    const closed = applyAction(beforeGhost, {
      type: 'castVote',
      at: 4,
      playerId: 'p0',
      targetId: 'p2',
    });
    expect(closed.state.phase).toBe('reveal');
    expect(closed.state.pendingElimination).toBe('p2');
  });
});

// --- The Jester special role (+4 first-out consolation) -----------------------

describe('closeVote / applyJudgeDecide — Jester first-out bonus', () => {
  function withJester(playerId: string, overrides: Partial<GameState> = {}): GameState {
    const state = votingState(overrides);
    return {
      ...state,
      players: state.players.map((p) => (p.id === playerId ? { ...p, specialRole: 'jester' } : p)),
    };
  }

  it('awards +4 when the Jester is the FIRST player eliminated this game (clean plurality)', () => {
    let state = withJester('p1');
    // All 4 alive players must vote before the tally closes — p0/p2/p3 pile onto p1; p1's
    // own (required) ballot goes elsewhere and doesn't affect who wins.
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p1' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p1', targetId: 'p0' }).state;
    const result = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p1' });
    expect(result.state.pendingElimination).toBe('p1');
    expect(result.state.scoreboard.p1).toBe(4);
  });

  it('awards NO bonus when the Jester is eliminated SECOND, not first', () => {
    let state = withJester('p1', {
      players: votingState().players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p.id === 'p1' ? { ...p, specialRole: 'jester' } : p,
      ),
    });
    // p2 is already eliminated (round 1, no bonus recorded for them — they aren't the
    // Jester here) — the eligible voters for THIS vote are p0/p1/p3.
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p0' }).state;
    const result = applyAction(state, { type: 'castVote', at: 3, playerId: 'p3', targetId: 'p1' });
    expect(result.state.pendingElimination).toBe('p1');
    expect(result.state.scoreboard.p1 ?? 0).toBe(0);
  });

  it('a non-Jester first-eliminated player gets no bonus', () => {
    let state = votingState(); // nobody holds Jester
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p2', targetId: 'p1' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p1', targetId: 'p0' }).state;
    const result = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p1' });
    expect(result.state.scoreboard.p1 ?? 0).toBe(0);
  });

  it('awards +4 via a Judge decision too, when the Judge-eliminated player is the first-out Jester', () => {
    const state = withJudge('p2', {
      phase: 'judge_decision',
      tiedPlayerIds: ['p1', 'p3'],
      players: votingState()
        .players.map((p) => (p.id === 'p2' ? { ...p, specialRole: 'judge' as const } : p))
        .map((p) => (p.id === 'p1' ? { ...p, specialRole: 'jester' as const } : p)),
    });
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p2',
      targetId: 'p1',
    });
    expect(result.state.pendingElimination).toBe('p1');
    expect(result.state.scoreboard.p1).toBe(4);
  });
});

// --- The Mirror special role (one-shot vote-bounce redirect) ------------------

describe('closeVote — Mirror special role bounces the FIRST plurality against it', () => {
  // 5-player fixture, independent of the 4-player `votingState` base: base roles
  // (civilian/undercover/mrwhite) don't matter for these tests (Mirror cares only about
  // vote tallies) — every seat is a plain civilian except p4, who holds `specialRole:
  // 'mirror'`.
  function mirrorState(overrides: Partial<GameState> = {}): GameState {
    const players: GamePlayer[] = [
      makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p2', seat: 2, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p3', seat: 3, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p4', seat: 4, role: 'civilian', word: 'sun', specialRole: 'mirror' }),
    ];
    return makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p0',
      players,
      settings: { ...makeState().settings, maxPlayers: 5 },
      ...overrides,
    });
  }

  it('a clean plurality against the Mirror redirects: Mirror survives, the top-adjusted bouncer is eliminated instead', () => {
    // p0,p1,p2 vote p4 (mirror) -> unique top (3). p3 votes p0 (unrelated); p4 votes p3.
    // Bounce: p0/p1/p2's ballots redirect to themselves. p3's real ballot (->p0) is
    // untouched and lands on p0, so p0 ends up with 2 (self-bounce + p3's real vote) vs.
    // p1/p2's 1 each -> p0 is uniquely "most-voted among the bouncers".
    let state = mirrorState();
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p2', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p0' }).state;
    const result = applyAction(state, { type: 'castVote', at: 5000, playerId: 'p4', targetId: 'p3' });

    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p0'); // NOT p4 — the Mirror survives
    expect(result.state.players.find((p) => p.id === 'p4')).toMatchObject({
      alive: true,
      usedSpecialPower: true,
    });
    expect(result.state.players.find((p) => p.id === 'p0')).toMatchObject({ alive: false });
    expect(result.state.mirrorBounced).toBe(true);
  });

  it("records the bounced elimination in voteHistory as the ACTUAL target, not the Mirror", () => {
    let state = mirrorState();
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p2', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p0' }).state;
    const result = applyAction(state, { type: 'castVote', at: 5000, playerId: 'p4', targetId: 'p3' });
    expect(result.state.voteHistory.at(-1)).toMatchObject({ eliminated: 'p0' });
    // The RAW ballots recorded are the ORIGINAL (pre-bounce) votes, for historical accuracy.
    expect(result.state.voteHistory.at(-1)?.votes).toEqual({
      p0: 'p4',
      p1: 'p4',
      p2: 'p4',
      p3: 'p0',
      p4: 'p3',
    });
  });

  it('is ONE-SHOT: usedSpecialPower blocks a second bounce, and a later plurality eliminates the Mirror normally', () => {
    let state = mirrorState({
      players: mirrorState().players.map((p) =>
        p.id === 'p4' ? { ...p, usedSpecialPower: true } : p,
      ),
    });
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p2', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p4' }).state;
    const result = applyAction(state, { type: 'castVote', at: 5000, playerId: 'p4', targetId: 'p3' });
    expect(result.state.pendingElimination).toBe('p4'); // eliminated normally this time
    expect(result.state.mirrorBounced).toBe(false);
  });

  it('a tie among bouncers after the bounce routes to the STANDARD tie flow (tiebreak_clue), deterministically', () => {
    // 6 players: p0-p3 vote the Mirror (p5) -> unique top (4). p4 (not a bouncer) votes p0;
    // p5 (Mirror) votes p1 — this symmetric extra-vote placement produces an EXACT 2-way
    // tie between p0 and p1 in the adjusted tally (each: 1 self-bounce + 1 real vote), both
    // strictly ahead of p2/p3 (1 self-bounce each, no extra).
    const sixPlayers: GamePlayer[] = [
      makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p2', seat: 2, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p3', seat: 3, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p4', seat: 4, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p5', seat: 5, role: 'civilian', word: 'sun', specialRole: 'mirror' }),
    ];
    let state = makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p0',
      players: sixPlayers,
      settings: { ...makeState().settings, maxPlayers: 6 },
    });
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p5' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p5' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p2', targetId: 'p5' }).state;
    state = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p5' }).state;
    state = applyAction(state, { type: 'castVote', at: 5, playerId: 'p4', targetId: 'p0' }).state;
    const result = applyAction(state, { type: 'castVote', at: 6000, playerId: 'p5', targetId: 'p1' });

    expect(result.state.phase).toBe('tiebreak_clue'); // no Judge seated -> standard sudden-death
    expect(new Set(result.state.tiedPlayerIds)).toEqual(new Set(['p0', 'p1']));
    expect(result.state.players.find((p) => p.id === 'p5')).toMatchObject({
      alive: true,
      usedSpecialPower: true, // still one-shot, even though nobody was eliminated YET
    });
    // The bounce-caused tie does NOT carry the distinct "bounce" reveal beat (documented
    // scope decision — see resolveMirrorBounce's comment in vote.ts).
    expect(result.state.mirrorBounced).toBe(false);
  });

  it('never eliminates a non-mirror player who happens to tie for second place pre-bounce (mirror must be the SOLE top target)', () => {
    // p4 (mirror) and p0 TIE at the top pre-bounce -> this is a TIE, not a clean plurality,
    // so the bounce must never fire (mirror is eliminated/tie-routed exactly like anyone
    // else would be in a tie).
    let state = mirrorState();
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p0' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p2', targetId: 'p4' }).state;
    const result = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p0' });
    // p4 needs a 5th ballot too (all alive must vote) — cast it last for whichever target
    // keeps this a clean 2-2 tie between p0 and p4.
    const closed = applyAction(result.state, {
      type: 'castVote',
      at: 5000,
      playerId: 'p4',
      targetId: 'p1',
    });
    expect(closed.state.phase).toBe('tiebreak_clue');
    expect(new Set(closed.state.tiedPlayerIds)).toEqual(new Set(['p0', 'p4']));
    expect(closed.state.mirrorBounced).toBe(false);
  });

  it('the eliminated player must be a BOUNCER: a third player who merely drew ordinary votes is NEVER scapegoated by the bounce', () => {
    // Regression: "the most-voted AMONG THE BOUNCERS is eliminated".
    // 6 players: p0,p1,p2 vote the Mirror (p5) -> unique top (3), bounce fires. p3 votes p4;
    // p5 (Mirror) also votes p4 — so p4, a NON-bouncer, draws 2 ordinary votes, MORE than any
    // single bouncer's lone self-bounce. p4 must NOT be eliminated (they never voted the
    // Mirror); the bounce falls on the mob (p0/p1/p2), who each have exactly their self-vote
    // and so TIE -> standard tiebreak flow among the bouncers only.
    const sixPlayers: GamePlayer[] = [
      makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p2', seat: 2, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p3', seat: 3, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p4', seat: 4, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p5', seat: 5, role: 'civilian', word: 'sun', specialRole: 'mirror' }),
    ];
    let state = makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p0',
      players: sixPlayers,
      settings: { ...makeState().settings, maxPlayers: 6 },
    });
    state = applyAction(state, { type: 'castVote', at: 1, playerId: 'p0', targetId: 'p5' }).state;
    state = applyAction(state, { type: 'castVote', at: 2, playerId: 'p1', targetId: 'p5' }).state;
    state = applyAction(state, { type: 'castVote', at: 3, playerId: 'p2', targetId: 'p5' }).state;
    state = applyAction(state, { type: 'castVote', at: 4, playerId: 'p3', targetId: 'p4' }).state;
    state = applyAction(state, { type: 'castVote', at: 5, playerId: 'p4', targetId: 'p3' }).state;
    const result = applyAction(state, { type: 'castVote', at: 6000, playerId: 'p5', targetId: 'p4' });

    // Pre-bounce, p4 had 2 votes (p3, p5) vs. each bouncer's implicit 0 — the OLD full-tally
    // logic would have eliminated the innocent p4. Post-fix: candidacy is bouncers-only.
    expect(result.state.phase).toBe('tiebreak_clue');
    expect(new Set(result.state.tiedPlayerIds)).toEqual(new Set(['p0', 'p1', 'p2']));
    expect(result.state.players.find((p) => p.id === 'p4')).toMatchObject({ alive: true });
    expect(result.state.players.find((p) => p.id === 'p5')).toMatchObject({
      alive: true,
      usedSpecialPower: true,
    });
    expect(result.state.mirrorBounced).toBe(false);
  });
});
