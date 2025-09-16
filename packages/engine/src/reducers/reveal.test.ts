import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { makeState } from '../test-support.js';
import type { GameState } from '../types.js';

// p0/p1 civilian, p2 undercover, p3 mrwhite. `reveal` phase with p2 (undercover) just
// eliminated, unless overridden.
function revealState(overrides: Partial<GameState> = {}): GameState {
  const base = makeState({
    phase: 'reveal',
    hostId: 'p0',
    pendingElimination: 'p2',
    phaseEndsAt: 5000,
  });
  const players = base.players.map((p) =>
    p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p,
  );
  return { ...base, players, ...overrides };
}

describe('continueReveal / advancePhase(reveal)', () => {
  it('continueReveal rejects outside reveal (wrong_phase)', () => {
    const state = { ...revealState(), phase: 'discussion' as const };
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: 'p0' });
    expect(result.error).toBe('wrong_phase');
  });

  it('continueReveal rejects a non-host actor (not_host)', () => {
    const state = revealState();
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: 'p1' });
    expect(result.error).toBe('not_host');
  });

  it('a non-Mr.-White elimination resolves straight to the next clue round (no winner yet)', () => {
    const state = revealState(); // p2 undercover eliminated; p3 mrwhite still alive -> no win
    const result = applyAction(state, { type: 'continueReveal', at: 1000, playerId: 'p0' });
    expect(result.state.phase).toBe('clue');
    expect(result.state.round).toBe(2);
    expect(result.state.pendingElimination).toBeNull();
  });

  it('a Mr. White elimination routes to mrwhite_guess with a 30s timer, instead of resolving', () => {
    const base = makeState({ phase: 'reveal', hostId: 'p0', pendingElimination: 'p3' });
    const state = {
      ...base,
      players: base.players.map((p) =>
        p.id === 'p3' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    };
    const result = applyAction(state, { type: 'continueReveal', at: 1000, playerId: 'p0' });
    expect(result.state.phase).toBe('mrwhite_guess');
    expect(result.state.phaseEndsAt).toBe(1000 + 30_000);
    expect(result.effects).toEqual([{ type: 'startTimer', endsAt: 1000 + 30_000 }]);
  });

  it('a Mr. White who already left forfeits the guess window (resolves directly instead)', () => {
    const base = makeState({ phase: 'reveal', hostId: 'p0', pendingElimination: 'p3' });
    const state = {
      ...base,
      players: base.players.map((p) =>
        p.id === 'p3' ? { ...p, alive: false, eliminatedRound: 1, hasLeft: true } : p,
      ),
    };
    const result = applyAction(state, { type: 'continueReveal', at: 1000, playerId: 'p0' });
    expect(result.state.phase).toBe('clue');
  });

  it('advancePhase in the reveal phase behaves identically to continueReveal', () => {
    const state = revealState();
    const viaAdvance = applyAction(state, { type: 'advancePhase', at: 1000, playerId: 'p0' });
    const viaContinue = applyAction(state, { type: 'continueReveal', at: 1000, playerId: 'p0' });
    expect(viaAdvance.state).toEqual(viaContinue.state);
  });

  it('timeout{reveal} resolves the same way', () => {
    const state = revealState();
    const result = applyAction(state, { type: 'timeout', at: 1000, phase: 'reveal' });
    expect(result.state.phase).toBe('clue');
  });

  it('processes deferred departures at this boundary (hasLeft player -> alive:false)', () => {
    const state = revealState();
    const withLeaver = {
      ...state,
      players: state.players.map((p) => (p.id === 'p1' ? { ...p, hasLeft: true } : p)),
    };
    const result = applyAction(withLeaver, { type: 'continueReveal', at: 1000, playerId: 'p0' });
    const p1 = result.state.players.find((p) => p.id === 'p1')!;
    expect(p1.alive).toBe(false);
    expect(p1.eliminatedRound).toBe(1);
  });

  it('ends the game when departures + this elimination produce a winner', () => {
    // p0/p1 civilian, p2 undercover eliminated this round, p3 mrwhite about to depart ->
    // 0 undercover, 0 mrwhite alive -> civilians win.
    const state = revealState();
    const withLeaver = {
      ...state,
      players: state.players.map((p) => (p.id === 'p3' ? { ...p, hasLeft: true } : p)),
    };
    const result = applyAction(withLeaver, { type: 'continueReveal', at: 1000, playerId: 'p0' });
    expect(result.state.phase).toBe('game_over');
    expect(result.state.winnerFaction).toBe('civilian');
    expect(result.effects).toEqual([{ type: 'clearTimer' }, { type: 'persistGame' }]);
  });

  describe('elimination reveal settings (redaction-adjacent but exercised via state directly)', () => {
    it('eliminatedRound and alive flip regardless of eliminationReveal setting', () => {
      const state = revealState({
        settings: { ...revealState().settings, eliminationReveal: 'word_and_role' },
      });
      const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: 'p0' });
      expect(result.state.players.find((p) => p.id === 'p2')!.alive).toBe(false);
    });
  });
});

