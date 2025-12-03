import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@sketchy/shared/client';
import type { Pair, PairsPage } from '@sketchy/shared/contract/packs';
import { bundledPairPool, drawPair, fetchPairPool, pairKey, type PoolPair } from './pair-pool';

function makePair(overrides: Partial<Pair> & Pick<Pair, 'wordA' | 'wordB'>): Pair {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    packId: overrides.packId ?? 'pack-1',
    difficulty: overrides.difficulty ?? 'easy',
    ...overrides,
  };
}

/** Minimal `ApiClient` stub — only `listPackPairs` is exercised by `fetchPairPool`; every
 * other method throws if accidentally called so a bug can't silently no-op past a test. */
function stubClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const unimplemented = (name: string) => () => {
    throw new Error(`stubClient: ${name} not implemented for this test`);
  };
  return {
    guestAuth: unimplemented('guestAuth'),
    getMe: unimplemented('getMe'),
    patchMe: unimplemented('patchMe'),
    listPacks: unimplemented('listPacks'),
    getPack: unimplemented('getPack'),
    listPackPairs: unimplemented('listPackPairs'),
    ...overrides,
  } as ApiClient;
}

describe('bundledPairPool', () => {
  it('filters the starter pack by the requested difficulties', () => {
    const easyOnly = bundledPairPool(['easy']);
    expect(easyOnly.length).toBeGreaterThan(0);
    expect(easyOnly.every((p) => p.difficulty === 'easy')).toBe(true);

    const mediumAndHard = bundledPairPool(['medium', 'hard']);
    expect(mediumAndHard.length).toBeGreaterThan(0);
    expect(mediumAndHard.every((p) => p.difficulty === 'medium' || p.difficulty === 'hard')).toBe(
      true,
    );
  });

  it('returns pairId: null for every bundled pair (not a persisted pack row)', () => {
    const pool = bundledPairPool(['easy', 'medium', 'hard']);
    expect(pool.every((p) => p.pairId === null)).toBe(true);
  });

  it('returns an empty pool for a difficulty the starter pack has none of', () => {
    // The starter pack (apps/web/src/data/starter-pack.json) only uses the three real tiers,
    // so filtering to an empty requested set yields nothing.
    expect(bundledPairPool([])).toEqual([]);
  });

  it('carries wordA/wordB through unchanged', () => {
    const pool = bundledPairPool(['easy']);
    const waffle = pool.find((p) => p.wordA === 'waffle');
    expect(waffle).toMatchObject({ wordA: 'waffle', wordB: 'pancake', difficulty: 'easy' });
  });
});

describe('pairKey', () => {
  it('is case-insensitive and side-order-sensitive', () => {
    expect(pairKey({ wordA: 'Waffle', wordB: 'Pancake' })).toBe(
      pairKey({
        wordA: 'waffle',
        wordB: 'pancake',
      }),
    );
    expect(pairKey({ wordA: 'waffle', wordB: 'pancake' })).not.toBe(
      pairKey({ wordA: 'pancake', wordB: 'waffle' }),
    );
  });
});

describe('drawPair', () => {
  const pool: PoolPair[] = [
    { wordA: 'a1', wordB: 'a2', pairId: 'p1', difficulty: 'easy' },
    { wordA: 'b1', wordB: 'b2', pairId: 'p2', difficulty: 'easy' },
    { wordA: 'c1', wordB: 'c2', pairId: 'p3', difficulty: 'easy' },
  ];

  it('throws on an empty pool', () => {
    expect(() => drawPair([], [])).toThrow();
  });

  it('draws deterministically from a stubbed random source', () => {
    const { pair, key } = drawPair(pool, [], () => 0);
    expect(pair).toEqual({ wordA: 'a1', wordB: 'a2', pairId: 'p1' });
    expect(key).toBe(pairKey(pool[0] as PoolPair));

    const last = drawPair(pool, [], () => 0.999999);
    expect(last.pair).toEqual({ wordA: 'c1', wordB: 'c2', pairId: 'p3' });
  });

  it('excludes already-used keys', () => {
    const used = [pairKey(pool[0] as PoolPair)];
    // random() = 0 would normally pick pool[0]; with it excluded the remaining candidates
    // are [b, c], so index 0 of the filtered set is 'b'.
    const { pair } = drawPair(pool, used, () => 0);
    expect(pair.wordA).toBe('b1');
  });

  it('recycles the whole pool once every pair has been used', () => {
    const allUsed = pool.map((p) => pairKey(p));
    const { pair, key } = drawPair(pool, allUsed, () => 0);
    expect(pair).toEqual({ wordA: 'a1', wordB: 'a2', pairId: 'p1' });
    expect(key).toBe(pairKey(pool[0] as PoolPair));
  });

  it('defaults to Math.random when no source is supplied (stays in range)', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const { pair } = drawPair(pool, []);
      expect(pair.wordA).toBe('b1'); // floor(0.5 * 3) = 1 -> pool[1]
    } finally {
      spy.mockRestore();
    }
  });
});

describe('fetchPairPool', () => {
  it('pages through a single pack and filters by difficulty', async () => {
    const page1: PairsPage = {
      items: [
        makePair({ wordA: 'x1', wordB: 'x2', difficulty: 'easy' }),
        makePair({ wordA: 'y1', wordB: 'y2', difficulty: 'hard' }),
      ],
      nextCursor: 'cursor-2',
    };
    const page2: PairsPage = {
      items: [makePair({ wordA: 'z1', wordB: 'z2', difficulty: 'easy' })],
      nextCursor: null,
    };
    const listPackPairs = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const pool = await fetchPairPool(stubClient({ listPackPairs }), ['pack-1'], ['easy']);

    expect(listPackPairs).toHaveBeenCalledTimes(2);
    expect(listPackPairs).toHaveBeenNthCalledWith(1, 'pack-1', { cursor: undefined });
    expect(listPackPairs).toHaveBeenNthCalledWith(2, 'pack-1', { cursor: 'cursor-2' });
    expect(pool.map((p) => p.wordA)).toEqual(['x1', 'z1']);
  });

  it('concatenates results across multiple packs', async () => {
    const listPackPairs = vi.fn().mockImplementation((packId: string) =>
      Promise.resolve<PairsPage>({
        items: [makePair({ wordA: `${packId}-a`, wordB: `${packId}-b`, difficulty: 'medium' })],
        nextCursor: null,
      }),
    );

    const pool = await fetchPairPool(
      stubClient({ listPackPairs }),
      ['pack-1', 'pack-2'],
      ['medium'],
    );

    expect(pool.map((p) => p.wordA)).toEqual(['pack-1-a', 'pack-2-a']);
  });

  it('propagates a fetch failure to the caller', async () => {
    const listPackPairs = vi.fn().mockRejectedValueOnce(new Error('network down'));

    await expect(
      fetchPairPool(stubClient({ listPackPairs }), ['pack-1'], ['easy']),
    ).rejects.toThrow('network down');
  });
});
