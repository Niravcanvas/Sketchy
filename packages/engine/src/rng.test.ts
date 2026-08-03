import { describe, expect, it } from 'vitest';
import { createRng, hashStringToUint32 } from './rng.js';

describe('hashStringToUint32', () => {
  it('is deterministic for the same string', () => {
    expect(hashStringToUint32('room-42:deal:0')).toBe(hashStringToUint32('room-42:deal:0'));
  });

  it('differs for different strings (in practice)', () => {
    expect(hashStringToUint32('seed-a')).not.toBe(hashStringToUint32('seed-b'));
  });

  it('always returns a uint32', () => {
    const h = hashStringToUint32('anything at all, including emoji  and spaces');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('handles the empty string', () => {
    expect(Number.isInteger(hashStringToUint32(''))).toBe(true);
  });
});

describe('createRng determinism', () => {
  it('same seed -> identical sequence of next()', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-1');
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds -> different sequences', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-2');
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('same seed -> identical shuffle output', () => {
    const a = createRng('shuffle-seed').shuffle([1, 2, 3, 4, 5]);
    const b = createRng('shuffle-seed').shuffle([1, 2, 3, 4, 5]);
    expect(a).toEqual(b);
  });

  it('same seed -> identical bool()/int() draws', () => {
    const a = createRng('bool-seed');
    const b = createRng('bool-seed');
    expect([a.bool(), a.bool(), a.int(10), a.int(100)]).toEqual([
      b.bool(),
      b.bool(),
      b.int(10),
      b.int(100),
    ]);
  });
});

describe('next() distribution sanity', () => {
  it('stays within [0, 1) across many draws', () => {
    const rng = createRng('range-check');
    for (let i = 0; i < 2000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is not degenerate (produces more than a handful of distinct values)', () => {
    const rng = createRng('distinctness-check');
    const values = new Set(Array.from({ length: 500 }, () => rng.next()));
    expect(values.size).toBeGreaterThan(400);
  });

  it('roughly covers both halves of [0, 1) (loose sanity, not a statistical test)', () => {
    const rng = createRng('half-check');
    let low = 0;
    let high = 0;
    for (let i = 0; i < 2000; i++) {
      if (rng.next() < 0.5) low++;
      else high++;
    }
    expect(low).toBeGreaterThan(700);
    expect(high).toBeGreaterThan(700);
  });
});

describe('int()', () => {
  it('always returns an integer in [0, maxExclusive)', () => {
    const rng = createRng('int-check');
    for (let i = 0; i < 500; i++) {
      const v = rng.int(7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('int(1) always returns 0', () => {
    const rng = createRng('int-one');
    for (let i = 0; i < 20; i++) {
      expect(rng.int(1)).toBe(0);
    }
  });
});

describe('bool()', () => {
  it('produces both true and false over enough draws', () => {
    const rng = createRng('bool-spread');
    const results = new Set(Array.from({ length: 200 }, () => rng.bool()));
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });
});

describe('shuffle()', () => {
  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    createRng('no-mutate').shuffle(input);
    expect(input).toEqual(copy);
  });

  it('returns a permutation (same multiset of elements) for small arrays across many seeds', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 0; i < 50; i++) {
      const shuffled = createRng(`perm-seed-${i}`).shuffle(input);
      expect(shuffled).toHaveLength(input.length);
      expect([...shuffled].sort()).toEqual([...input].sort());
    }
  });

  it('produces more than one distinct ordering across many seeds (permutation-completeness sanity)', () => {
    const input = [1, 2, 3, 4];
    const orderings = new Set(
      Array.from({ length: 100 }, (_, i) => createRng(`order-seed-${i}`).shuffle(input).join(',')),
    );
    // 4! = 24 possible orderings; requiring a healthy fraction rules out a broken shuffle
    // that e.g. always returns the identity or only swaps one fixed pair.
    expect(orderings.size).toBeGreaterThan(10);
  });

  it('handles empty and single-element arrays', () => {
    expect(createRng('empty').shuffle([])).toEqual([]);
    expect(createRng('single').shuffle([42])).toEqual([42]);
  });
});
