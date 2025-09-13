import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { GRUDGE_DECISION_TIMEOUT_SEC, REVEAL_AUTO_ADVANCE_SEC } from '../constants.js';
import { makePlayer, makeSettings, makeState } from '../test-support.js';
import type { GamePlayer, GameState } from '../types.js';
import { resolveGrudgeDecisionByDefault } from './cascade.js';

// 6-player base fixture: p0 civ, p1 civ, p2 uc, p3 mrwhite, p4 civ, p5 civ — voting phase,
// everyone alive. Special roles layered on via `overrides` per test.
function sixPlayerVotingState(overrides: Partial<GameState> = {}): GameState {
  const players: GamePlayer[] = [
    makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
    makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
    makePlayer({ id: 'p2', seat: 2, role: 'undercover', word: 'moon' }),
    makePlayer({ id: 'p3', seat: 3, role: 'mrwhite', word: null }),
    makePlayer({ id: 'p4', seat: 4, role: 'civilian', word: 'sun' }),
    makePlayer({ id: 'p5', seat: 5, role: 'civilian', word: 'sun' }),
  ];
  return makeState({
    phase: 'voting',
    round: 1,
    hostId: 'p0',
    players,
    settings: makeSettings({ undercoverCount: 1, mrWhiteCount: 1, maxPlayers: 6 }),
    ...overrides,
  });
}

function withSpecialRole(
  state: GameState,
  assignments: Record<string, 'lovebirds' | 'grudge' | 'rivals' | 'jester' | 'mirror'>,
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      Object.hasOwn(assignments, p.id) ? { ...p, specialRole: assignments[p.id]! } : p,
    ),
  };
}

/** Casts ballots from every voter in `ballots` (voterId -> targetId), dispatching through
 * `applyAction` so the vote closes naturally once everyone eligible has voted. Every alive,
 * not-left player MUST appear as a key (including the eventual target, who obviously can't
 * vote for themselves) or the vote will simply never close — see `voteOutUnanimously` below
 * for the usual case (everyone piles onto one target). */
function castAll(state: GameState, ballots: Record<string, string>, atStart = 1): GameState {
  let s = state;
  let at = atStart;
  for (const [voterId, targetId] of Object.entries(ballots)) {
    const result = applyAction(s, { type: 'castVote', at, playerId: voterId, targetId });
    if (result.error) throw new Error(`unexpected castVote rejection: ${result.error}`);
    s = result.state;
    at += 1;
  }
  return s;
}

/** Every currently-alive, not-left player votes for `targetId`, except `targetId`
 * themselves (can't self-vote) who casts a harmless throwaway ballot for whichever OTHER
 * alive candidate sorts first — guarantees a clean, unanimous-enough plurality (never a
 * tie) with zero risk of forgetting a voter (the #1 bug risk in hand-built ballot maps). */
function voteOutUnanimously(state: GameState, targetId: string, atStart = 1000): GameState {
  const eligible = state.players.filter((p) => p.alive && !p.hasLeft);
  const fallback = eligible.find((p) => p.id !== targetId)!.id;
  const ballots: Record<string, string> = {};
  for (const voter of eligible) {
    ballots[voter.id] = voter.id === targetId ? fallback : targetId;
  }
  return castAll(state, ballots, atStart);
}

