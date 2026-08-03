import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { createGame } from '../create-game.js';
import { createRng } from '../rng.js';
import { makePlayer, makeSettings } from '../test-support.js';
import type { GamePlayer, GameState } from '../types.js';
import { dealRoles } from './deal.js';

const PAIR = { wordA: 'Coffee', wordB: 'Tea', pairId: 'pair-1' };

function lobbyOf(n: number, settingsOverrides: Parameters<typeof makeSettings>[0] = {}): GameState {
  const players = Array.from({ length: n }, (_, i) => makePlayer({ id: `p${i}`, isReady: true }));
  return createGame(makeSettings(settingsOverrides), players, 'seed-x');
}

describe('applyStart', () => {
  it('rejects outside lobby (wrong_phase)', () => {
    const state = { ...lobbyOf(3), phase: 'clue' as const };
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBe('wrong_phase');
  });

  it('rejects a non-host actor (not_host)', () => {
    const state = lobbyOf(3);
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p1', pair: PAIR });
    expect(result.error).toBe('not_host');
  });

  it('rejects below MIN_PLAYERS (validation)', () => {
    const state = lobbyOf(2);
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });

  it('rejects invalid role math against the ACTUAL seated count (validation)', () => {
    // maxPlayers 12 but only 3 seated; uc+mw = 5 >= ceil(3/2) = 2.
    const state = lobbyOf(3, { undercoverCount: 4, mrWhiteCount: 1, maxPlayers: 12 });
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBe('validation');
  });

  it('deals roles, enters dealing, and starts the 45s timer', () => {
    const state = lobbyOf(5, { undercoverCount: 1, mrWhiteCount: 1 });
    const result = applyAction(state, { type: 'start', at: 1000, pair: PAIR, playerId: 'p0' });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('dealing');
    expect(result.state.round).toBe(0);
    expect(result.state.phaseEndsAt).toBe(1000 + 45_000);
    expect(result.effects).toEqual([{ type: 'startTimer', endsAt: 1000 + 45_000 }]);
    const roleCounts = { civilian: 0, undercover: 0, mrwhite: 0 };
    for (const p of result.state.players) {
      expect(p.hasSeenWord).toBe(false);
      expect(p.alive).toBe(true);
      roleCounts[p.role as 'civilian' | 'undercover' | 'mrwhite']++;
    }
    expect(roleCounts).toEqual({ civilian: 3, undercover: 1, mrwhite: 1 });
  });

  it('assigns the civilian word to civilians, the undercover word to undercovers, and null to Mr. White', () => {
    const state = lobbyOf(5, { undercoverCount: 1, mrWhiteCount: 1 });
    const result = applyAction(state, { type: 'start', at: 1, pair: PAIR, playerId: 'p0' });
    const { civilianWord, undercoverWord } = result.state.pair;
    expect([PAIR.wordA, PAIR.wordB]).toContain(civilianWord);
    expect([PAIR.wordA, PAIR.wordB]).toContain(undercoverWord);
    expect(civilianWord).not.toBe(undercoverWord);
    for (const p of result.state.players) {
      if (p.role === 'civilian') expect(p.word).toBe(civilianWord);
      if (p.role === 'undercover') expect(p.word).toBe(undercoverWord);
      if (p.role === 'mrwhite') expect(p.word).toBeNull();
    }
  });

  it('preserves pairId', () => {
    const state = lobbyOf(4, { undercoverCount: 1, mrWhiteCount: 0 });
    const result = applyAction(state, { type: 'start', at: 1, pair: PAIR, playerId: 'p0' });
    expect(result.state.pair.pairId).toBe('pair-1');
  });
});

