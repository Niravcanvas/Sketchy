import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { createGame } from '../create-game.js';
import { createRng } from '../rng.js';
import { resolveGrudgeDecisionByDefault } from '../reducers/cascade.js';
import { resolveJudgeDecisionByDefault } from '../reducers/vote.js';
import { PAIRED_SPECIAL_ROLES, ROOM_WIDE_SPECIAL_ROLES } from '../constants.js';
import { makePlayer, makeSettings, makeState } from '../test-support.js';
import type { GameAction } from '../actions.js';
import type { GamePlayer, GameSettings, GameState, SpecialRole } from '../types.js';

/**
 * The special-roles "rules-lawyer" interaction matrix. Each `describe`
 * block below is a table of scripted scenarios with a comment explaining the DECISION being
 * pinned and WHY, for whoever (support, a future wave) needs to answer "what happens when
 * X and Y collide". Individual mechanics (Lovebirds cascade shape, Grudge drag, Mirror
 * bounce math, Rivals scoring, Mime derivation) each have their own focused unit tests
 * co-located with the reducer they live in (`reducers/cascade.test.ts`, `reducers/vote.test.ts`,
 * `reducers/scoring.test.ts`, `reducers/clue.test.ts`) — this file is specifically the
 * CROSS-role boundary cases plus the termination fuzz.
 */

/** 8-player fixture: p0-p5 civilian, p6 undercover, p7 mrwhite — a REAL role mix (not all
 * civilian) so `checkWin` never fires prematurely just because a couple of civilians in
 * seats p0-p5 fell; every test in this file assigns special roles only within p0-p5. */
function eightPlayers(): GamePlayer[] {
  return [
    ...Array.from({ length: 6 }, (_, i) =>
      makePlayer({ id: `p${i}`, seat: i, role: 'civilian', word: 'sun' }),
    ),
    makePlayer({ id: 'p6', seat: 6, role: 'undercover', word: 'moon' }),
    makePlayer({ id: 'p7', seat: 7, role: 'mrwhite', word: null }),
  ];
}

function withRoles(
  players: GamePlayer[],
  assignments: Record<string, SpecialRole>,
): GamePlayer[] {
  return players.map((p) =>
    Object.hasOwn(assignments, p.id) ? { ...p, specialRole: assignments[p.id]! } : p,
  );
}

/** Every currently-alive, not-left player votes for `targetId` (self-excluded, throwaway
 * ballot to the first other alive candidate) — see cascade.test.ts's identical helper for
 * the full rationale (every eligible voter MUST appear or the vote never auto-closes). */
function voteOutUnanimously(state: GameState, targetId: string, atStart = 1000): GameState {
  const ghostActive = state.settings.specialRoles.includes('ghost');
  const eligible = state.players.filter((p) => !p.hasLeft && (p.alive || ghostActive));
  const fallback = eligible.find((p) => p.id !== targetId && p.alive)!.id;
  let s = state;
  let at = atStart;
  for (const voter of eligible) {
    const targetForThisVoter = voter.id === targetId ? fallback : targetId;
    const result = applyAction(s, {
      type: 'castVote',
      at,
      playerId: voter.id,
      targetId: targetForThisVoter,
    });
    if (result.error) throw new Error(`unexpected castVote rejection: ${result.error}`);
    s = result.state;
    at += 1;
  }
  return s;
}

