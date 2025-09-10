import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import type { GameAction } from '../actions.js';
import { makeState } from '../test-support.js';
import type { GameState, Phase } from '../types.js';

const ALL_PHASES: Phase[] = [
  'lobby',
  'dealing',
  'clue',
  'discussion',
  'voting',
  'tiebreak_clue',
  'judge_decision',
  'grudge_decision',
  'reveal',
  'mrwhite_guess',
  'game_over',
];

/** A self-consistent state for a given phase — every reducer checks `phase` before
 * touching phase-specific fields (turnSeat/pendingElimination/tiedPlayerIds), so this
 * generic shape is safe to dispatch ANY action type against for the "wrong phase" matrix. */
function stateInPhase(phase: Phase): GameState {
  return makeState({
    phase,
    hostId: 'p0',
    turnSeat: phase === 'clue' || phase === 'tiebreak_clue' ? 0 : null,
    tiedPlayerIds: phase === 'tiebreak_clue' || phase === 'judge_decision' ? ['p1', 'p3'] : null,
    // grudge_decision: pendingElimination is the just-revealed Grudge, same
    // invariant shape as reveal/mrwhite_guess.
    pendingElimination:
      phase === 'reveal' || phase === 'mrwhite_guess' || phase === 'grudge_decision' ? 'p2' : null,
  });
}

/** One row of the matrix: an action's valid phase(s) and a builder for the action itself. */
interface ActionSpec {
  type: string;
  validPhases: Phase[];
  build: () => GameAction;
}

const specs: ActionSpec[] = [
  {
    type: 'join',
    validPhases: ['lobby'],
    build: () => ({
      type: 'join',
      at: 1,
      playerId: 'new',
      player: { id: 'new', name: 'New', avatar: makeState().players[0]!.avatar },
    }),
  },
  {
    type: 'setReady',
    validPhases: ['lobby'],
    build: () => ({ type: 'setReady', at: 1, playerId: 'p0', ready: true }),
  },
  {
    type: 'updateSettings',
    validPhases: ['lobby'],
    build: () => ({ type: 'updateSettings', at: 1, playerId: 'p0', patch: {} }),
  },
  {
    type: 'kick',
    validPhases: ['lobby'],
    build: () => ({ type: 'kick', at: 1, playerId: 'p0', targetId: 'p1' }),
  },
  {
    type: 'start',
    validPhases: ['lobby'],
    build: () => ({
      type: 'start',
      at: 1,
      playerId: 'p0',
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    }),
  },
  {
    type: 'ackWord',
    validPhases: ['dealing'],
    build: () => ({ type: 'ackWord', at: 1, playerId: 'p0' }),
  },
  {
    type: 'submitClue',
    validPhases: ['clue', 'tiebreak_clue'],
    build: () => ({
      type: 'submitClue',
      at: 1,
      playerId: 'p0',
      text: 'hint',
    }),
  },
  {
    type: 'skipTurn',
    validPhases: ['clue', 'tiebreak_clue'],
    build: () => ({ type: 'skipTurn', at: 1, playerId: 'p0' }),
  },
  {
    type: 'advancePhase',
    // judge_decision / grudge_decision (same shape): the host's early advancePhase falls
    // through to the respective deterministic default (reducers/vote.ts
    // resolveJudgeDecisionByDefault / reducers/cascade.ts
    // resolveGrudgeDecisionByDefault) — same host escape hatch shape as discussion/reveal.
    validPhases: ['discussion', 'reveal', 'judge_decision', 'grudge_decision'],
    build: () => ({ type: 'advancePhase', at: 1, playerId: 'p0' }),
  },
  {
    type: 'continueReveal',
    validPhases: ['reveal'],
    build: () => ({ type: 'continueReveal', at: 1, playerId: 'p0' }),
  },
  {
    type: 'castVote',
    validPhases: ['voting'],
    build: () => ({ type: 'castVote', at: 1, playerId: 'p0', targetId: 'p1' }),
  },
  {
    type: 'mrWhiteGuess',
    validPhases: ['mrwhite_guess'],
    build: () => ({
      type: 'mrWhiteGuess',
      at: 1,
      playerId: 'p2',
      text: 'guess',
    }),
  },
  {
    type: 'rematch',
    validPhases: ['game_over'],
    build: () => ({
      type: 'rematch',
      at: 1,
      playerId: 'p0',
      pair: { wordA: 'A', wordB: 'B', pairId: null },
    }),
  },
  {
    // p0 doesn't hold `specialRole: 'judge'` in the generic `stateInPhase` fixture, so this
    // entry only proves the PHASE gate (every non-`judge_decision` phase -> `wrong_phase`);
    // the actor/target-specific validation gets its own tests below.
    type: 'judgeDecide',
    validPhases: ['judge_decision'],
    build: () => ({ type: 'judgeDecide', at: 1, playerId: 'p0', targetId: 'p1' }),
  },
  {
    // Same shape as judgeDecide above: p2 (pendingElimination in the generic fixture)
    // doesn't hold `specialRole: 'grudge'` here, so this entry only proves the PHASE gate;
    // the actor/target-specific validation gets its own tests below.
    type: 'grudgeDrag',
    validPhases: ['grudge_decision'],
    build: () => ({ type: 'grudgeDrag', at: 1, playerId: 'p2', targetId: 'p1' }),
  },
];