describe('dealRoles — role counts and side flip across many seeds', () => {
  it('always matches settings role counts, for a range of table sizes', () => {
    for (const n of [3, 4, 5, 8, 12, 20]) {
      const settings = makeSettings({
        undercoverCount: Math.max(1, Math.floor(n / 4)),
        mrWhiteCount: n >= 5 ? 1 : 0,
      });
      for (let seedIdx = 0; seedIdx < 10; seedIdx++) {
        const players: GamePlayer[] = Array.from({ length: n }, (_, i) =>
          makePlayer({ id: `p${i}`, seat: i }),
        );
        const rng = createRng(`count-check:${n}:${seedIdx}`);
        const { players: dealt } = dealRoles(settings, players, PAIR, rng);
        const counts = { civilian: 0, undercover: 0, mrwhite: 0 };
        for (const p of dealt) counts[p.role as 'civilian' | 'undercover' | 'mrwhite']++;
        expect(counts.undercover).toBe(settings.undercoverCount);
        expect(counts.mrwhite).toBe(settings.mrWhiteCount);
        expect(counts.civilian).toBe(n - settings.undercoverCount - settings.mrWhiteCount);
      }
    }
  });

  it('word-side flip happens both ways across seeds', () => {
    const settings = makeSettings({ undercoverCount: 1, mrWhiteCount: 1 });
    const players: GamePlayer[] = Array.from({ length: 5 }, (_, i) =>
      makePlayer({ id: `p${i}`, seat: i }),
    );
    const seenCivilianWords = new Set<string>();
    for (let seedIdx = 0; seedIdx < 100; seedIdx++) {
      const rng = createRng(`flip-check:${seedIdx}`);
      const { pair } = dealRoles(settings, players, PAIR, rng);
      seenCivilianWords.add(pair.civilianWord);
    }
    expect(seenCivilianWords).toEqual(new Set([PAIR.wordA, PAIR.wordB]));
  });

  describe('mrWhiteFirstClueBan', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      mrWhiteFirstClueBan: true,
    });
    const players: GamePlayer[] = Array.from({ length: 5 }, (_, i) =>
      makePlayer({ id: `p${i}`, seat: i }),
    );

    it('seat 0 is NEVER Mr. White across 200 seeds when the ban is on', () => {
      for (let seedIdx = 0; seedIdx < 200; seedIdx++) {
        const rng = createRng(`ban-on:${seedIdx}`);
        const { players: dealt } = dealRoles(settings, players, PAIR, rng);
        expect(dealt[0]!.role).not.toBe('mrwhite');
      }
    });

    it('still deals exactly one Mr. White somewhere when swapping seat 0 away from it', () => {
      for (let seedIdx = 0; seedIdx < 50; seedIdx++) {
        const rng = createRng(`ban-on-count:${seedIdx}`);
        const { players: dealt } = dealRoles(settings, players, PAIR, rng);
        expect(dealt.filter((p) => p.role === 'mrwhite')).toHaveLength(1);
      }
    });

    it('seat 0 IS sometimes Mr. White across many seeds when the ban is off', () => {
      const banOff = { ...settings, mrWhiteFirstClueBan: false };
      let sawMrWhiteAtSeat0 = false;
      for (let seedIdx = 0; seedIdx < 200; seedIdx++) {
        const rng = createRng(`ban-off:${seedIdx}`);
        const { players: dealt } = dealRoles(banOff, players, PAIR, rng);
        if (dealt[0]!.role === 'mrwhite') sawMrWhiteAtSeat0 = true;
      }
      expect(sawMrWhiteAtSeat0).toBe(true);
    });

    it('with 2+ Mr. Whites, seat 0 is still never Mr. White and both are excluded from the swap pool', () => {
      const twoMrWhite = makeSettings({
        undercoverCount: 0,
        mrWhiteCount: 2,
        mrWhiteFirstClueBan: true,
      });
      for (let seedIdx = 0; seedIdx < 200; seedIdx++) {
        const rng = createRng(`ban-on-double-mw:${seedIdx}`);
        const { players: dealt } = dealRoles(twoMrWhite, players, PAIR, rng);
        expect(dealt[0]!.role).not.toBe('mrwhite');
        expect(dealt.filter((p) => p.role === 'mrwhite')).toHaveLength(2);
      }
    });
  });
});

