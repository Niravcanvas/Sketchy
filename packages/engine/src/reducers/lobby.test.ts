import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { makePlayer, makeSettings } from '../test-support.js';
import { createGame } from '../create-game.js';
import type { GameSettings, GameState } from '../types.js';

function lobbyWith(
  playerIds: string[],
  settingsOverrides: Parameters<typeof makeSettings>[0] = {},
): GameState {
  const players = playerIds.map((id) => makePlayer({ id, isReady: false }));
  return createGame(makeSettings(settingsOverrides), players, 'seed');
}

describe('join', () => {
  it('adds a player at the next seat', () => {
    const state = lobbyWith(['host']);
    const result = applyAction(state, {
      type: 'join',
      at: 1,
      playerId: 'b',
      player: { id: 'b', name: 'Bea', avatar: makePlayer({ id: 'b' }).avatar },
    });
    expect(result.error).toBeUndefined();
    expect(result.state.players).toHaveLength(2);
    expect(result.state.players[1]).toMatchObject({ id: 'b', name: 'Bea', seat: 1 });
  });

  it('rejects outside the lobby phase (wrong_phase)', () => {
    const state = { ...lobbyWith(['host']), phase: 'clue' as const };
    const result = applyAction(state, {
      type: 'join',
      at: 1,
      playerId: 'b',
      player: { id: 'b', name: 'Bea', avatar: makePlayer({ id: 'b' }).avatar },
    });
    expect(result.error).toBe('wrong_phase');
    expect(result.state).toBe(state);
  });

  it('rejects when the room is full (room_full)', () => {
    const state = lobbyWith(['a', 'b'], { maxPlayers: 2 });
    const result = applyAction(state, {
      type: 'join',
      at: 1,
      playerId: 'c',
      player: { id: 'c', name: 'Cee', avatar: makePlayer({ id: 'c' }).avatar },
    });
    expect(result.error).toBe('room_full');
    expect(result.state).toBe(state);
  });

  it('rejects a case-insensitive-after-trim name collision (name_taken_in_room)', () => {
    const state = lobbyWith(['a']);
    const named = { ...state, players: [{ ...state.players[0]!, name: 'Ada' }] };
    const result = applyAction(named, {
      type: 'join',
      at: 1,
      playerId: 'b',
      player: { id: 'b', name: '  ADA  ', avatar: makePlayer({ id: 'b' }).avatar },
    });
    expect(result.error).toBe('name_taken_in_room');
    expect(result.state).toBe(named);
  });

  it('allows a non-colliding name', () => {
    const state = lobbyWith(['a']);
    const named = { ...state, players: [{ ...state.players[0]!, name: 'Ada' }] };
    const result = applyAction(named, {
      type: 'join',
      at: 1,
      playerId: 'b',
      player: { id: 'b', name: 'Bea', avatar: makePlayer({ id: 'b' }).avatar },
    });
    expect(result.error).toBeUndefined();
  });
});

describe('leave', () => {
  it('in lobby: removes the seat and compacts remaining seats', () => {
    const state = lobbyWith(['a', 'b', 'c']);
    const result = applyAction(state, { type: 'leave', at: 1, playerId: 'b' });
    expect(result.error).toBeUndefined();
    expect(result.state.players.map((p) => p.id)).toEqual(['a', 'c']);
    expect(result.state.players.map((p) => p.seat)).toEqual([0, 1]);
  });

  it('in lobby: hands off host to the first remaining player when the host leaves', () => {
    const state = lobbyWith(['a', 'b', 'c']);
    expect(state.hostId).toBe('a');
    const result = applyAction(state, { type: 'leave', at: 1, playerId: 'a' });
    expect(result.state.hostId).toBe('b');
  });

  it('in lobby: leaves an empty room (and hostId "") when the last player leaves', () => {
    const state = lobbyWith(['a']);
    const result = applyAction(state, { type: 'leave', at: 1, playerId: 'a' });
    expect(result.state.players).toEqual([]);
    expect(result.state.hostId).toBe('');
  });

  it('in lobby: leaving does NOT reassign host when a non-host leaves', () => {
    const state = lobbyWith(['a', 'b']);
    const result = applyAction(state, { type: 'leave', at: 1, playerId: 'b' });
    expect(result.state.hostId).toBe('a');
  });

  it('mid-game: sets hasLeft + connected:false instead of removing the seat', () => {
    const state = { ...lobbyWith(['a', 'b']), phase: 'clue' as const };
    const result = applyAction(state, { type: 'leave', at: 1, playerId: 'b' });
    expect(result.state.players).toHaveLength(2);
    const b = result.state.players.find((p) => p.id === 'b')!;
    expect(b.hasLeft).toBe(true);
    expect(b.connected).toBe(false);
  });

  it('rejects an unknown player id (validation)', () => {
    const state = lobbyWith(['a']);
    const result = applyAction(state, { type: 'leave', at: 1, playerId: 'ghost' });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });
});

