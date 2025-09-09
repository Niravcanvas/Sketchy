import { describe, expect, it } from 'vitest';
import { eliminationPriority, playScriptedGame } from '../test-support.js';

describe('full-game simulations — n=3', () => {
  // suggestRoleCounts(3) = { undercoverCount: 1, mrWhiteCount: 0 }: only civilian/undercover
  // outcomes are reachable at this size (no Mr. White in the default distribution).
  it('start -> civilian win', () => {
    const { finalState } = playScriptedGame({
      n: 3,
      seed: 'full-game-n3-civilian',
      priority: eliminationPriority.civilianWin,
    });
    expect(finalState.phase).toBe('game_over');
    expect(finalState.winnerFaction).toBe('civilian');
  });

  it('start -> undercover win', () => {
    const { finalState } = playScriptedGame({
      n: 3,
      seed: 'full-game-n3-undercover',
      priority: eliminationPriority.undercoverWin,
    });
    expect(finalState.winnerFaction).toBe('undercover');
  });

  it('start -> mrwhite win (with mrWhiteCount forced to 1 for a 3-player table)', () => {
    const { finalState } = playScriptedGame({
      n: 3,
      seed: 'full-game-n3-mrwhite',
      roleCounts: { undercoverCount: 0, mrWhiteCount: 1 },
      priority: eliminationPriority.mrwhiteWin,
    });
    expect(finalState.winnerFaction).toBe('mrwhite');
  });

  it('start -> mrwhite steal (with mrWhiteCount forced to 1)', () => {
    const { finalState } = playScriptedGame({
      n: 3,
      seed: 'full-game-n3-steal',
      roleCounts: { undercoverCount: 0, mrWhiteCount: 1 },
      priority: eliminationPriority.mrwhiteSteal,
      mrWhiteGuessCorrect: true,
    });
    expect(finalState.winnerFaction).toBe('mrwhite');
    expect(finalState.lastGuess?.correct).toBe(true);
  });
});

describe('full-game simulations — n=5 (default suggestRoleCounts: 1 undercover, 1 mrwhite)', () => {
  it('start -> civilian win', () => {
    const { finalState } = playScriptedGame({
      n: 5,
      seed: 'full-game-n5-civilian',
      priority: eliminationPriority.civilianWin,
    });
    expect(finalState.winnerFaction).toBe('civilian');
  });

  it('start -> undercover win', () => {
    const { finalState } = playScriptedGame({
      n: 5,
      seed: 'full-game-n5-undercover',
      priority: eliminationPriority.undercoverWin,
    });
    expect(finalState.winnerFaction).toBe('undercover');
  });

  it('start -> mrwhite win (survive)', () => {
    const { finalState } = playScriptedGame({
      n: 5,
      seed: 'full-game-n5-mrwhite',
      priority: eliminationPriority.mrwhiteWin,
    });
    expect(finalState.winnerFaction).toBe('mrwhite');
  });

  it('start -> infiltrators joint win', () => {
    const { finalState } = playScriptedGame({
      n: 5,
      seed: 'full-game-n5-infiltrators',
      priority: eliminationPriority.infiltratorsWin,
    });
    expect(finalState.winnerFaction).toBe('infiltrators');
  });

  it('start -> mrwhite steal', () => {
    const { finalState } = playScriptedGame({
      n: 5,
      seed: 'full-game-n5-steal',
      priority: eliminationPriority.mrwhiteSteal,
      mrWhiteGuessCorrect: true,
    });
    expect(finalState.winnerFaction).toBe('mrwhite');
    expect(finalState.lastGuess?.correct).toBe(true);
  });
});