describe('Lovebirds x Grudge chains — bounded cascade, win-check exactly once', () => {
  it('a Grudge-dragged Lovebird pulls their partner too: 3 total eliminations from ONE vote close, one checkWin', () => {
    // p0 = Grudge (voted out this round). Grudge drags p1. p1 + p2 are the Lovebirds pair.
    // Chain: p0 (primary, vote) -> grudge_decision -> p1 (dragged) -> p2 (p1's partner,
    // cascades automatically). Bounded: exactly 3 fall, never more (only one Grudge, only
    // one Lovebirds pair exist per game by construction).
    const base = withRoles(eightPlayers(), { p0: 'grudge', p1: 'lovebirds', p2: 'lovebirds' });
    const state = makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p0',
      players: base,
      settings: makeSettings({ undercoverCount: 1, mrWhiteCount: 1, maxPlayers: 8 }),
    });

    const closedVote = voteOutUnanimously(state, 'p0', 1000);
    expect(closedVote.phase).toBe('reveal');
    expect(closedVote.pendingElimination).toBe('p0');
    expect(closedVote.pendingCascade).toEqual([]); // p0 (Grudge) has no Lovebirds partner

    const p0Shown = applyAction(closedVote, { type: 'continueReveal', at: 2000, playerId: 'p0' });
    expect(p0Shown.state.phase).toBe('grudge_decision'); // p0's OWN card triggers their power

    const dragged = applyAction(p0Shown.state, {
      type: 'grudgeDrag',
      at: 3000,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(dragged.state.phase).toBe('reveal');
    expect(dragged.state.pendingElimination).toBe('p1');
    expect(dragged.state.pendingCascade).toEqual(['p2']); // p1's Lovebirds partner queued

    const p1Shown = applyAction(dragged.state, { type: 'continueReveal', at: 4000, playerId: 'p0' });
    expect(p1Shown.state.phase).toBe('reveal');
    expect(p1Shown.state.pendingElimination).toBe('p2');

    const p2Shown = applyAction(p1Shown.state, { type: 'continueReveal', at: 5000, playerId: 'p0' });
    // Chain fully drained -> back to a normal clue round (win-check ran exactly once, here).
    expect(p2Shown.state.phase).toBe('clue');
    expect(p2Shown.state.round).toBe(2);

    const eliminatedThisRound = p2Shown.state.players.filter((p) => p.eliminatedRound === 1);
    expect(new Set(eliminatedThisRound.map((p) => p.id))).toEqual(new Set(['p0', 'p1', 'p2']));
    // Nobody else was ever touched.
    expect(eliminatedThisRound).toHaveLength(3);
  });

  it('the reverse pairing (Grudge IS one half of a mechanic that could self-target) still terminates: Grudge cannot drag their own (nonexistent) Lovebirds partner', () => {
    // A player can hold at most ONE special role (deal.ts's assignment framework) — Grudge
    // and Lovebirds can never be the SAME player, so "the Grudge drags themselves" or "the
    // Grudge is also a Lovebird" are both structurally impossible. This test pins that the
    // Grudge's own elimination never enqueues anything beyond what a plain elimination
    // would (no partner to chain from the Grudge's own card).
    const base = withRoles(eightPlayers(), { p0: 'grudge' });
    const state = makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p1',
      players: base,
      settings: makeSettings({ undercoverCount: 1, mrWhiteCount: 1, maxPlayers: 8 }),
    });
    const closed = voteOutUnanimously(state, 'p0', 1000);
    expect(closed.pendingCascade).toEqual([]);
    const shown = applyAction(closed, { type: 'continueReveal', at: 2000, playerId: 'p1' });
    expect(shown.state.phase).toBe('grudge_decision');
    // Defaulting (nobody dragged) terminates immediately.
    const resolved = resolveGrudgeDecisionByDefault(shown.state, 3000);
    expect(resolved.state.phase).toBe('clue');
  });

  it('a Lovebird partner who is ALSO about to be the Grudge-drag target is only eliminated ONCE (no double-count)', () => {
    // p0 = Grudge. p1 + p4 = Lovebirds. Grudge drags p4 DIRECTLY (the partner itself, not
    // p1) — p4's cascade check then looks for p4's OWN alive partner (p1), queuing p1
    // behind them. Still exactly 3 total fallen (p0, p4, p1), still bounded, still resolves.
    const base = withRoles(eightPlayers(), { p0: 'grudge', p1: 'lovebirds', p4: 'lovebirds' });
    const state = makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p2',
      players: base,
      settings: makeSettings({ undercoverCount: 1, mrWhiteCount: 1, maxPlayers: 8 }),
    });
    const closed = voteOutUnanimously(state, 'p0', 1000);
    const shown = applyAction(closed, { type: 'continueReveal', at: 2000, playerId: 'p2' }).state;
    const dragged = applyAction(shown, {
      type: 'grudgeDrag',
      at: 3000,
      playerId: 'p0',
      targetId: 'p4',
    });
    expect(dragged.state.pendingElimination).toBe('p4');
    expect(dragged.state.pendingCascade).toEqual(['p1']);

    let s = dragged.state;
    for (let i = 0; i < 5 && s.phase === 'reveal'; i++) {
      s = applyAction(s, { type: 'continueReveal', at: 4000 + i * 1000, playerId: 'p2' }).state;
    }
    expect(s.phase).toBe('clue');
    const eliminatedThisRound = s.players.filter((p) => p.eliminatedRound === 1);
    expect(new Set(eliminatedThisRound.map((p) => p.id))).toEqual(new Set(['p0', 'p4', 'p1']));
    expect(eliminatedThisRound).toHaveLength(3); // p1 counted exactly once, not twice
  });
});