describe('action-rejection matrix: wrong phase -> wrong_phase, state unchanged', () => {
  for (const spec of specs) {
    const wrongPhases = ALL_PHASES.filter((p) => !spec.validPhases.includes(p));
    for (const phase of wrongPhases) {
      it(`${spec.type} in ${phase} (valid: ${spec.validPhases.join('/')}) -> wrong_phase`, () => {
        const state = stateInPhase(phase);
        const result = applyAction(state, spec.build());
        expect(result.error).toBe('wrong_phase');
        expect(result.state).toBe(state);
        expect(result.effects).toEqual([]);
      });
    }
  }
});

describe('action-rejection matrix: wrong actor', () => {
  it('submitClue by someone other than the turn-holder -> not_your_turn', () => {
    const state = stateInPhase('clue'); // turnSeat 0 -> p0 (seat order) is the turn-holder
    const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p1', text: 'x' });
    expect(result.error).toBe('not_your_turn');
    expect(result.state).toBe(state);
  });

  it.each([
    [
      'updateSettings',
      () => ({ type: 'updateSettings' as const, at: 1, playerId: 'p1', patch: {} }),
      'lobby' as Phase,
    ],
    [
      'kick',
      () => ({ type: 'kick' as const, at: 1, playerId: 'p1', targetId: 'p0' }),
      'lobby' as Phase,
    ],
    [
      'start',
      () => ({
        type: 'start' as const,
        at: 1,
        playerId: 'p1',
        pair: { wordA: 'A', wordB: 'B', pairId: null },
      }),
      'lobby' as Phase,
    ],
    ['skipTurn', () => ({ type: 'skipTurn' as const, at: 1, playerId: 'p1' }), 'clue' as Phase],
    [
      'advancePhase',
      () => ({ type: 'advancePhase' as const, at: 1, playerId: 'p1' }),
      'discussion' as Phase,
    ],
    [
      'advancePhase (judge_decision)',
      () => ({ type: 'advancePhase' as const, at: 1, playerId: 'p1' }),
      'judge_decision' as Phase,
    ],
    [
      'continueReveal',
      () => ({ type: 'continueReveal' as const, at: 1, playerId: 'p1' }),
      'reveal' as Phase,
    ],
    [
      'rematch',
      () => ({
        type: 'rematch' as const,
        at: 1,
        playerId: 'p1',
        pair: { wordA: 'A', wordB: 'B', pairId: null },
      }),
      'game_over' as Phase,
    ],
    [
      'extendTimer',
      () => ({ type: 'extendTimer' as const, at: 1, playerId: 'p1' }),
      'discussion' as Phase,
    ],
  ])('%s by a non-host -> not_host', (_name, build, phase) => {
    const state = { ...stateInPhase(phase), phaseEndsAt: 500 };
    const result = applyAction(state, build());
    expect(result.error).toBe('not_host');
    expect(result.state).toBe(state);
  });

  it('mrWhiteGuess by anyone other than pendingElimination -> validation', () => {
    const state = stateInPhase('mrwhite_guess');
    const result = applyAction(state, { type: 'mrWhiteGuess', at: 1, playerId: 'p0', text: 'x' });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });
});

describe('action-rejection matrix: unknown player id -> validation', () => {
  it.each([
    ['leave', () => ({ type: 'leave' as const, at: 1, playerId: 'ghost' }), 'lobby' as Phase],
    [
      'setReady',
      () => ({ type: 'setReady' as const, at: 1, playerId: 'ghost', ready: true }),
      'lobby' as Phase,
    ],
    ['ackWord', () => ({ type: 'ackWord' as const, at: 1, playerId: 'ghost' }), 'dealing' as Phase],
    [
      'castVote (voter)',
      () => ({ type: 'castVote' as const, at: 1, playerId: 'ghost', targetId: 'p0' }),
      'voting' as Phase,
    ],
    [
      'castVote (target)',
      () => ({ type: 'castVote' as const, at: 1, playerId: 'p0', targetId: 'ghost' }),
      'voting' as Phase,
    ],
    [
      'kick (target)',
      () => ({ type: 'kick' as const, at: 1, playerId: 'p0', targetId: 'ghost' }),
      'lobby' as Phase,
    ],
    [
      'presence',
      () => ({ type: 'presence' as const, at: 1, playerId: 'ghost', connected: false }),
      'lobby' as Phase,
    ],
  ])('%s -> validation', (_name, build, phase) => {
    const state = stateInPhase(phase);
    const result = applyAction(state, build());
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });
});