describe('applyAckWord', () => {
  function dealtState(n: number): GameState {
    const started = applyAction(lobbyOf(n, { undercoverCount: 1, mrWhiteCount: 0 }), {
      type: 'start',
      at: 0,
      pair: PAIR,
      playerId: 'p0',
    });
    return started.state;
  }

  it('rejects outside dealing (wrong_phase)', () => {
    const state = { ...dealtState(3), phase: 'clue' as const };
    const result = applyAction(state, { type: 'ackWord', at: 1, playerId: 'p0' });
    expect(result.error).toBe('wrong_phase');
  });

  it('rejects an unknown player (validation)', () => {
    const state = dealtState(3);
    const result = applyAction(state, { type: 'ackWord', at: 1, playerId: 'ghost' });
    expect(result.error).toBe('validation');
  });

  it('marks hasSeenWord and does not transition until everyone has acked', () => {
    const state = dealtState(3);
    const result = applyAction(state, { type: 'ackWord', at: 1, playerId: 'p0' });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('dealing');
    expect(result.state.players.find((p) => p.id === 'p0')!.hasSeenWord).toBe(true);
  });

  it('is idempotent: re-acking does not error or double-transition', () => {
    const state = dealtState(3);
    const once = applyAction(state, { type: 'ackWord', at: 1, playerId: 'p0' }).state;
    const twice = applyAction(once, { type: 'ackWord', at: 2, playerId: 'p0' });
    expect(twice.error).toBeUndefined();
    expect(twice.state.phase).toBe('dealing');
  });

  it('enters clue round 1 once every alive player has acked', () => {
    let state = dealtState(3);
    for (const p of state.players) {
      state = applyAction(state, { type: 'ackWord', at: 1, playerId: p.id }).state;
    }
    expect(state.phase).toBe('clue');
    expect(state.round).toBe(1);
    expect(state.turnSeat).toBe(0);
  });

  it('a player who has hasLeft, but not yet been formally eliminated, still counts as needing to ack', () => {
    // hasLeft mid-dealing doesn't flip `alive` (that's deferred to the next phase boundary),
    // so the "all alive have acked" gate still waits on them.
    let state = dealtState(3);
    state = {
      ...state,
      players: state.players.map((p) => (p.id === 'p1' ? { ...p, hasLeft: true } : p)),
    };
    for (const p of state.players.filter((p) => p.id !== 'p1')) {
      state = applyAction(state, { type: 'ackWord', at: 1, playerId: p.id }).state;
    }
    expect(state.phase).toBe('dealing'); // p1 (hasLeft, but still `alive`) hasn't acked yet
  });

  it('entering clue round 1 is untimed when clueTimerSec is null', () => {
    const state = { ...dealtState(3), settings: { ...dealtState(3).settings, clueTimerSec: null } };
    let last = applyAction(state, { type: 'ackWord', at: 1, playerId: state.players[0]!.id });
    for (const p of state.players.slice(1)) {
      last = applyAction(last.state, { type: 'ackWord', at: 1, playerId: p.id });
    }
    expect(last.state.phase).toBe('clue');
    expect(last.state.phaseEndsAt).toBeNull();
    expect(last.effects).toEqual([{ type: 'clearTimer' }]);
  });
});

describe('timeout{dealing}', () => {
  it('auto-acks everyone and enters clue round 1', () => {
    const started = applyAction(lobbyOf(3, { undercoverCount: 1, mrWhiteCount: 0 }), {
      type: 'start',
      at: 0,
      pair: PAIR,
      playerId: 'p0',
    });
    const result = applyAction(started.state, { type: 'timeout', at: 100, phase: 'dealing' });
    expect(result.state.phase).toBe('clue');
    expect(result.state.round).toBe(1);
    expect(result.state.players.every((p) => p.hasSeenWord)).toBe(true);
  });

  it("leaves an already-dead player's hasSeenWord untouched (defensive: never actually reachable mid-dealing)", () => {
    const started = applyAction(lobbyOf(3, { undercoverCount: 1, mrWhiteCount: 0 }), {
      type: 'start',
      at: 0,
      pair: PAIR,
      playerId: 'p0',
    }).state;
    const withADeadSeat = {
      ...started,
      players: started.players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, hasSeenWord: false } : p,
      ),
    };
    const result = applyAction(withADeadSeat, { type: 'timeout', at: 100, phase: 'dealing' });
    const p2 = result.state.players.find((p) => p.id === 'p2')!;
    expect(p2.hasSeenWord).toBe(false);
    expect(result.state.players.filter((p) => p.id !== 'p2').every((p) => p.hasSeenWord)).toBe(
      true,
    );
  });
});