describe('Lovebirds chained elimination (enterCascadeReveal, via closeVote plurality)', () => {
  it('eliminates the primary AND their alive Lovebirds partner in the same reveal, same round', () => {
    // p0 civilian, p4 civilian — the Lovebirds pair. Everyone votes p0 out.
    const state = withSpecialRole(sixPlayerVotingState(), { p0: 'lovebirds', p4: 'lovebirds' });
    const result = voteOutUnanimously(state, 'p0', 1000);

    expect(result.phase).toBe('reveal');
    expect(result.pendingElimination).toBe('p0');
    expect(result.pendingCascade).toEqual(['p4']);
    const p0 = result.players.find((p) => p.id === 'p0')!;
    const p4 = result.players.find((p) => p.id === 'p4')!;
    expect(p0).toMatchObject({ alive: false, eliminatedRound: 1 });
    expect(p4).toMatchObject({ alive: false, eliminatedRound: 1 }); // SAME round, chained
  });

  it('the chain walks one card at a time: continuing the primary reveals the partner next, not the next round', () => {
    const state = withSpecialRole(sixPlayerVotingState(), { p0: 'lovebirds', p4: 'lovebirds' });
    const closed = voteOutUnanimously(state, 'p0', 1000);

    const afterPrimary = applyAction(closed, {
      type: 'continueReveal',
      at: 2000,
      playerId: 'p0',
    });
    // Still mid-cascade: NOT resolved to the next clue round yet.
    expect(afterPrimary.state.phase).toBe('reveal');
    expect(afterPrimary.state.pendingElimination).toBe('p4');
    expect(afterPrimary.state.pendingCascade).toEqual([]);
    expect(afterPrimary.state.round).toBe(1); // unchanged — no new round yet
    expect(afterPrimary.effects).toEqual([
      { type: 'revealRole', playerId: 'p4' },
      { type: 'startTimer', endsAt: 2000 + REVEAL_AUTO_ADVANCE_SEC * 1000 },
    ]);

    const afterPartner = applyAction(afterPrimary.state, {
      type: 'continueReveal',
      at: 3000,
      playerId: 'p0',
    });
    expect(afterPartner.state.phase).toBe('clue');
    expect(afterPartner.state.round).toBe(2);
    expect(afterPartner.state.pendingCascade).toEqual([]);
  });

  it('checkWin runs only ONCE, after the WHOLE cascade drains — not right after the primary falls, even though BOTH are already marked alive:false by then', () => {
    // p3 (mrwhite) already eliminated in an earlier round; p2 is the only remaining
    // Undercover, paired via Lovebirds with p4 (civilian). Voting p2 out would, on its
    // own, already satisfy the civilian-win condition (0 undercover, 0 mrwhite alive) —
    // both p2 AND p4 are marked `alive:false` atomically the instant the vote closes
    // (`enterCascadeReveal`), so the WIN CHECK must be the thing that's deferred, not the
    // elimination itself.
    const base = withSpecialRole(sixPlayerVotingState(), { p2: 'lovebirds', p4: 'lovebirds' });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === 'p3' ? { ...p, alive: false, eliminatedRound: 0 } : p,
      ),
    };
    // p3 is already eliminated (excluded from eligible voters); p2 can't vote for itself
    // (throwaway ballot at p1) — everyone ELSE piles onto p2, a clean 4-1 plurality.
    const closed = castAll(state, { p0: 'p2', p1: 'p2', p5: 'p2', p4: 'p2', p2: 'p1' }, 1000);
    expect(closed.phase).toBe('reveal');
    expect(closed.pendingElimination).toBe('p2');
    expect(closed.pendingCascade).toEqual(['p4']);
    // Both already flipped `alive:false` right now, atomically — the DATA isn't deferred.
    expect(closed.players.find((p) => p.id === 'p2')!.alive).toBe(false);
    expect(closed.players.find((p) => p.id === 'p4')!.alive).toBe(false);
    // But the WIN isn't decided yet — still just `reveal`, no winnerFaction.
    expect(closed.winnerFaction).toBeNull();

    const afterPrimary = applyAction(closed, { type: 'continueReveal', at: 2000, playerId: 'p0' });
    // Mid-cascade (partner's card not shown yet): game must NOT be over yet, even though
    // the underlying roster already satisfies the civilian-win condition.
    expect(afterPrimary.state.phase).toBe('reveal');
    expect(afterPrimary.state.pendingElimination).toBe('p4');
    expect(afterPrimary.state.winnerFaction).toBeNull();

    const afterPartner = applyAction(afterPrimary.state, {
      type: 'continueReveal',
      at: 3000,
      playerId: 'p0',
    });
    // NOW the cascade has fully drained -> checkWin runs (for the first and only time) and
    // correctly resolves the civilian win.
    expect(afterPartner.state.phase).toBe('game_over');
    expect(afterPartner.state.winnerFaction).toBe('civilian');
  });

  it('a Mr. White cascade partner still gets their own guess window before the chain continues', () => {
    // p0 (civilian) paired with p3 (mrwhite) — the Mr.White partner cascades and must get
    // a guess window: "A Mr. White partner still gets their guess if applicable".
    const state = withSpecialRole(sixPlayerVotingState(), { p0: 'lovebirds', p3: 'lovebirds' });
    const closed = voteOutUnanimously(state, 'p0', 1000);
    expect(closed.pendingCascade).toEqual(['p3']);

    const afterPrimary = applyAction(closed, { type: 'continueReveal', at: 2000, playerId: 'p0' });
    // p3 (mrwhite) is next in the cascade -> their card is shown first (a fresh `reveal`
    // beat, same as the primary's), and ONLY continuing THAT card routes to their guess
    // window — the mrwhite check re-runs per cascade member, not just for the primary.
    expect(afterPrimary.state.phase).toBe('reveal');
    expect(afterPrimary.state.pendingElimination).toBe('p3');

    const p3Revealed = applyAction(afterPrimary.state, {
      type: 'continueReveal',
      at: 2500,
      playerId: 'p0',
    });
    expect(p3Revealed.state.phase).toBe('mrwhite_guess');
    expect(p3Revealed.state.pendingElimination).toBe('p3');

    const guessResult = applyAction(p3Revealed.state, {
      type: 'mrWhiteGuess',
      at: 3000,
      playerId: 'p3',
      text: 'wrong-guess',
    });
    expect(guessResult.state.phase).toBe('clue'); // wrong guess -> cascade drains -> next round
    expect(guessResult.state.round).toBe(2);
  });

  it('does not cascade when the primary has no Lovebirds special role', () => {
    const closed = voteOutUnanimously(sixPlayerVotingState(), 'p2', 1000);
    expect(closed.pendingCascade).toEqual([]);
  });

  it("does not double-eliminate when the Lovebirds partner is ALREADY eliminated (dead partner is inert)", () => {
    const base = withSpecialRole(sixPlayerVotingState(), { p0: 'lovebirds', p4: 'lovebirds' });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === 'p4' ? { ...p, alive: false, eliminatedRound: 0 } : p,
      ),
    };
    const closed = voteOutUnanimously(state, 'p0', 1000);
    expect(closed.pendingElimination).toBe('p0');
    expect(closed.pendingCascade).toEqual([]); // p4 was already gone — never re-queued
  });
});