describe('setReady', () => {
  it('toggles the actor readiness', () => {
    const state = lobbyWith(['a']);
    const result = applyAction(state, { type: 'setReady', at: 1, playerId: 'a', ready: true });
    expect(result.state.players[0]!.isReady).toBe(true);
  });

  it('only touches the acting player, leaving other seats untouched', () => {
    const state = lobbyWith(['a', 'b']);
    const result = applyAction(state, { type: 'setReady', at: 1, playerId: 'a', ready: true });
    expect(result.state.players.find((p) => p.id === 'a')!.isReady).toBe(true);
    expect(result.state.players.find((p) => p.id === 'b')!.isReady).toBe(false);
  });

  it('rejects outside lobby (wrong_phase)', () => {
    const state = { ...lobbyWith(['a']), phase: 'clue' as const };
    const result = applyAction(state, { type: 'setReady', at: 1, playerId: 'a', ready: true });
    expect(result.error).toBe('wrong_phase');
    expect(result.state).toBe(state);
  });

  it('rejects an unknown player id (validation)', () => {
    const state = lobbyWith(['a']);
    const result = applyAction(state, { type: 'setReady', at: 1, playerId: 'ghost', ready: true });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });
});

describe('updateSettings', () => {
  it('merges a valid patch onto settings', () => {
    const state = lobbyWith(['a', 'b', 'c']);
    const result = applyAction(state, {
      type: 'updateSettings',
      at: 1,
      playerId: 'a',
      patch: { clueTimerSec: null },
    });
    expect(result.error).toBeUndefined();
    expect(result.state.settings.clueTimerSec).toBeNull();
  });

  it('rejects outside lobby (wrong_phase)', () => {
    const state = { ...lobbyWith(['a']), phase: 'clue' as const };
    const result = applyAction(state, { type: 'updateSettings', at: 1, playerId: 'a', patch: {} });
    expect(result.error).toBe('wrong_phase');
  });

  it('rejects a non-host actor (not_host)', () => {
    const state = lobbyWith(['a', 'b']);
    const result = applyAction(state, { type: 'updateSettings', at: 1, playerId: 'b', patch: {} });
    expect(result.error).toBe('not_host');
    expect(result.state).toBe(state);
  });

  describe('validation bounds (each rejects, state unchanged)', () => {
    const state = lobbyWith(['a', 'b', 'c']);

    const invalidPatches: Array<[string, Partial<GameSettings>]> = [
      ['maxPlayers below MIN_PLAYERS', { maxPlayers: 2 }],
      ['maxPlayers above HARD_MAX_PLAYERS', { maxPlayers: 21 }],
      ['negative undercoverCount', { undercoverCount: -1 }],
      ['negative mrWhiteCount', { mrWhiteCount: -1 }],
      ['zero-or-negative clueTimerSec', { clueTimerSec: 0 }],
      ['zero-or-negative discussionTimerSec', { discussionTimerSec: -5 }],
      ['zero-or-negative voteTimerSec', { voteTimerSec: 0 }],
      ['empty difficulties', { difficulties: [] }],
      ['role total below 1', { undercoverCount: 0, mrWhiteCount: 0 }],
      [
        'role total not < ceil(maxPlayers/2)',
        { maxPlayers: 3, undercoverCount: 2, mrWhiteCount: 0 },
      ],
    ];

    it.each(invalidPatches)('%s', (_name, patch) => {
      const result = applyAction(state, { type: 'updateSettings', at: 1, playerId: 'a', patch });
      expect(result.error).toBe('validation');
      expect(result.state).toBe(state);
    });

    it('maxPlayers below the current seated count is rejected specifically', () => {
      const four = lobbyWith(['a', 'b', 'c', 'd']);
      const result = applyAction(four, {
        type: 'updateSettings',
        at: 1,
        playerId: 'a',
        patch: { maxPlayers: 3 },
      });
      expect(result.error).toBe('validation');
    });
  });
});

describe('kick', () => {
  it('removes the target and compacts seats', () => {
    const state = lobbyWith(['a', 'b', 'c']);
    const result = applyAction(state, { type: 'kick', at: 1, playerId: 'a', targetId: 'b' });
    expect(result.state.players.map((p) => p.id)).toEqual(['a', 'c']);
    expect(result.state.players.map((p) => p.seat)).toEqual([0, 1]);
  });

  it('rejects outside lobby (wrong_phase)', () => {
    const state = { ...lobbyWith(['a', 'b']), phase: 'clue' as const };
    const result = applyAction(state, { type: 'kick', at: 1, playerId: 'a', targetId: 'b' });
    expect(result.error).toBe('wrong_phase');
  });

  it('rejects a non-host actor (not_host)', () => {
    const state = lobbyWith(['a', 'b', 'c']);
    const result = applyAction(state, { type: 'kick', at: 1, playerId: 'b', targetId: 'c' });
    expect(result.error).toBe('not_host');
  });

  it('rejects kicking self (validation)', () => {
    const state = lobbyWith(['a', 'b']);
    const result = applyAction(state, { type: 'kick', at: 1, playerId: 'a', targetId: 'a' });
    expect(result.error).toBe('validation');
  });

  it('rejects an unknown target (validation)', () => {
    const state = lobbyWith(['a', 'b']);
    const result = applyAction(state, { type: 'kick', at: 1, playerId: 'a', targetId: 'ghost' });
    expect(result.error).toBe('validation');
  });
});