describe('Mirror bounce boundary — a Judge decision NEVER triggers the bounce, even when the Mirror is the target', () => {
  it('the Judge EXPLICITLY eliminates the tied Mirror -> eliminated for real, no bounce, usedSpecialPower stays false', () => {
    const base = withRoles(eightPlayers(), { p2: 'judge', p5: 'mirror' });
    const state = makeState({
      phase: 'judge_decision',
      hostId: 'p0',
      round: 1,
      players: base,
      tiedPlayerIds: ['p5', 'p6'],
      settings: makeSettings({ maxPlayers: 8 }),
    });
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1000,
      playerId: 'p2',
      targetId: 'p5', // the Judge names the Mirror
    });
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p5'); // the Mirror, REALLY eliminated
    expect(result.state.mirrorBounced).toBe(false);
    expect(result.state.players.find((p) => p.id === 'p5')).toMatchObject({
      alive: false,
      usedSpecialPower: false, // never got to use it — this wasn't a vote plurality
    });
  });

  it("judge_decision's timeout/host-escape DEFAULT also bypasses the Mirror when it happens to pick them", () => {
    // Narrow tiedPlayerIds to JUST the Mirror so the (otherwise random) default pick is
    // deterministic — a direct, defensive unit-level call, same convention
    // resolveJudgeDecisionByDefault's own tests already use.
    const base = withRoles(eightPlayers(), { p2: 'judge', p5: 'mirror' });
    const state = makeState({
      phase: 'judge_decision',
      hostId: 'p0',
      round: 1,
      players: base,
      tiedPlayerIds: ['p5'],
      settings: makeSettings({ maxPlayers: 8 }),
    });
    const result = resolveJudgeDecisionByDefault(state, 1000);
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p5');
    expect(result.state.mirrorBounced).toBe(false);
    expect(result.state.players.find((p) => p.id === 'p5')).toMatchObject({
      alive: false,
      usedSpecialPower: false,
    });
  });

  it('a Mirror who is tied (not a clean plurality) and goes to a Judge-less tiebreak_clue is just an ordinary tied candidate — no bounce there either', () => {
    const base = withRoles(eightPlayers(), { p5: 'mirror' }); // no Judge seated
    const state = makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p0',
      players: base,
      settings: makeSettings({ undercoverCount: 1, mrWhiteCount: 1, maxPlayers: 8 }),
    });
    // p0,p2 -> p5(mirror); p1,p3 -> p6; the rest scatter to DISTINCT low-traffic targets so
    // nobody else accumulates enough votes to beat the 2-2 tie between p5 and p6.
    let s = state;
    const ballots: [string, string][] = [
      ['p0', 'p5'],
      ['p1', 'p6'],
      ['p2', 'p5'],
      ['p3', 'p6'],
      ['p4', 'p1'],
      ['p5', 'p2'],
      ['p6', 'p3'],
      ['p7', 'p4'],
    ];
    let at = 1000;
    for (const [voter, target] of ballots) {
      s = applyAction(s, { type: 'castVote', at, playerId: voter, targetId: target }).state;
      at += 1;
    }
    expect(s.phase).toBe('tiebreak_clue'); // a genuine tie -> never even reaches the mirror check
    expect(new Set(s.tiedPlayerIds)).toEqual(new Set(['p5', 'p6']));
    expect(s.mirrorBounced).toBe(false);
    expect(s.players.find((p) => p.id === 'p5')).toMatchObject({ usedSpecialPower: false });
  });
});

