import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { makePlayer, makeSettings, makeState } from '../test-support.js';
import type { GamePlayer, GameState } from '../types.js';

/** Builds a `reveal`-phase state with `pendingElimination` already applied (alive:false,
 * eliminatedRound set) — i.e. exactly the shape `continueReveal` expects to resolve. */
function revealStateFor(
  players: GamePlayer[],
  pendingElimination: string,
  overrides: Partial<GameState> = {},
) {
  return makeState({
    phase: 'reveal',
    hostId: players[0]!.id,
    players,
    pendingElimination,
    ...overrides,
  });
}

describe('scoring — every win type', () => {
  it('civilian win: +2 to every Civilian, alive OR eliminated; nothing to other roles', () => {
    const players = [
      makePlayer({ id: 'c-alive', seat: 0, role: 'civilian', alive: true }),
      makePlayer({
        id: 'c-eliminated',
        seat: 1,
        role: 'civilian',
        alive: false,
        eliminatedRound: 1,
      }),
      makePlayer({
        id: 'uc-just-eliminated',
        seat: 2,
        role: 'undercover',
        alive: false,
        eliminatedRound: 2,
      }),
    ];
    const state = revealStateFor(players, 'uc-just-eliminated', { round: 2 });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: players[0]!.id });
    expect(result.state.winnerFaction).toBe('civilian');
    expect(result.state.scoreboard).toEqual({ 'c-alive': 2, 'c-eliminated': 2 });
  });

  it('undercover win: +10 to each ALIVE Undercover only (eliminated ones get nothing)', () => {
    const players = [
      makePlayer({ id: 'civ-alive', seat: 0, role: 'civilian', alive: true }),
      makePlayer({
        id: 'civ-just-eliminated',
        seat: 1,
        role: 'civilian',
        alive: false,
        eliminatedRound: 2,
      }),
      makePlayer({ id: 'uc-alive-1', seat: 2, role: 'undercover', alive: true }),
      makePlayer({ id: 'uc-alive-2', seat: 3, role: 'undercover', alive: true }),
      makePlayer({
        id: 'uc-eliminated',
        seat: 4,
        role: 'undercover',
        alive: false,
        eliminatedRound: 1,
      }),
    ];
    const state = revealStateFor(players, 'civ-just-eliminated', { round: 2 });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: players[0]!.id });
    expect(result.state.winnerFaction).toBe('undercover');
    expect(result.state.scoreboard).toEqual({ 'uc-alive-1': 10, 'uc-alive-2': 10 });
  });

  it('mrwhite survive-win: +6 to each ALIVE Mr. White only', () => {
    const players = [
      makePlayer({ id: 'civ-alive', seat: 0, role: 'civilian', alive: true }),
      makePlayer({
        id: 'civ-just-eliminated',
        seat: 1,
        role: 'civilian',
        alive: false,
        eliminatedRound: 2,
      }),
      makePlayer({ id: 'mw-alive-1', seat: 2, role: 'mrwhite', alive: true }),
      makePlayer({ id: 'mw-alive-2', seat: 3, role: 'mrwhite', alive: true }),
      makePlayer({
        id: 'mw-eliminated',
        seat: 4,
        role: 'mrwhite',
        alive: false,
        eliminatedRound: 1,
      }),
    ];
    const state = revealStateFor(players, 'civ-just-eliminated', {
      round: 2,
      settings: makeSettings({ undercoverCount: 0, mrWhiteCount: 3 }),
    });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: players[0]!.id });
    expect(result.state.winnerFaction).toBe('mrwhite');
    expect(result.state.scoreboard).toEqual({ 'mw-alive-1': 6, 'mw-alive-2': 6 });
  });

  it('infiltrators joint win: +10 each alive Undercover AND +6 each alive Mr. White', () => {
    const players = [
      makePlayer({ id: 'civ-alive', seat: 0, role: 'civilian', alive: true }),
      makePlayer({
        id: 'civ-just-eliminated',
        seat: 1,
        role: 'civilian',
        alive: false,
        eliminatedRound: 2,
      }),
      makePlayer({ id: 'uc-alive', seat: 2, role: 'undercover', alive: true }),
      makePlayer({ id: 'mw-alive', seat: 3, role: 'mrwhite', alive: true }),
    ];
    const state = revealStateFor(players, 'civ-just-eliminated', { round: 2 });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: players[0]!.id });
    expect(result.state.winnerFaction).toBe('infiltrators');
    expect(result.state.scoreboard).toEqual({ 'uc-alive': 10, 'mw-alive': 6 });
  });

  it('mrwhite steal (correct guess): +6 to the guesser only, even though they are eliminated', () => {
    const players = [
      makePlayer({ id: 'civ-1', seat: 0, role: 'civilian', alive: true }),
      makePlayer({ id: 'civ-2', seat: 1, role: 'civilian', alive: true }),
      makePlayer({ id: 'mw-guesser', seat: 2, role: 'mrwhite', alive: false, eliminatedRound: 1 }),
    ];
    const state = makeState({
      phase: 'mrwhite_guess',
      hostId: 'civ-1',
      players,
      pendingElimination: 'mw-guesser',
      pair: { civilianWord: 'Coffee', undercoverWord: 'Tea', pairId: null },
    });
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'mw-guesser',
      text: 'coffee',
    });
    expect(result.state.winnerFaction).toBe('mrwhite');
    expect(result.state.scoreboard).toEqual({ 'mw-guesser': 6 });
  });
});