describe('mrWhiteGuess', () => {
  function guessState(overrides: Partial<GameState> = {}): GameState {
    const base = makeState({
      phase: 'mrwhite_guess',
      hostId: 'p0',
      pendingElimination: 'p3',
      phaseEndsAt: 5000,
      pair: { civilianWord: 'Coffee', undercoverWord: 'Tea', pairId: 'p1' },
    });
    const players = base.players.map((p) =>
      p.id === 'p3' ? { ...p, alive: false, eliminatedRound: 1 } : p,
    );
    return { ...base, players, ...overrides };
  }

  it('rejects outside mrwhite_guess (wrong_phase)', () => {
    const state = { ...guessState(), phase: 'reveal' as const };
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'p3',
      text: 'coffee',
    });
    expect(result.error).toBe('wrong_phase');
  });

  it('rejects anyone other than the just-eliminated Mr. White (validation)', () => {
    const state = guessState();
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'p0',
      text: 'coffee',
    });
    expect(result.error).toBe('validation');
  });

  it('correct guess (exact) -> instant Mr. White win, +6 to the guesser only', () => {
    const state = guessState();
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'p3',
      text: 'Coffee',
    });
    expect(result.state.phase).toBe('game_over');
    expect(result.state.winnerFaction).toBe('mrwhite');
    expect(result.state.lastGuess).toEqual({ playerId: 'p3', text: 'Coffee', correct: true });
    expect(result.state.scoreboard).toEqual({ p3: 6 });
  });

  it('correct guess is case/diacritic-insensitive and trimmed ("Café" ≈ "cafe")', () => {
    const state = guessState({
      pair: { civilianWord: 'Café', undercoverWord: 'Tea', pairId: 'p1' },
    });
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'p3',
      text: '  cafe  ',
    });
    expect(result.state.lastGuess?.correct).toBe(true);
    expect(result.state.winnerFaction).toBe('mrwhite');
  });

  it('wrong guess -> elimination stands, resolves to next round (no winner yet)', () => {
    const state = guessState();
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'p3',
      text: 'lemonade',
    });
    expect(result.state.lastGuess).toEqual({ playerId: 'p3', text: 'lemonade', correct: false });
    expect(result.state.phase).toBe('clue');
    expect(result.state.round).toBe(2);
  });

  it('wrong guess can still end the game via checkWin (e.g. civilians already reduced)', () => {
    // p0 civilian, p1 civilian eliminated earlier this round via departure? Simpler: make
    // p2 (undercover) already eliminated so only p0(civ)/p1(civ) alive besides mrwhite p3.
    const state = guessState({
      players: guessState().players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    // Now alive: p0 civ, p1 civ. Wrong guess -> mrwhite eliminated stands -> 0 uc, 0 mw alive -> civilian win.
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'p3',
      text: 'nope',
    });
    expect(result.state.phase).toBe('game_over');
    expect(result.state.winnerFaction).toBe('civilian');
  });

  it('timeout{mrwhite_guess} is treated as a wrong guess with empty text', () => {
    const state = guessState();
    const result = applyAction(state, { type: 'timeout', at: 1, phase: 'mrwhite_guess' });
    expect(result.state.lastGuess).toEqual({ playerId: 'p3', text: '', correct: false });
    expect(result.state.phase).toBe('clue');
  });
});

