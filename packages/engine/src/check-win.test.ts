import { describe, expect, it } from 'vitest';
import { checkWin } from './check-win.js';
import { makePlayer, makeState } from './test-support.js';
import type { GamePlayer } from './types.js';

/** Builds an alive-player roster with the given role counts, plus one already-eliminated
 * player thrown in (role irrelevant) to prove `checkWin` really only counts the alive. */
function rosterFor(
  aliveCivilian: number,
  aliveUndercover: number,
  aliveMrWhite: number,
): GamePlayer[] {
  const players: GamePlayer[] = [];
  let seat = 0;
  for (let i = 0; i < aliveCivilian; i++) {
    players.push(makePlayer({ id: `civ-${i}`, seat: seat++, role: 'civilian', alive: true }));
  }
  for (let i = 0; i < aliveUndercover; i++) {
    players.push(makePlayer({ id: `uc-${i}`, seat: seat++, role: 'undercover', alive: true }));
  }
  for (let i = 0; i < aliveMrWhite; i++) {
    players.push(makePlayer({ id: `mw-${i}`, seat: seat++, role: 'mrwhite', alive: true }));
  }
  // A red herring: an eliminated player of a role that would otherwise flip the outcome.
  players.push(
    makePlayer({
      id: 'dead-undercover',
      seat: seat++,
      role: 'undercover',
      alive: false,
      eliminatedRound: 1,
    }),
  );
  return players;
}

describe('checkWin — research/01 §5 table', () => {
  const cases: Array<{
    name: string;
    civ: number;
    uc: number;
    mw: number;
    expected: 'civilian' | 'undercover' | 'mrwhite' | 'infiltrators' | null;
  }> = [
    // "Civilians win as soon as every Undercover and every Mister White has been eliminated."
    { name: 'civilians win: 3 civilians, 0 uc, 0 mw', civ: 3, uc: 0, mw: 0, expected: 'civilian' },
    { name: 'civilians win: 1 civilian, 0 uc, 0 mw', civ: 1, uc: 0, mw: 0, expected: 'civilian' },
    // Degenerate generalization: even 0 civilians alive still reads as a civilian win once
    // uc/mw are both 0 (checkWin's first check doesn't require civAlive > 0).
    {
      name: 'civilians win (degenerate): 0 civilians, 0 uc, 0 mw',
      civ: 0,
      uc: 0,
      mw: 0,
      expected: 'civilian',
    },

    // "Undercover(s) win if survivors reduced to 1 Civilian + >=1 Undercover, 0 Mr. White."
    {
      name: 'undercover wins: 1 civilian, 1 uc, 0 mw',
      civ: 1,
      uc: 1,
      mw: 0,
      expected: 'undercover',
    },
    {
      name: 'undercover wins: 1 civilian, 2 uc, 0 mw',
      civ: 1,
      uc: 2,
      mw: 0,
      expected: 'undercover',
    },
    // <=1 generalization: 0 civilians also counts.
    {
      name: 'undercover wins (generalized): 0 civilians, 1 uc, 0 mw',
      civ: 0,
      uc: 1,
      mw: 0,
      expected: 'undercover',
    },

    // "Mister White wins by surviving down to a 1-Civilian, 0-Undercover end state."
    { name: 'mrwhite wins: 1 civilian, 0 uc, 1 mw', civ: 1, uc: 0, mw: 1, expected: 'mrwhite' },
    { name: 'mrwhite wins: 1 civilian, 0 uc, 2 mw', civ: 1, uc: 0, mw: 2, expected: 'mrwhite' },
    {
      name: 'mrwhite wins (generalized): 0 civilians, 0 uc, 1 mw',
      civ: 0,
      uc: 0,
      mw: 1,
      expected: 'mrwhite',
    },

    // "Undercover + Mister White can win together: exactly 1 Civilian remains while >=1 of
    // each survive, the whole 'Infiltrator' side wins jointly."
    {
      name: 'infiltrators win jointly: 1 civilian, 1 uc, 1 mw',
      civ: 1,
      uc: 1,
      mw: 1,
      expected: 'infiltrators',
    },
    {
      name: 'infiltrators win (generalized): 0 civilians, 1 uc, 1 mw',
      civ: 0,
      uc: 1,
      mw: 1,
      expected: 'infiltrators',
    },

    // "If none of the above is true after an elimination, the game simply continues."
    { name: 'continues: 2 civilians, 1 uc, 1 mw', civ: 2, uc: 1, mw: 1, expected: null },
    { name: 'continues: 3 civilians, 2 uc, 0 mw', civ: 3, uc: 2, mw: 0, expected: null },
    { name: 'continues: 2 civilians, 0 uc, 1 mw', civ: 2, uc: 0, mw: 1, expected: null },
    { name: 'continues: everyone still alive, full table', civ: 6, uc: 2, mw: 1, expected: null },
  ];

  it.each(cases)('$name', ({ civ, uc, mw, expected }) => {
    const state = makeState({ players: rosterFor(civ, uc, mw) });
    expect(checkWin(state)).toBe(expected);
  });

  it('checks in exactly the documented priority order (civilian check wins even for an empty roster)', () => {
    // 0 civilians, 0 uc, 0 mw would vacuously satisfy "civilian" (uc==0 && mw==0) — confirm
    // that's what actually comes out, not `null` from falling through some other branch.
    const state = makeState({ players: [] });
    expect(checkWin(state)).toBe('civilian');
  });

  it('an alive player with role: null (not yet dealt) is simply not counted toward any faction', () => {
    const state = makeState({
      players: [
        makePlayer({ id: 'undealt', seat: 0, role: null, alive: true }),
        makePlayer({ id: 'uc-0', seat: 1, role: 'undercover', alive: true }),
      ],
    });
    // 0 civilians, 1 undercover, 0 mrwhite alive -> undercover wins under the <=1 rule,
    // regardless of the undealt player (who counts toward none of the three buckets).
    expect(checkWin(state)).toBe('undercover');
  });
});