describe('assignSpecialRoles (phase 12 — the assignment framework, via dealRoles)', () => {
  const sixPlayers: GamePlayer[] = Array.from({ length: 6 }, (_, i) =>
    makePlayer({ id: `p${i}`, seat: i }),
  );

  it('assigns nobody a special role when specialRoles is empty', () => {
    const settings = makeSettings({ undercoverCount: 1, mrWhiteCount: 1, specialRoles: [] });
    const rng = createRng('special-none');
    const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
    expect(dealt.every((p) => p.specialRole === null)).toBe(true);
  });

  it('assigns exactly one player specialRole judge when judge is enabled', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['judge'],
    });
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const rng = createRng(`special-judge:${seedIdx}`);
      const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
      expect(dealt.filter((p) => p.specialRole === 'judge')).toHaveLength(1);
    }
  });

  it('never assigns a holder for ghost — it stays a room-wide setting, not a specialRole', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['ghost'],
    });
    const rng = createRng('special-ghost');
    const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
    expect(dealt.every((p) => p.specialRole === null)).toBe(true);
  });

  it('assigns judge and jester to two DIFFERENT players — at most one special role per player', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['judge', 'jester'],
    });
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const rng = createRng(`special-both:${seedIdx}`);
      const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
      const judge = dealt.find((p) => p.specialRole === 'judge');
      const jester = dealt.find((p) => p.specialRole === 'jester');
      expect(judge).toBeDefined();
      expect(jester).toBeDefined();
      expect(judge!.id).not.toBe(jester!.id);
      // Nobody else picked up a second role.
      const holders = dealt.filter((p) => p.specialRole !== null);
      expect(holders).toHaveLength(2);
    }
  });

  it('ghost enabled alongside judge/jester still only assigns the two holder roles', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['judge', 'ghost', 'jester'],
    });
    const rng = createRng('special-all-three');
    const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
    expect(dealt.filter((p) => p.specialRole !== null)).toHaveLength(2);
  });

  it("a fresh deal never carries over the previous game's special-role holder", () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['judge'],
    });
    const dirty = sixPlayers.map((p) => ({ ...p, specialRole: 'jester' as const }));
    const rng = createRng('special-reset');
    const { players: dealt } = dealRoles(settings, dirty, PAIR, rng);
    expect(dealt.filter((p) => p.specialRole === 'jester')).toHaveLength(0);
    expect(dealt.filter((p) => p.specialRole === 'judge')).toHaveLength(1);
  });

  // --- Paired-role assignment (Lovebirds, Rivals draw TWO distinct holders) ----

  it('assigns lovebirds to exactly TWO different players (a paired role)', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['lovebirds'],
    });
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const rng = createRng(`special-lovebirds:${seedIdx}`);
      const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
      const holders = dealt.filter((p) => p.specialRole === 'lovebirds');
      expect(holders).toHaveLength(2);
      expect(holders[0]!.id).not.toBe(holders[1]!.id);
    }
  });

  it('assigns rivals to exactly TWO different players (a paired role)', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['rivals'],
    });
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const rng = createRng(`special-rivals:${seedIdx}`);
      const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
      expect(dealt.filter((p) => p.specialRole === 'rivals')).toHaveLength(2);
    }
  });

  it('lovebirds + rivals together assign 4 distinct holders total (2 pairs, no overlap)', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['lovebirds', 'rivals'],
    });
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const rng = createRng(`special-two-pairs:${seedIdx}`);
      const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
      const lovebirds = dealt.filter((p) => p.specialRole === 'lovebirds');
      const rivals = dealt.filter((p) => p.specialRole === 'rivals');
      expect(lovebirds).toHaveLength(2);
      expect(rivals).toHaveLength(2);
      const allIds = new Set([...lovebirds, ...rivals].map((p) => p.id));
      expect(allIds.size).toBe(4); // no player holds two special roles
    }
  });

  it('a paired role is skipped ENTIRELY (nobody assigned) when fewer than 2 players remain eligible', () => {
    // 3 players, judge + jester + lovebirds all enabled: judge takes 1, jester takes 1
    // (ASSIGNABLE_SPECIAL_ROLES order), leaving exactly 1 player eligible for lovebirds —
    // which needs 2, so it must assign NOBODY rather than half-assigning one player. (This
    // combo would be rejected by `isValidSpecialRoles`'s budget check at `applyStart` time —
    // exercised here by calling `dealRoles` directly, the same low-level entry point every
    // other test in this describe block uses, to pin `assignSpecialRoles`'s own defensive
    // behavior independent of that higher-level guard.)
    const threePlayers: GamePlayer[] = Array.from({ length: 3 }, (_, i) =>
      makePlayer({ id: `q${i}`, seat: i }),
    );
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 0,
      specialRoles: ['judge', 'jester', 'lovebirds'],
    });
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const rng = createRng(`lovebirds-underflow:${seedIdx}`);
      const { players: dealt } = dealRoles(settings, threePlayers, PAIR, rng);
      expect(dealt.filter((p) => p.specialRole === 'judge')).toHaveLength(1);
      expect(dealt.filter((p) => p.specialRole === 'jester')).toHaveLength(1);
      expect(dealt.filter((p) => p.specialRole === 'lovebirds')).toHaveLength(0);
    }
  });

  it('mime is NEVER assigned a holder — a room-wide setting like ghost (phase 13)', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['mime'],
    });
    const rng = createRng('special-mime');
    const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
    expect(dealt.every((p) => p.specialRole === null)).toBe(true);
  });

  it('mime enabled alongside judge/lovebirds still only assigns the holder roles', () => {
    const settings = makeSettings({
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['judge', 'mime', 'lovebirds'],
    });
    const rng = createRng('special-mime-mixed');
    const { players: dealt } = dealRoles(settings, sixPlayers, PAIR, rng);
    expect(dealt.filter((p) => p.specialRole === 'judge')).toHaveLength(1);
    expect(dealt.filter((p) => p.specialRole === 'lovebirds')).toHaveLength(2);
    expect(dealt.filter((p) => p.specialRole !== null)).toHaveLength(3);
  });
});

