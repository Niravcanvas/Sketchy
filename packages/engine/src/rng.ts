/**
 * Seeded, deterministic PRNG (conventions.md §4: "engine takes an injected seeded PRNG
 * (mulberry32 over a string seed)"; `Math.random()` is eslint-banned in this package).
 * No RNG state is ever stored on `GameState` — the engine re-derives a fresh generator
 * from `state.seed` (plus a purpose suffix) at every point it needs randomness, so
 * determinism is simply: same seed + same action sequence ⇒ identical draws.
 */

/** The seeded generator surface every reducer uses instead of `Math`. */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Fisher-Yates shuffle — returns a NEW array, input is never mutated. */
  shuffle<T>(arr: T[]): T[];
  /** Next coin flip. */
  bool(): boolean;
}

/**
 * FNV-1a string hash → uint32. Used to turn an arbitrary string seed into the numeric
 * seed mulberry32 needs. Not cryptographic — just a fast, stable, well-distributed mix.
 */
export function hashStringToUint32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32: a small, fast, high-quality 32-bit PRNG. Returns a `next()` closure seeded
 * by `seed`; each call advances internal state and returns a float in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function nextFloat(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds an `Rng` deterministically derived from a string seed (conventions.md §4). */
export function createRng(seed: string): Rng {
  const next = mulberry32(hashStringToUint32(seed));
  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive);
    },
    shuffle<T>(arr: T[]): T[] {
      const result = arr.slice();
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        // noUncheckedIndexedAccess: i, j are both valid in-bounds indices by loop
        // construction (0 <= j <= i < result.length), so the assertions are safe.
        const temp = result[i] as T;
        result[i] = result[j] as T;
        result[j] = temp;
      }
      return result;
    },
    bool(): boolean {
      return next() < 0.5;
    },
  };
}