describe('Mirror + Lovebirds — a bounce that redirects onto a Lovebird still cascades their partner', () => {
  it('the bounce eliminates the ACTUAL (adjusted) target, and if that target is a Lovebird, their partner falls too — same round, Mirror survives', () => {
    // 6 players: p0,p1,p2 vote the Mirror (p5) -> clean plurality (3). p3 votes p0
    // (unrelated real ballot); p4 votes p1; p5(mirror) votes p2. Adjusted: p0 = self(1) +
    // p3's real vote(1) = 2; p1 = self(1) + p4's real vote(1) = 2... to keep this
    // deterministic (no secondary tie), have BOTH extra real votes land on p0 instead.
    // p2/p3 hold the game's only Undercover/Mr. White (neither is ever eliminated below),
    // so falling p0+p4 (both Civilians) never accidentally triggers a premature win.
    const players = withRoles(
      [
        makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun', specialRole: 'lovebirds' }),
        makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
        makePlayer({ id: 'p2', seat: 2, role: 'undercover', word: 'moon' }),
        makePlayer({ id: 'p3', seat: 3, role: 'mrwhite', word: null }),
        makePlayer({ id: 'p4', seat: 4, role: 'civilian', word: 'sun', specialRole: 'lovebirds' }),
        makePlayer({ id: 'p5', seat: 5, role: 'civilian', word: 'sun', specialRole: 'mirror' }),
      ],
      {},
    );
    const state = makeState({
      phase: 'voting',
      round: 1,
      hostId: 'p1',
      players,
      settings: makeSettings({ maxPlayers: 6 }),
    });
    let s = state;
    let at = 1000;
    for (const [voter, target] of [
      ['p0', 'p5'],
      ['p1', 'p5'],
      ['p2', 'p5'],
      ['p3', 'p0'],
      ['p4', 'p0'],
      ['p5', 'p2'],
    ] as const) {
      s = applyAction(s, { type: 'castVote', at, playerId: voter, targetId: target }).state;
      at += 1;
    }
    // p0 adjusted = self(1) + p3(1) + p4(1) = 3, uniquely tops p1/p2's 1 each -> p0 falls.
    expect(s.phase).toBe('reveal');
    expect(s.pendingElimination).toBe('p0');
    expect(s.mirrorBounced).toBe(true);
    expect(s.pendingCascade).toEqual(['p4']); // p0's Lovebirds partner cascades
    expect(s.players.find((p) => p.id === 'p5')).toMatchObject({ alive: true }); // Mirror survives
    expect(s.players.find((p) => p.id === 'p4')).toMatchObject({ alive: false, eliminatedRound: 1 });

    const afterPrimary = applyAction(s, { type: 'continueReveal', at: 2000, playerId: 'p1' });
    expect(afterPrimary.state.pendingElimination).toBe('p4');
    const afterPartner = applyAction(afterPrimary.state, {
      type: 'continueReveal',
      at: 3000,
      playerId: 'p1',
    });
    expect(afterPartner.state.phase).toBe('clue'); // chain drained, only p0+p4 fell
    const eliminatedThisRound = afterPartner.state.players.filter((p) => p.eliminatedRound === 1);
    expect(new Set(eliminatedThisRound.map((p) => p.id))).toEqual(new Set(['p0', 'p4']));
  });
});