describe('applyStart — special-role min-player validation (phase 12)', () => {
  it('rejects a special role needing more players than are seated (validation)', () => {
    // lovebirds needs 5+ (constants.ts SPECIAL_ROLE_MIN_PLAYERS); only 3 seated.
    const state = lobbyOf(3, { specialRoles: ['lovebirds'] });
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });

  // NOTE: this test used to enable all THREE of judge/ghost/jester at 3 players in one
  // combo — that's now rejected by the budget cap below (judge=1 slot + jester=1 slot = 2 >
  // floor(3/2)=1), NOT by a per-role player-count floor (there still isn't one for these
  // three). Split into two: one role at a time still proves "no extra per-role floor"; the
  // budget cap gets its own describe block right below with the old 3-role combo as an
  // explicit rejection case.
  it("accepts judge alone (+ ghost, which is free) at the game's own MIN_PLAYERS floor", () => {
    const state = lobbyOf(3, {
      undercoverCount: 1,
      mrWhiteCount: 0,
      specialRoles: ['judge', 'ghost'],
    });
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('dealing');
  });

  it("accepts jester alone at the game's own MIN_PLAYERS floor", () => {
    const state = lobbyOf(3, {
      undercoverCount: 1,
      mrWhiteCount: 0,
      specialRoles: ['jester'],
    });
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('dealing');
  });
});

describe('isValidSpecialRoles — phase 13 total-holder-slot budget (floor(playerCount / 2))', () => {
  it('rejects judge+jester together at 3 players (2 slots > floor(3/2)=1) — the phase 13 budget cap, not a per-role floor', () => {
    const state = lobbyOf(3, {
      undercoverCount: 1,
      mrWhiteCount: 0,
      specialRoles: ['judge', 'jester'],
    });
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBe('too_spicy');
  });

  it('ghost never counts toward the budget — judge+ghost+jester fits once there are enough players', () => {
    // 8 players -> floor(8/2)=4 slots available; judge(1)+ghost(0)+jester(1)=2 <= 4.
    const state = lobbyOf(8, {
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['judge', 'ghost', 'jester'],
    });
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBeUndefined();
  });

  it('a paired role (lovebirds) counts as TWO slots toward the budget', () => {
    // 5 players (lovebirds' own min) -> floor(5/2)=2 slots. lovebirds alone = 2 slots, fits
    // exactly; adding jester (1 more slot) pushes it to 3 > 2 -> rejected.
    const fits = lobbyOf(5, { undercoverCount: 1, mrWhiteCount: 1, specialRoles: ['lovebirds'] });
    expect(applyAction(fits, { type: 'start', at: 1, playerId: 'p0', pair: PAIR }).error).toBeUndefined();

    const overflows = lobbyOf(5, {
      undercoverCount: 1,
      mrWhiteCount: 1,
      specialRoles: ['lovebirds', 'jester'],
    });
    expect(
      applyAction(overflows, { type: 'start', at: 1, playerId: 'p0', pair: PAIR }).error,
    ).toBe('too_spicy');
  });

  it('mime never counts toward the budget (room-wide setting, like ghost)', () => {
    const state = lobbyOf(3, { undercoverCount: 1, mrWhiteCount: 0, specialRoles: ['mime'] });
    const result = applyAction(state, { type: 'start', at: 1, playerId: 'p0', pair: PAIR });
    expect(result.error).toBeUndefined();
  });
});