describe('scoring accumulates rather than overwrites', () => {
  it('adds onto a non-empty existing scoreboard', () => {
    const players = [
      makePlayer({ id: 'c-alive', seat: 0, role: 'civilian', alive: true }),
      makePlayer({
        id: 'uc-just-eliminated',
        seat: 1,
        role: 'undercover',
        alive: false,
        eliminatedRound: 2,
      }),
    ];
    const state = revealStateFor(players, 'uc-just-eliminated', {
      round: 2,
      scoreboard: { 'c-alive': 5, someone_else: 3 },
    });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: players[0]!.id });
    expect(result.state.scoreboard).toEqual({ 'c-alive': 7, someone_else: 3 });
  });

  it("accumulates across a rematch: prior game score carries and adds with the next game's", () => {
    // Game 1: civilian win, scored via continueReveal.
    const game1Players = [
      makePlayer({ id: 'p0', seat: 0, role: 'civilian', alive: true }),
      makePlayer({ id: 'p1', seat: 1, role: 'civilian', alive: true }),
      makePlayer({ id: 'p2', seat: 2, role: 'undercover', alive: false, eliminatedRound: 1 }),
    ];
    // mrWhiteCount: 0 keeps role math valid for the 3-player rematch below (uc=1, mw=0 ->
    // total 1 < ceil(3/2)=2), independent of scoring itself.
    const gameOver1 = applyAction(
      revealStateFor(game1Players, 'p2', { round: 1, settings: makeSettings({ mrWhiteCount: 0 }) }),
      { type: 'continueReveal', at: 1, playerId: 'p0' },
    ).state;
    expect(gameOver1.scoreboard).toEqual({ p0: 2, p1: 2 });

    // Rematch: scoreboard carries into the new `dealing` state untouched.
    const rematchResult = applyAction(gameOver1, {
      type: 'rematch',
      at: 1000,
      playerId: gameOver1.hostId,
      pair: { wordA: 'Salt', wordB: 'Pepper', pairId: null },
    });
    expect(rematchResult.error).toBeUndefined();
    const rematched = rematchResult.state;
    expect(rematched.phase).toBe('dealing');
    expect(rematched.scoreboard).toEqual({ p0: 2, p1: 2 });

    // Game 2: force a mrwhite survive-win by directly shaping a `reveal` state from the
    // rematch's seats (role assignment specifics don't matter for a scoring test).
    const game2Players = rematched.players.map((p, i) =>
      i === 0
        ? { ...p, role: 'civilian' as const, alive: true }
        : i === 1
          ? { ...p, role: 'civilian' as const, alive: false, eliminatedRound: 1 }
          : { ...p, role: 'mrwhite' as const, alive: true },
    );
    const gameOver2 = applyAction(
      {
        ...rematched,
        phase: 'reveal',
        players: game2Players,
        pendingElimination: game2Players[1]!.id,
        round: 1,
      },
      { type: 'continueReveal', at: 2000, playerId: rematched.hostId },
    ).state;

    expect(gameOver2.winnerFaction).toBe('mrwhite');
    expect(gameOver2.scoreboard).toEqual({ p0: 2, p1: 2, [game2Players[2]!.id]: 6 });
  });
});

// --- Rivals scoring (game-end only, applied on top of the normal win payout) ---