describe('Rivals — both surviving to game end means NO points either way', () => {
  it('civilians win with both Rivals still alive -> only the ordinary +2 civilian payout, no Rivals swing', () => {
    const players = withRoles(
      [
        makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun', alive: true, specialRole: 'rivals' }),
        makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun', alive: true, specialRole: 'rivals' }),
        makePlayer({
          id: 'p2',
          seat: 2,
          role: 'undercover',
          word: 'moon',
          alive: false,
          eliminatedRound: 1,
        }),
      ],
      {},
    );
    const state = makeState({
      phase: 'reveal',
      hostId: 'p0',
      round: 1,
      players,
      pendingElimination: 'p2',
    });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: 'p0' });
    expect(result.state.phase).toBe('game_over');
    expect(result.state.winnerFaction).toBe('civilian');
    expect(result.state.scoreboard).toEqual({ p0: 2, p1: 2 }); // no +2/-2 Rivals swing
  });
});

describe('Ghost voters counting toward a Mirror bounce', () => {
  it("an eliminated Ghost's ballot for the Mirror is what pushes them into a plurality in the first place", () => {
    // 6 players, Ghost enabled. p3 is ALREADY eliminated (an earlier round) but — Ghost
    // being active — still votes. p0/p1 (alive) + p3 (dead Ghost) vote the Mirror (p5):
    // WITHOUT p3's ballot, mirror would only have 2 votes, tying p0's eventual tally (see
    // below) — WITH it, mirror uniquely tops at 3, proving the Ghost's vote is genuinely
    // counted as a bouncer, not silently excluded for being dead.
    const players = withRoles(
      [
        makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
        makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
        makePlayer({ id: 'p2', seat: 2, role: 'civilian', word: 'sun' }),
        makePlayer({
          id: 'p3',
          seat: 3,
          role: 'civilian',
          word: 'sun',
          alive: false,
          eliminatedRound: 1,
        }),
        makePlayer({ id: 'p4', seat: 4, role: 'civilian', word: 'sun' }),
        makePlayer({ id: 'p5', seat: 5, role: 'civilian', word: 'sun', specialRole: 'mirror' }),
      ],
      {},
    );
    const state = makeState({
      phase: 'voting',
      round: 2,
      hostId: 'p0',
      players,
      settings: makeSettings({ maxPlayers: 6, specialRoles: ['ghost'] }),
    });
    // Eligible voters (Ghost active): p0,p1,p2,p3(ghost),p4,p5 — everyone, dead or alive.
    let s = state;
    let at = 1000;
    for (const [voter, target] of [
      ['p0', 'p5'], // bouncer
      ['p1', 'p5'], // bouncer
      ['p3', 'p5'], // bouncer — the GHOST's ballot
      ['p2', 'p0'], // real vote for p0 (a bouncer) — pushes p0 ahead post-bounce
      ['p4', 'p0'], // real vote for p0 too
      ['p5', 'p2'], // mirror's own ballot
    ] as const) {
      s = applyAction(s, { type: 'castVote', at, playerId: voter, targetId: target }).state;
      at += 1;
    }
    expect(s.phase).toBe('reveal');
    // p0 adjusted = self(1) + p2(1) + p4(1) = 3; p1 = self(1); p3(ghost) = DROPPED (a dead
    // caster's bounced ballot can't land on them — reducers/vote.ts resolveMirrorBounce).
    expect(s.pendingElimination).toBe('p0');
    expect(s.mirrorBounced).toBe(true);
    // The Ghost (p3) is untouched — still eliminatedRound 1, NOT bumped to round 2.
    expect(s.players.find((p) => p.id === 'p3')).toMatchObject({ eliminatedRound: 1 });
  });

  it('WITHOUT the Ghost vote, the same table would only tie the Mirror — proving the ballot genuinely mattered', () => {
    const players = withRoles(
      [
        makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
        makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
        makePlayer({ id: 'p2', seat: 2, role: 'civilian', word: 'sun' }),
        makePlayer({
          id: 'p3',
          seat: 3,
          role: 'civilian',
          word: 'sun',
          alive: false,
          eliminatedRound: 1,
        }),
        makePlayer({ id: 'p4', seat: 4, role: 'civilian', word: 'sun' }),
        makePlayer({ id: 'p5', seat: 5, role: 'civilian', word: 'sun', specialRole: 'mirror' }),
      ],
      {},
    );
    // Ghost NOT enabled this time -> p3 is ineligible to vote at all; the "everyone alive
    // has voted" gate closes after just the 5 alive players.
    const state = makeState({
      phase: 'voting',
      round: 2,
      hostId: 'p0',
      players,
      settings: makeSettings({ maxPlayers: 6, specialRoles: [] }),
    });
    let s = state;
    let at = 1000;
    for (const [voter, target] of [
      ['p0', 'p5'],
      ['p1', 'p5'],
      ['p2', 'p0'],
      ['p4', 'p0'],
      ['p5', 'p2'],
    ] as const) {
      s = applyAction(s, { type: 'castVote', at, playerId: voter, targetId: target }).state;
      at += 1;
    }
    // Mirror(p5)=2 (p0,p1), p0=2 (p2,p4) -> a TIE at the top -> the bounce never even
    // triggers (mirror isn't the SOLE top target) -> routes to the standard tie flow.
    expect(s.phase).toBe('tiebreak_clue');
    expect(new Set(s.tiedPlayerIds)).toEqual(new Set(['p0', 'p5']));
  });
});

