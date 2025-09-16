import { describe, expect, it } from 'vitest';
import { applyAction } from './apply-action.js';
import { makeState } from './test-support.js';

describe('extendTimer', () => {
  it('host-only, adds TIMER_EXTEND_MS to phaseEndsAt and marks timerExtended', () => {
    const state = makeState({
      phase: 'discussion',
      hostId: 'p0',
      phaseEndsAt: 1000,
      timerExtended: false,
    });
    const result = applyAction(state, { type: 'extendTimer', at: 1, playerId: 'p0' });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseEndsAt).toBe(1000 + 60_000);
    expect(result.state.timerExtended).toBe(true);
    expect(result.effects).toEqual([{ type: 'startTimer', endsAt: 1000 + 60_000 }]);
  });
});

describe('presence', () => {
  it('sets connected on the named player without touching alive/turn state', () => {
    const state = makeState({ phase: 'clue' });
    const result = applyAction(state, {
      type: 'presence',
      at: 1,
      playerId: 'p1',
      connected: false,
    });
    expect(result.error).toBeUndefined();
    const p1 = result.state.players.find((p) => p.id === 'p1')!;
    expect(p1.connected).toBe(false);
    expect(result.state.phase).toBe('clue');
    expect(result.state.turnSeat).toBe(state.turnSeat);
  });

  it('leaves every other player untouched', () => {
    const state = makeState({ phase: 'clue' });
    const result = applyAction(state, {
      type: 'presence',
      at: 1,
      playerId: 'p1',
      connected: false,
    });
    const p0 = result.state.players.find((p) => p.id === 'p0')!;
    expect(p0.connected).toBe(true);
  });
});

describe('migrateHost', () => {
  it('reassigns hostId to a seated player without an actor check (server-decided)', () => {
    const state = makeState({ phase: 'clue', hostId: 'p0' });
    const result = applyAction(state, { type: 'migrateHost', at: 1, newHostId: 'p2' });
    expect(result.error).toBeUndefined();
    expect(result.state.hostId).toBe('p2');
    expect(result.effects).toEqual([]);
  });

  it('migrates to an eliminated player too — being host is independent of being alive', () => {
    const players = makeState().players.map((p) =>
      p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p,
    );
    const state = makeState({ phase: 'voting', hostId: 'p0', players });
    const result = applyAction(state, { type: 'migrateHost', at: 1, newHostId: 'p2' });
    expect(result.error).toBeUndefined();
    expect(result.state.hostId).toBe('p2');
  });

  it('rejects an unknown target with validation, leaving hostId untouched', () => {
    const state = makeState({ phase: 'clue', hostId: 'p0' });
    const result = applyAction(state, { type: 'migrateHost', at: 1, newHostId: 'ghost' });
    expect(result.error).toBe('validation');
    expect(result.state.hostId).toBe('p0');
  });

  it('is a harmless no-op when the target is already the host', () => {
    const state = makeState({ phase: 'clue', hostId: 'p0' });
    const result = applyAction(state, { type: 'migrateHost', at: 1, newHostId: 'p0' });
    expect(result.error).toBeUndefined();
    expect(result.state.hostId).toBe('p0');
    expect(result.state).toBe(state);
  });

  it('touches neither alive nor turn state', () => {
    const state = makeState({ phase: 'clue', hostId: 'p0', turnSeat: 2 });
    const result = applyAction(state, { type: 'migrateHost', at: 1, newHostId: 'p1' });
    expect(result.state.turnSeat).toBe(2);
    expect(result.state.players.every((p, i) => p.alive === state.players[i]!.alive)).toBe(true);
  });
});
