import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { eliminationPriority, playScriptedGame } from '../test-support.js';

describe('determinism', () => {
  it('same seed + same action sequence replayed step-by-step -> deepEqual state at every step', () => {
    const { initial, actions, finalState } = playScriptedGame({
      n: 8,
      seed: 'determinism-replay',
      priority: eliminationPriority.civilianWin,
    });

    let replay = initial;
    for (const action of actions) {
      const result = applyAction(replay, action);
      expect(result.error).toBeUndefined();
      replay = result.state;
    }

    expect(replay).toEqual(finalState);
  });

  it('same seed + same action sequence, run twice from scratch -> identical final state', () => {
    const a = playScriptedGame({
      n: 12,
      seed: 'determinism-twice',
      priority: eliminationPriority.undercoverWin,
    });
    const b = playScriptedGame({
      n: 12,
      seed: 'determinism-twice',
      priority: eliminationPriority.undercoverWin,
    });
    expect(a.finalState).toEqual(b.finalState);
    expect(a.log).toEqual(b.log);
  });

  it('the deal itself is deterministic: same seed -> identical role assignment', () => {
    const a = playScriptedGame({
      n: 8,
      seed: 'deal-determinism',
      priority: eliminationPriority.civilianWin,
    });
    const b = playScriptedGame({
      n: 8,
      seed: 'deal-determinism',
      priority: eliminationPriority.civilianWin,
    });
    // Compare the very first logged state (round 1, clue phase — post-deal, pre-any-vote).
    expect(a.log[0]).toEqual(b.log[0]);
    expect(a.finalState.pair).toEqual(b.finalState.pair);
  });

  it('different seeds usually produce a different deal (word side and/or role assignment)', () => {
    const seeds = Array.from({ length: 15 }, (_, i) => `different-seed-${i}`);
    const deals = seeds.map((seed) => {
      const { finalState } = playScriptedGame({
        n: 8,
        seed,
        priority: eliminationPriority.civilianWin,
      });
      return JSON.stringify({
        civilianWord: finalState.pair.civilianWord,
        roles: finalState.players.map((p) => p.role),
      });
    });
    // Not every seed need differ from every other, but they should not all collapse to the
    // exact same deal — that would indicate the seed isn't actually influencing the RNG.
    expect(new Set(deals).size).toBeGreaterThan(1);
  });

  it('no RNG state is stored on GameState — the deal seed is reconstructed as `${seed}:deal:${gamesPlayedInRoom}`', () => {
    // If RNG state leaked into the state shape, replaying the SAME action sequence from a
    // state object that has been round-tripped through JSON (stripping any hidden fields)
    // would still have to produce the same result. This doubles as a "no non-serializable
    // state" smoke test.
    const { initial, actions, finalState } = playScriptedGame({
      n: 5,
      seed: 'json-roundtrip',
      priority: eliminationPriority.mrwhiteWin,
    });
    let replay = JSON.parse(JSON.stringify(initial));
    for (const action of actions) {
      replay = applyAction(replay, action).state;
    }
    expect(replay).toEqual(finalState);
  });
});