describe('20-seed fuzz at 8 players — every legal special-role combo always terminates with a valid winner', () => {
  const ALL_ROLES: SpecialRole[] = [
    'judge',
    'jester',
    'ghost',
    'mime',
    'mirror',
    'lovebirds',
    'grudge',
    'rivals',
  ];

  function slotCost(role: SpecialRole): number {
    if (ROOM_WIDE_SPECIAL_ROLES.has(role)) return 0;
    if (PAIRED_SPECIAL_ROLES.has(role)) return 2;
    return 1;
  }

  /** A random LEGAL special-role combo for 8 players: every role in this pool already
   * clears `SPECIAL_ROLE_MIN_PLAYERS` at 8 seats, so the only constraint left to respect is
   * the total-slot budget (`floor(8/2) = 4`). */
  function randomLegalCombo(rng: ReturnType<typeof createRng>): SpecialRole[] {
    const shuffled = rng.shuffle(ALL_ROLES);
    const chosen: SpecialRole[] = [];
    let usedSlots = 0;
    for (const role of shuffled) {
      const cost = slotCost(role);
      if (usedSlots + cost <= 4) {
        chosen.push(role);
        usedSlots += cost;
      }
    }
    return chosen;
  }

  function runOneFuzzGame(driverSeed: string): { winner: string; rounds: number } {
    const rng = createRng(driverSeed);
    const specialRoles = randomLegalCombo(rng);
    const settings: GameSettings = makeSettings({
      undercoverCount: 1 + rng.int(2),
      mrWhiteCount: 1,
      maxPlayers: 8,
      specialRoles,
    });
    const players = eightPlayers();
    let state = createGame(settings, players, `fuzz-${driverSeed}`, 0);
    let at = 1;

    function dispatch(action: GameAction): void {
      const result = applyAction(state, action);
      if (result.error) {
        throw new Error(
          `fuzz ${driverSeed}: unexpected rejection ${action.type} in ${state.phase} -> ${result.error}`,
        );
      }
      state = result.state;
      at += 1;
    }

    dispatch({
      type: 'start',
      at,
      playerId: state.hostId,
      pair: { wordA: 'Coffee', wordB: 'Tea', pairId: null },
    });
    for (const p of [...state.players]) dispatch({ type: 'ackWord', at, playerId: p.id });

    let safety = 0;
    while (state.phase !== 'game_over') {
      safety += 1;
      if (safety > 3000) {
        throw new Error(
          `fuzz ${driverSeed}: runaway simulation, stuck in ${state.phase} (specialRoles: ${specialRoles.join(',')})`,
        );
      }

      if (state.phase === 'clue' || state.phase === 'tiebreak_clue') {
        const order =
          state.phase === 'tiebreak_clue'
            ? state.players.filter((p) => (state.tiedPlayerIds ?? []).includes(p.id))
            : state.players.filter((p) => p.alive);
        const holder = order[state.turnSeat as number] as GamePlayer;
        if (rng.next() < 0.1) {
          dispatch({ type: 'skipTurn', at, playerId: state.hostId });
        } else {
          dispatch({ type: 'submitClue', at, playerId: holder.id, text: `hint-${at}` });
        }
      } else if (state.phase === 'discussion') {
        dispatch({ type: 'advancePhase', at, playerId: state.hostId });
      } else if (state.phase === 'voting') {
        const ghostActive = state.settings.specialRoles.includes('ghost');
        const voters = state.players.filter((p) => !p.hasLeft && (p.alive || ghostActive));
        const tied = state.tiedPlayerIds;
        for (const voter of voters) {
          if (rng.next() < 0.1) continue; // simulate an abstention
          const candidates =
            state.revoteCount === 1 && tied
              ? state.players.filter((p) => tied.includes(p.id) && p.id !== voter.id)
              : state.players.filter((p) => p.alive && p.id !== voter.id);
          if (candidates.length === 0) continue;
          const target = candidates[rng.int(candidates.length)] as GamePlayer;
          dispatch({ type: 'castVote', at, playerId: voter.id, targetId: target.id });
          if ((state.phase as string) !== 'voting') break; // vote closed already
        }
        if ((state.phase as string) === 'voting') {
          dispatch({ type: 'timeout', at, phase: 'voting' });
        }
      } else if (state.phase === 'judge_decision') {
        if (rng.next() < 0.5) {
          const judge = state.players.find((p) => p.specialRole === 'judge')!;
          const tied = state.tiedPlayerIds ?? [];
          const targetId = tied[rng.int(tied.length)] as string;
          dispatch({ type: 'judgeDecide', at, playerId: judge.id, targetId });
        } else {
          dispatch({ type: 'timeout', at, phase: 'judge_decision' });
        }
      } else if (state.phase === 'grudge_decision') {
        const grudgeId = state.pendingElimination as string;
        const aliveOthers = state.players.filter((p) => p.alive);
        if (aliveOthers.length > 0 && rng.next() < 0.6) {
          const target = aliveOthers[rng.int(aliveOthers.length)] as GamePlayer;
          dispatch({ type: 'grudgeDrag', at, playerId: grudgeId, targetId: target.id });
        } else {
          dispatch({ type: 'timeout', at, phase: 'grudge_decision' });
        }
      } else if (state.phase === 'reveal') {
        dispatch({ type: 'continueReveal', at, playerId: state.hostId });
      } else if (state.phase === 'mrwhite_guess') {
        const correct = rng.next() < 0.2;
        const text = correct ? state.pair.civilianWord : 'definitely-wrong';
        dispatch({ type: 'mrWhiteGuess', at, playerId: state.pendingElimination as string, text });
      } else if (state.phase === 'dealing') {
        // Shouldn't recur mid-loop (only the initial ackWord pass hits `dealing`), but
        // guard defensively rather than looping forever if it somehow does.
        dispatch({ type: 'timeout', at, phase: 'dealing' });
      }
    }

    expect(state.winnerFaction).not.toBeNull();
    expect(state.pendingCascade).toEqual([]); // never left mid-cascade
    return { winner: state.winnerFaction as string, rounds: state.round };
  }

  it.each(Array.from({ length: 20 }, (_, i) => i))(
    'seed %i: a random legal role mix always terminates with a valid winner',
    (seedIdx) => {
      const { winner } = runOneFuzzGame(`seed-${seedIdx}`);
      expect(['civilian', 'undercover', 'mrwhite', 'infiltrators']).toContain(winner);
    },
  );
});