describe('rematch', () => {
  // The base fixture's 4-player roster is 2 civilian/1 undercover/1 mrwhite (uc+mw=2), which
  // is exactly ceil(4/2) — already at the "not < half the table" boundary. Rematch tests that
  // drop a seat need role math that stays valid afterward too, so default mrWhiteCount to 0
  // here (uc+mw=1) and let the one test that WANTS an invalid-math rejection override it back.
  function gameOverState(overrides: Partial<GameState> = {}): GameState {
    return makeState({
      phase: 'game_over',
      hostId: 'p0',
      winnerFaction: 'civilian',
      voteHistory: [{ round: 1, revote: false, votes: {}, eliminated: null }],
      lastGuess: { playerId: 'p3', text: 'nope', correct: false },
      gamesPlayedInRoom: 0,
      scoreboard: { p0: 2, p1: 2 },
      settings: { ...makeState().settings, mrWhiteCount: 0 },
      ...overrides,
    });
  }

  it('rejects outside game_over (wrong_phase)', () => {
    const state = { ...gameOverState(), phase: 'lobby' as const };
    const result = applyAction(state, {
      type: 'rematch',
      at: 1,
      playerId: 'p0',
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    });
    expect(result.error).toBe('wrong_phase');
  });

  it('rejects a non-host actor (not_host)', () => {
    const state = gameOverState();
    const result = applyAction(state, {
      type: 'rematch',
      at: 1,
      playerId: 'p1',
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    });
    expect(result.error).toBe('not_host');
  });

  it('drops players who hasLeft and compacts seats', () => {
    const state = gameOverState({
      players: gameOverState().players.map((p) => (p.id === 'p2' ? { ...p, hasLeft: true } : p)),
    });
    const result = applyAction(state, {
      type: 'rematch',
      at: 1000,
      playerId: 'p0',
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    });
    expect(result.state.players.map((p) => p.id)).toEqual(['p0', 'p1', 'p3']);
    expect(result.state.players.map((p) => p.seat)).toEqual([0, 1, 2]);
  });

  it('reassigns host if the host itself had hasLeft (the departed host can still be the dispatching actor)', () => {
    const state = gameOverState({
      players: gameOverState().players.map((p) => (p.id === 'p0' ? { ...p, hasLeft: true } : p)),
    });
    const result = applyAction(state, {
      type: 'rematch',
      at: 1000,
      playerId: 'p0', // hostId still names p0 even though they've hasLeft — isHost() only checks id
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    });
    expect(result.error).toBeUndefined();
    expect(result.state.players.some((p) => p.id === 'p0')).toBe(false);
    expect(result.state.hostId).toBe('p1');
  });

  it('rejects when remaining players would drop below MIN_PLAYERS (validation)', () => {
    const state = gameOverState({
      players: gameOverState().players.map((p) =>
        p.id === 'p2' || p.id === 'p3' ? { ...p, hasLeft: true } : p,
      ),
    });
    const result = applyAction(state, {
      type: 'rematch',
      at: 1,
      playerId: 'p0',
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    });
    expect(result.error).toBe('validation');
  });

  it('rejects when role math no longer fits the remaining count (validation)', () => {
    // Override back to uc=1, mw=1 (total 2). Dropping p3 via hasLeft leaves 3 players
    // (p0,p1,p2) with uc=1+mw=1=2 total, and ceil(3/2)=2 -> 2 < 2 is false.
    const state = gameOverState({
      settings: { ...makeState().settings, undercoverCount: 1, mrWhiteCount: 1 },
      players: gameOverState().players.map((p) => (p.id === 'p3' ? { ...p, hasLeft: true } : p)),
    });
    const result = applyAction(state, {
      type: 'rematch',
      at: 1,
      playerId: 'p0',
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    });
    expect(result.error).toBe('validation');
  });

  it('keeps settings/scoreboard/code/mode/seed/createdAt, increments gamesPlayedInRoom, resets per-game fields, and deals', () => {
    const state = gameOverState();
    const result = applyAction(state, {
      type: 'rematch',
      at: 2000,
      playerId: 'p0',
      pair: { wordA: 'Salt', wordB: 'Pepper', pairId: 'pair-9' },
    });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('dealing');
    expect(result.state.settings).toBe(state.settings);
    expect(result.state.scoreboard).toEqual({ p0: 2, p1: 2 });
    expect(result.state.code).toBe(state.code);
    expect(result.state.mode).toBe(state.mode);
    expect(result.state.seed).toBe(state.seed);
    expect(result.state.createdAt).toBe(state.createdAt);
    expect(result.state.gamesPlayedInRoom).toBe(1);
    expect(result.state.voteHistory).toEqual([]);
    expect(result.state.lastGuess).toBeNull();
    expect(result.state.winnerFaction).toBeNull();
    expect(result.state.phaseEndsAt).toBe(2000 + 45_000);
    expect(result.effects).toEqual([{ type: 'startTimer', endsAt: 2000 + 45_000 }]);
    for (const p of result.state.players) {
      expect(p.alive).toBe(true);
      expect(p.hasSeenWord).toBe(false);
      expect(p.eliminatedRound).toBeNull();
    }
  });
});