describe('Grudge chained elimination (grudge_decision, applyGrudgeDrag, resolveGrudgeDecisionByDefault)', () => {
  function grudgeVotedOut(atStart = 1000): GameState {
    const state = withSpecialRole(sixPlayerVotingState(), { p0: 'grudge' });
    const closed = voteOutUnanimously(state, 'p0', atStart);
    return applyAction(closed, { type: 'continueReveal', at: atStart + 1000, playerId: 'p0' }).state;
  }

  it("entering grudge_decision follows the Grudge's own reveal card, with a 30s timer", () => {
    const state = grudgeVotedOut(1000);
    expect(state.phase).toBe('grudge_decision');
    expect(state.pendingElimination).toBe('p0');
    expect(state.phaseEndsAt).toBe(2000 + GRUDGE_DECISION_TIMEOUT_SEC * 1000);
  });

  it('grudgeDrag with a real target eliminates them and enters reveal for them next', () => {
    const state = grudgeVotedOut(1000);
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 5000,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p1');
    expect(result.state.players.find((p) => p.id === 'p1')).toMatchObject({
      alive: false,
      eliminatedRound: 1,
    });
    expect(result.state.players.find((p) => p.id === 'p0')).toMatchObject({
      usedSpecialPower: true,
    });
  });

  it("the dragged target's alive Lovebirds partner cascades too (bounded: at most 2 more eliminations)", () => {
    const base = withSpecialRole(grudgeVotedOut(1000), { p1: 'lovebirds', p5: 'lovebirds' });
    const result = applyAction(base, {
      type: 'grudgeDrag',
      at: 5000,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p1');
    expect(result.state.pendingCascade).toEqual(['p5']);
    expect(result.state.players.find((p) => p.id === 'p5')).toMatchObject({
      alive: false,
      eliminatedRound: 1,
    });

    // Walk the rest of the chain: p1's card, then p5's card, then finally the win check.
    // (p0/p1/p5 — all Civilians — are now ALL gone this round, leaving p2 Undercover, p3
    // Mr. White, and p4 the last Civilian standing: civilianAlive<=1 with both an
    // Undercover AND a Mr. White alive -> a genuine infiltrators win, once the FULL chain
    // — grudge + drag target + their cascaded partner — has finished draining.)
    const afterP1 = applyAction(result.state, { type: 'continueReveal', at: 6000, playerId: 'p0' });
    expect(afterP1.state.phase).toBe('reveal');
    expect(afterP1.state.pendingElimination).toBe('p5');
    const afterP5 = applyAction(afterP1.state, {
      type: 'continueReveal',
      at: 7000,
      playerId: 'p0',
    });
    expect(afterP5.state.phase).toBe('game_over');
    expect(afterP5.state.winnerFaction).toBe('infiltrators');
  });

  it('rejects a target that is not currently alive (already fell earlier in the chain)', () => {
    const base = withSpecialRole(grudgeVotedOut(1000), { p1: 'lovebirds', p5: 'lovebirds' });
    // p1 already eliminated earlier this same round, somehow (defensive scenario).
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === 'p1' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    };
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 5000,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(result.error).toBe('validation');
  });

  it('resolveGrudgeDecisionByDefault (timeout): drags NOBODY, marks usedSpecialPower, resolves cleanly', () => {
    const state = grudgeVotedOut(1000);
    const result = resolveGrudgeDecisionByDefault(state, 5000);
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('clue'); // no one else fell -> straight to next round
    expect(result.state.round).toBe(2);
    expect(result.state.players.find((p) => p.id === 'p0')).toMatchObject({
      usedSpecialPower: true,
    });
    // Nobody besides the Grudge (p0) was eliminated this round.
    const eliminatedThisRound = result.state.players.filter((p) => p.eliminatedRound === 1);
    expect(eliminatedThisRound.map((p) => p.id)).toEqual(['p0']);
  });

  it('timeout{grudge_decision} routes to the same "drags nobody" default', () => {
    const state = grudgeVotedOut(1000);
    const result = applyAction(state, { type: 'timeout', at: 5000, phase: 'grudge_decision' });
    expect(result.state.phase).toBe('clue');
  });

  it("the host's early advancePhase during grudge_decision also resolves via the nobody default", () => {
    const state = grudgeVotedOut(1000);
    const result = applyAction(state, { type: 'advancePhase', at: 5000, playerId: 'p0' });
    // hostId is p0, who is ALSO the (now-eliminated) Grudge here — host authority is
    // independent of `alive` (mirrors judge_decision's escape hatch), so this must succeed.
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('clue');
  });

  it('a non-host advancePhase during grudge_decision is rejected (not_host)', () => {
    const state = grudgeVotedOut(1000);
    const result = applyAction(state, { type: 'advancePhase', at: 5000, playerId: 'p1' });
    expect(result.error).toBe('not_host');
  });

  it('applies the Jester first-out bonus to a Grudge-dragged cascade member, not just the primary', () => {
    const base = withSpecialRole(grudgeVotedOut(1000), { p1: 'jester' });
    // p0 (Grudge) was already the first-out this game (round 1) — p1 is NOT first-out, so
    // no bonus should apply to them even though they hold Jester.
    const result = applyAction(base, {
      type: 'grudgeDrag',
      at: 5000,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(result.state.scoreboard.p1 ?? 0).toBe(0);
  });

  it('rejects grudgeDrag from an actor who does not currently hold the pending grudge card', () => {
    const state = grudgeVotedOut(1000);
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 5000,
      playerId: 'p1', // not the Grudge, not pendingElimination
      targetId: 'p2',
    });
    expect(result.error).toBe('validation');
  });
});