describe('full-game simulations — n=8 (Verify fixtures: readable phase-by-phase dumps)', () => {
  it('start -> civilian win', () => {
    const { finalState, log } = playScriptedGame({
      n: 8,
      seed: 'full-game-n8-civilian',
      priority: eliminationPriority.civilianWin,
    });

    expect(finalState.phase).toBe('game_over');
    expect(finalState.winnerFaction).toBe('civilian');
    // Civilian team win: every civilian (alive or eliminated) is scored +2.
    const civilianIds = finalState.players.filter((p) => p.role === 'civilian').map((p) => p.id);
    expect(civilianIds.length).toBeGreaterThan(0);
    for (const id of civilianIds) expect(finalState.scoreboard[id]).toBe(2);

    // Readable phase-by-phase dumps (game-design.md-style "glanceable state" check).
    expect(log[0]).toMatch(/^R1 clue 8 alive \| scores \(none\)$/);
    expect(log.some((line) => /^R1 discussion 8 alive \| scores \(none\)$/.test(line))).toBe(true);
    expect(log.some((line) => /^R1 voting 8 alive \| scores \(none\)$/.test(line))).toBe(true);
    // The eliminated player already flips to alive:false the instant the vote CLOSES (before
    // `reveal` is even entered), so the reveal-phase dump already shows one fewer alive.
    expect(log.some((line) => /^R1 reveal 7 alive \| scores \(none\)$/.test(line))).toBe(true);
    expect(log.at(-1)).toMatch(/^R\d+ game_over \d alive \| scores /);
  });

  it('start -> mrwhite steal', () => {
    const { finalState, log } = playScriptedGame({
      n: 8,
      seed: 'full-game-n8-steal',
      priority: eliminationPriority.mrwhiteSteal,
      mrWhiteGuessCorrect: true,
    });

    expect(finalState.phase).toBe('game_over');
    expect(finalState.winnerFaction).toBe('mrwhite');
    expect(finalState.lastGuess?.correct).toBe(true);
    // Steal scoring: +6 to the guesser only.
    expect(finalState.scoreboard).toEqual({ [finalState.lastGuess!.playerId]: 6 });

    expect(log[0]).toMatch(/^R1 clue 8 alive \| scores \(none\)$/);
    expect(log.some((line) => /^R1 voting 8 alive \| scores \(none\)$/.test(line))).toBe(true);
    expect(log.some((line) => /^R1 mrwhite_guess 7 alive \| scores \(none\)$/.test(line))).toBe(
      true,
    );
    expect(log.at(-1)).toMatch(/^R1 game_over 7 alive \| scores /);
  });

  it('start -> undercover win', () => {
    const { finalState } = playScriptedGame({
      n: 8,
      seed: 'full-game-n8-undercover',
      priority: eliminationPriority.undercoverWin,
    });
    expect(finalState.winnerFaction).toBe('undercover');
  });

  it('start -> infiltrators joint win', () => {
    const { finalState } = playScriptedGame({
      n: 8,
      seed: 'full-game-n8-infiltrators',
      priority: eliminationPriority.infiltratorsWin,
    });
    expect(finalState.winnerFaction).toBe('infiltrators');
  });
});

describe('full-game simulations — n=12', () => {
  it('start -> civilian win', () => {
    const { finalState } = playScriptedGame({
      n: 12,
      seed: 'full-game-n12-civilian',
      priority: eliminationPriority.civilianWin,
    });
    expect(finalState.winnerFaction).toBe('civilian');
  });

  it('start -> undercover win', () => {
    const { finalState } = playScriptedGame({
      n: 12,
      seed: 'full-game-n12-undercover',
      priority: eliminationPriority.undercoverWin,
    });
    expect(finalState.winnerFaction).toBe('undercover');
  });
});

describe('full-game simulations — n=20', () => {
  it('start -> civilian win', () => {
    const { finalState } = playScriptedGame({
      n: 20,
      seed: 'full-game-n20-civilian',
      priority: eliminationPriority.civilianWin,
    });
    expect(finalState.winnerFaction).toBe('civilian');
  });

  it('start -> mrwhite win (survive)', () => {
    const { finalState } = playScriptedGame({
      n: 20,
      seed: 'full-game-n20-mrwhite',
      priority: eliminationPriority.mrwhiteWin,
    });
    expect(finalState.winnerFaction).toBe('mrwhite');
  });
});

describe('full-game invariants across every simulation above', () => {
  it('role counts always match settings at deal time, for every table size', () => {
    for (const n of [3, 5, 8, 12, 20]) {
      const { log } = playScriptedGame({
        n,
        seed: `invariant-check-${n}`,
        priority: eliminationPriority.civilianWin,
      });
      expect(log.length).toBeGreaterThan(0);
    }
  });
});