describe('Rivals scoring (phase 13)', () => {
  it('natural win: first eliminated loses 2, the survivor gains 2, on top of the normal win payout', () => {
    const players = [
      makePlayer({ id: 'civ-1', seat: 0, role: 'civilian', alive: true }),
      makePlayer({
        id: 'rival-eliminated',
        seat: 1,
        role: 'civilian',
        alive: false,
        eliminatedRound: 1,
        specialRole: 'rivals',
      }),
      makePlayer({
        id: 'uc-just-eliminated',
        seat: 2,
        role: 'undercover',
        alive: false,
        eliminatedRound: 2,
      }),
      makePlayer({ id: 'rival-survivor', seat: 3, role: 'civilian', alive: true, specialRole: 'rivals' }),
    ];
    const state = revealStateFor(players, 'uc-just-eliminated', { round: 2 });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: players[0]!.id });
    expect(result.state.winnerFaction).toBe('civilian');
    // Normal civilian payout (+2 each civilian) PLUS the Rivals swing (-2 / +2).
    expect(result.state.scoreboard).toEqual({
      'civ-1': 2,
      'rival-eliminated': 0, // +2 (civilian win) - 2 (Rivals first-out) = 0
      'rival-survivor': 4, // +2 (civilian win) + 2 (Rivals survivor) = 4
    });
  });

  it('mrwhite steal: Rivals scoring still applies even though the game ended via a guess, not checkWin', () => {
    const players = [
      makePlayer({ id: 'civ-1', seat: 0, role: 'civilian', alive: true }),
      makePlayer({ id: 'civ-2', seat: 1, role: 'civilian', alive: true }),
      makePlayer({
        id: 'rival-a',
        seat: 2,
        role: 'civilian',
        alive: false,
        eliminatedRound: 1,
        specialRole: 'rivals',
      }),
      makePlayer({
        id: 'mw-guesser',
        seat: 3,
        role: 'mrwhite',
        alive: false,
        eliminatedRound: 2,
        specialRole: 'rivals',
      }),
    ];
    const state = makeState({
      phase: 'mrwhite_guess',
      hostId: 'civ-1',
      players,
      pendingElimination: 'mw-guesser',
      pair: { civilianWord: 'Coffee', undercoverWord: 'Tea', pairId: null },
    });
    const result = applyAction(state, {
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'mw-guesser',
      text: 'coffee',
    });
    expect(result.state.winnerFaction).toBe('mrwhite');
    // +6 (the steal) + 2 (Rivals survivor — eliminatedRound 2 > rival-a's round 1).
    expect(result.state.scoreboard).toEqual({ 'mw-guesser': 8, 'rival-a': -2 });
  });

  it('both Rivals survive to game end -> NO points either way', () => {
    const players = [
      makePlayer({ id: 'rival-a', seat: 0, role: 'civilian', alive: true, specialRole: 'rivals' }),
      makePlayer({ id: 'rival-b', seat: 1, role: 'civilian', alive: true, specialRole: 'rivals' }),
      makePlayer({
        id: 'uc-just-eliminated',
        seat: 2,
        role: 'undercover',
        alive: false,
        eliminatedRound: 1,
      }),
    ];
    const state = revealStateFor(players, 'uc-just-eliminated', { round: 1 });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: players[0]!.id });
    expect(result.state.winnerFaction).toBe('civilian');
    // Only the ordinary +2 civilian payout — no Rivals swing for either of them.
    expect(result.state.scoreboard).toEqual({ 'rival-a': 2, 'rival-b': 2 });
  });

  it('both Rivals eliminated in the SAME round -> NO points either way (documented tiebreak)', () => {
    const players = [
      makePlayer({
        id: 'rival-a',
        seat: 0,
        role: 'civilian',
        alive: false,
        eliminatedRound: 1,
        specialRole: 'rivals',
      }),
      makePlayer({
        id: 'rival-b',
        seat: 1,
        role: 'civilian',
        alive: false,
        eliminatedRound: 1, // SAME round as rival-a — e.g. a Lovebirds/Grudge cascade
        specialRole: 'rivals',
      }),
      makePlayer({
        id: 'uc-just-eliminated',
        seat: 2,
        role: 'undercover',
        alive: false,
        eliminatedRound: 2,
      }),
      makePlayer({ id: 'civ-alive', seat: 3, role: 'civilian', alive: true }),
    ];
    // hostId defaults to players[0]!.id ('rival-a') via revealStateFor/makeState — host
    // authority is independent of `alive` (same invariant `applyContinueReveal` relies on
    // for judge_decision/grudge_decision's own eliminated-host escape hatches).
    const state = revealStateFor(players, 'uc-just-eliminated', { round: 2 });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: 'rival-a' });
    expect(result.state.winnerFaction).toBe('civilian');
    // Ordinary +2 civilian payout for all three civilians; no Rivals swing for either.
    expect(result.state.scoreboard).toEqual({ 'rival-a': 2, 'rival-b': 2, 'civ-alive': 2 });
  });

  it('is a no-op when rivals is not enabled (fewer than 2 holders)', () => {
    const players = [
      makePlayer({ id: 'civ-alive', seat: 0, role: 'civilian', alive: true }),
      makePlayer({
        id: 'uc-just-eliminated',
        seat: 1,
        role: 'undercover',
        alive: false,
        eliminatedRound: 1,
      }),
    ];
    const state = revealStateFor(players, 'uc-just-eliminated', { round: 1 });
    const result = applyAction(state, { type: 'continueReveal', at: 1, playerId: 'civ-alive' });
    expect(result.state.scoreboard).toEqual({ 'civ-alive': 2 });
  });
});