describe('action-rejection matrix: judgeDecide actor/target validation (phase 12)', () => {
  it('rejects an actor who does not hold specialRole judge (validation)', () => {
    const state = stateInPhase('judge_decision'); // p0..p3, nobody holds Judge
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p0',
      targetId: 'p1',
    });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
    expect(result.effects).toEqual([]);
  });

  it('rejects a target outside tiedPlayerIds, even from the real Judge (validation)', () => {
    const base = stateInPhase('judge_decision');
    const state = {
      ...base,
      players: base.players.map((p) => (p.id === 'p0' ? { ...p, specialRole: 'judge' as const } : p)),
    };
    const result = applyAction(state, {
      type: 'judgeDecide',
      at: 1,
      playerId: 'p0',
      targetId: 'p2', // tiedPlayerIds is ['p1', 'p3'] in this fixture
    });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });
});

describe('action-rejection matrix: grudgeDrag actor/target validation (phase 13)', () => {
  it('rejects an actor who does not hold specialRole grudge (validation)', () => {
    const state = stateInPhase('grudge_decision'); // pendingElimination is p2, nobody holds Grudge
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 1,
      playerId: 'p2',
      targetId: 'p1',
    });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
    expect(result.effects).toEqual([]);
  });

  it('rejects an actor who holds grudge but is NOT the just-revealed pendingElimination (validation)', () => {
    const base = stateInPhase('grudge_decision'); // pendingElimination: 'p2'
    const state = {
      ...base,
      players: base.players.map((p) => (p.id === 'p0' ? { ...p, specialRole: 'grudge' as const } : p)),
    };
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 1,
      playerId: 'p0', // holds grudge, but isn't the one currently being revealed (p2)
      targetId: 'p1',
    });
    expect(result.error).toBe('validation');
  });

  it('rejects a dead target (validation)', () => {
    const base = stateInPhase('grudge_decision');
    const state = {
      ...base,
      players: base.players.map((p) => {
        if (p.id === 'p2') return { ...p, specialRole: 'grudge' as const };
        if (p.id === 'p1') return { ...p, alive: false, eliminatedRound: 1 };
        return p;
      }),
    };
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 1,
      playerId: 'p2',
      targetId: 'p1',
    });
    expect(result.error).toBe('validation');
  });

  it('rejects an unknown target (validation)', () => {
    const base = stateInPhase('grudge_decision');
    const state = {
      ...base,
      players: base.players.map((p) => (p.id === 'p2' ? { ...p, specialRole: 'grudge' as const } : p)),
    };
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 1,
      playerId: 'p2',
      targetId: 'ghost',
    });
    expect(result.error).toBe('validation');
  });

  it('accepts a real actor + alive target: drags them down, enters reveal', () => {
    const base = stateInPhase('grudge_decision');
    const state = {
      ...base,
      players: base.players.map((p) => (p.id === 'p2' ? { ...p, specialRole: 'grudge' as const } : p)),
    };
    const result = applyAction(state, {
      type: 'grudgeDrag',
      at: 1000,
      playerId: 'p2',
      targetId: 'p1',
    });
    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('reveal');
    expect(result.state.pendingElimination).toBe('p1');
    expect(result.state.players.find((p) => p.id === 'p1')).toMatchObject({ alive: false });
    expect(result.state.players.find((p) => p.id === 'p2')).toMatchObject({
      usedSpecialPower: true,
    });
  });
});

describe('action-rejection matrix: timeout', () => {
  it.each(ALL_PHASES)('timeout{%s} while state.phase differs -> wrong_phase', (phase) => {
    const otherPhase = ALL_PHASES.find((p) => p !== phase)!;
    const state = stateInPhase(otherPhase);
    const result = applyAction(state, { type: 'timeout', at: 1, phase });
    expect(result.error).toBe('wrong_phase');
    expect(result.state).toBe(state);
  });

  it('timeout{lobby} while genuinely in lobby is a harmless no-op (no scheduled timer ever fires here)', () => {
    const state = stateInPhase('lobby');
    const result = applyAction(state, { type: 'timeout', at: 1, phase: 'lobby' });
    expect(result.error).toBeUndefined();
    expect(result.state).toEqual(state);
  });

  it('timeout{game_over} while genuinely in game_over is a harmless no-op', () => {
    const state = stateInPhase('game_over');
    const result = applyAction(state, { type: 'timeout', at: 1, phase: 'game_over' });
    expect(result.error).toBeUndefined();
    expect(result.state).toEqual(state);
  });
});

describe('action-rejection matrix: extendTimer', () => {
  it('rejects when there is no active deadline (validation)', () => {
    const state = { ...stateInPhase('discussion'), phaseEndsAt: null };
    const result = applyAction(state, { type: 'extendTimer', at: 1, playerId: 'p0' });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });

  it('rejects when already extended this phase (validation)', () => {
    const state = { ...stateInPhase('discussion'), phaseEndsAt: 500, timerExtended: true };
    const result = applyAction(state, { type: 'extendTimer', at: 1, playerId: 'p0' });
    expect(result.error).toBe('validation');
    expect(result.state).toBe(state);
  });
});
