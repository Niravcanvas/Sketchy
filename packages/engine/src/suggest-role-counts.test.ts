import { describe, expect, it } from 'vitest';
import { suggestRoleCounts } from './suggest-role-counts.js';

describe('suggestRoleCounts', () => {
  // Table-driven mirror of research/01 §3: "+1 Undercover per ~4 players (floor, min 1),
  // 1 Mr. White at 5+ players" — every player count from 3 to 20.
  const table: Array<[number, { undercoverCount: number; mrWhiteCount: number }]> = [
    [3, { undercoverCount: 1, mrWhiteCount: 0 }],
    [4, { undercoverCount: 1, mrWhiteCount: 0 }],
    [5, { undercoverCount: 1, mrWhiteCount: 1 }],
    [6, { undercoverCount: 1, mrWhiteCount: 1 }],
    [7, { undercoverCount: 1, mrWhiteCount: 1 }],
    [8, { undercoverCount: 2, mrWhiteCount: 1 }],
    [9, { undercoverCount: 2, mrWhiteCount: 1 }],
    [10, { undercoverCount: 2, mrWhiteCount: 1 }],
    [11, { undercoverCount: 2, mrWhiteCount: 1 }],
    [12, { undercoverCount: 3, mrWhiteCount: 1 }],
    [13, { undercoverCount: 3, mrWhiteCount: 1 }],
    [14, { undercoverCount: 3, mrWhiteCount: 1 }],
    [15, { undercoverCount: 3, mrWhiteCount: 1 }],
    [16, { undercoverCount: 4, mrWhiteCount: 1 }],
    [17, { undercoverCount: 4, mrWhiteCount: 1 }],
    [18, { undercoverCount: 4, mrWhiteCount: 1 }],
    [19, { undercoverCount: 4, mrWhiteCount: 1 }],
    [20, { undercoverCount: 5, mrWhiteCount: 1 }],
  ];

  it.each(table)('suggests %s -> %o', (playerCount, expected) => {
    expect(suggestRoleCounts(playerCount)).toEqual(expected);
  });

  it('never suggests 0 undercovers, even for very small tables', () => {
    expect(suggestRoleCounts(1).undercoverCount).toBe(1);
    expect(suggestRoleCounts(0).undercoverCount).toBe(1);
  });
});
