import { describe, expect, it } from 'vitest';
import { createGame } from './create-game.js';
import { makePlayer, makeSettings } from './test-support.js';

describe('createGame', () => {
  it('builds a lobby-phase state seeded from the given players/settings/seed', () => {
    const settings = makeSettings();
    const players = [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })];
    const state = createGame(settings, players, 'my-seed');

    expect(state.phase).toBe('lobby');
    expect(state.seed).toBe('my-seed');
    expect(state.settings).toBe(settings);
    expect(state.round).toBe(0);
    expect(state.gamesPlayedInRoom).toBe(0);
    expect(state.createdAt).toBe(0); // default `now`
    expect(state.voteHistory).toEqual([]);
    expect(state.lastGuess).toBeNull();
    expect(state.timerExtended).toBe(false);
    expect(state.pendingElimination).toBeNull();
    expect(state.winnerFaction).toBeNull();
  });

  it('assigns the 4th `now` param to createdAt (pure — no clock read)', () => {
    const state = createGame(makeSettings(), [makePlayer({ id: 'a' })], 'seed', 123456);
    expect(state.createdAt).toBe(123456);
  });

  it('defaults mode to pass_play and code to null', () => {
    const state = createGame(makeSettings(), [makePlayer({ id: 'a' })], 'seed');
    expect(state.mode).toBe('pass_play');
    expect(state.code).toBeNull();
  });

  it('seats players by array order and makes the first player host', () => {
    const players = [
      makePlayer({ id: 'a', seat: 99 }),
      makePlayer({ id: 'b', seat: 1 }),
      makePlayer({ id: 'c', seat: 2 }),
    ];
    const state = createGame(makeSettings(), players, 'seed');
    expect(state.players.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(state.hostId).toBe('a');
  });

  it('normalizes per-game player fields regardless of what was passed in', () => {
    const dirty = makePlayer({
      id: 'a',
      hasSeenWord: true,
      alive: false,
      eliminatedRound: 3,
      role: 'undercover',
      word: 'tea',
      specialRole: 'judge',
      usedSpecialPower: true,
      hasLeft: true,
    });
    const state = createGame(makeSettings(), [dirty], 'seed');
    const p = state.players[0];
    expect(p).toMatchObject({
      hasSeenWord: false,
      alive: true,
      eliminatedRound: null,
      role: null,
      word: null,
      specialRole: null,
      usedSpecialPower: false,
      hasLeft: false,
    });
  });

  it('handles an empty player list without throwing (hostId falls back to empty string)', () => {
    const state = createGame(makeSettings(), [], 'seed');
    expect(state.players).toEqual([]);
    expect(state.hostId).toBe('');
  });

  it('is deterministic: same inputs -> deepEqual output', () => {
    const settings = makeSettings();
    const players = [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })];
    const s1 = createGame(settings, players, 'seed', 42);
    const s2 = createGame(settings, players, 'seed', 42);
    expect(s1).toEqual(s2);
  });
});
