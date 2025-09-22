import { describe, expect, it } from 'vitest';
import {
  browsePublicPacksQuerySchema,
  bulkCreatePairsRequestSchema,
  createPackRequestSchema,
  importPackRequestSchema,
  listPacksQuerySchema,
  MAX_PAIRS_PER_BULK_REQUEST,
  packSchema,
  packsResponseSchema,
  paginationQuerySchema,
  patchPackRequestSchema,
  patchPairRequestSchema,
  pairSchema,
  pairsPageSchema,
  publicPacksPageSchema,
} from './packs.js';

const validPack = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  slug: 'food-drink',
  name: 'Food & Drink',
  description: 'Tasty pairs.',
  category: 'food-drink',
  language: 'en',
  isOfficial: true,
  ownerId: null,
  visibility: 'public' as const,
  reviewStatus: 'approved' as const,
  shareCode: null,
  coverUrl: null,
  pairCount: 30,
  createdAt: Date.now(),
};

const validPair = {
  id: '223e4567-e89b-12d3-a456-426614174000',
  packId: validPack.id,
  wordA: 'Coffee',
  wordB: 'Tea',
  difficulty: 'easy' as const,
};

describe('packSchema', () => {
  it('round-trips a valid official pack', () => {
    expect(packSchema.parse(validPack)).toEqual(validPack);
  });

  it('rejects an invalid visibility value', () => {
    expect(() => packSchema.parse({ ...validPack, visibility: 'bogus' })).toThrow();
  });

  it('round-trips each reviewStatus value and rejects an invalid one', () => {
    for (const reviewStatus of ['pending', 'approved', 'rejected'] as const) {
      expect(packSchema.parse({ ...validPack, reviewStatus }).reviewStatus).toBe(reviewStatus);
    }
    expect(() => packSchema.parse({ ...validPack, reviewStatus: 'bogus' })).toThrow();
  });

  it('requires reviewStatus (every pack row has one)', () => {
    const withoutReview: Record<string, unknown> = { ...validPack };
    delete withoutReview.reviewStatus;
    expect(() => packSchema.parse(withoutReview)).toThrow();
  });
});

describe('pairSchema', () => {
  it('round-trips a valid pair', () => {
    expect(pairSchema.parse(validPair)).toEqual(validPair);
  });

  it('rejects an invalid difficulty', () => {
    expect(() => pairSchema.parse({ ...validPair, difficulty: 'nightmare' })).toThrow();
  });
});

describe('listPacksQuerySchema', () => {
  it('parses boolean-ish query strings', () => {
    expect(listPacksQuerySchema.parse({ official: 'true', mine: 'false' })).toEqual({
      official: true,
      mine: false,
    });
  });

  it('treats an all-absent query as all-undefined', () => {
    expect(listPacksQuerySchema.parse({})).toEqual({});
  });

  it('accepts a language filter', () => {
    expect(listPacksQuerySchema.parse({ language: 'en' })).toEqual({ language: 'en' });
  });
});

describe('paginationQuerySchema', () => {
  it('defaults limit to 30 when absent', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 30 });
  });

  it('coerces a string limit to a number', () => {
    expect(paginationQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
  });

  it('rejects a limit above 50', () => {
    expect(() => paginationQuerySchema.parse({ limit: '51' })).toThrow();
  });

  it('rejects a limit below 1', () => {
    expect(() => paginationQuerySchema.parse({ limit: '0' })).toThrow();
  });

  it('passes through an opaque cursor string', () => {
    expect(paginationQuerySchema.parse({ cursor: 'abc123' })).toEqual({
      cursor: 'abc123',
      limit: 30,
    });
  });
});

describe('packsResponseSchema / pairsPageSchema', () => {
  it('wraps a list of packs', () => {
    expect(packsResponseSchema.parse({ items: [validPack] })).toEqual({ items: [validPack] });
  });

  it('wraps a page of pairs with a nullable nextCursor', () => {
    const page = { items: [validPair], nextCursor: null };
    expect(pairsPageSchema.parse(page)).toEqual(page);
    const page2 = { items: [validPair], nextCursor: 'opaque-cursor' };
    expect(pairsPageSchema.parse(page2)).toEqual(page2);
  });
});

describe('createPackRequestSchema', () => {
  it('accepts a name-only body', () => {
    expect(createPackRequestSchema.parse({ name: 'Inside Jokes' })).toEqual({
      name: 'Inside Jokes',
    });
  });

  it('rejects a name shorter than 2 chars', () => {
    expect(() => createPackRequestSchema.parse({ name: 'A' })).toThrow();
  });

  it('rejects a name longer than 40 chars', () => {
    expect(() => createPackRequestSchema.parse({ name: 'x'.repeat(41) })).toThrow();
  });
});

describe('patchPackRequestSchema', () => {
  it('accepts a partial visibility-only patch', () => {
    expect(patchPackRequestSchema.parse({ visibility: 'unlisted' })).toEqual({
      visibility: 'unlisted',
    });
  });

  it("accepts 'public' — self-service, takes effect immediately (server marks it approved)", () => {
    expect(patchPackRequestSchema.parse({ visibility: 'public' })).toEqual({ visibility: 'public' });
  });

  it('accepts a null coverUrl (clearing it)', () => {
    expect(patchPackRequestSchema.parse({ coverUrl: null })).toEqual({ coverUrl: null });
  });

  it('rejects a non-URL coverUrl', () => {
    expect(() => patchPackRequestSchema.parse({ coverUrl: 'not-a-url' })).toThrow();
  });
});

describe('bulkCreatePairsRequestSchema', () => {
  it('accepts pairs with an implicit medium difficulty', () => {
    const parsed = bulkCreatePairsRequestSchema.parse({
      pairs: [{ wordA: 'Sofa', wordB: 'Armchair' }],
    });
    expect(parsed.pairs[0]?.difficulty).toBe('medium');
  });

  it('rejects an empty pairs array', () => {
    expect(() => bulkCreatePairsRequestSchema.parse({ pairs: [] })).toThrow();
  });

  it(`rejects more than ${MAX_PAIRS_PER_BULK_REQUEST} pairs in one call`, () => {
    const pairs = Array.from({ length: MAX_PAIRS_PER_BULK_REQUEST + 1 }, (_, i) => ({
      wordA: `A${i}`,
      wordB: `B${i}`,
    }));
    expect(() => bulkCreatePairsRequestSchema.parse({ pairs })).toThrow();
  });

  it('rejects a pair with an empty word', () => {
    expect(() =>
      bulkCreatePairsRequestSchema.parse({ pairs: [{ wordA: '', wordB: 'Beta' }] }),
    ).toThrow();
  });
});

describe('patchPairRequestSchema', () => {
  it('accepts a difficulty-only patch', () => {
    expect(patchPairRequestSchema.parse({ difficulty: 'hard' })).toEqual({ difficulty: 'hard' });
  });

  it('accepts an all-absent patch', () => {
    expect(patchPairRequestSchema.parse({})).toEqual({});
  });
});

describe('importPackRequestSchema', () => {
  it('accepts a share code', () => {
    expect(importPackRequestSchema.parse({ shareCode: 'ABCD2345' })).toEqual({
      shareCode: 'ABCD2345',
    });
  });

  it('rejects an empty share code', () => {
    expect(() => importPackRequestSchema.parse({ shareCode: '' })).toThrow();
  });
});

describe('browsePublicPacksQuerySchema', () => {
  it('defaults limit to 30 and leaves q/cursor absent', () => {
    expect(browsePublicPacksQuerySchema.parse({})).toEqual({ limit: 30 });
  });

  it('trims the name search and carries the cursor + coerced limit', () => {
    expect(
      browsePublicPacksQuerySchema.parse({ q: '  food  ', cursor: 'abc123', limit: '10' }),
    ).toEqual({ q: 'food', cursor: 'abc123', limit: 10 });
  });

  it('rejects a name search longer than the pack-name ceiling', () => {
    expect(() => browsePublicPacksQuerySchema.parse({ q: 'x'.repeat(41) })).toThrow();
  });

  it('rejects a limit outside 1..50', () => {
    expect(() => browsePublicPacksQuerySchema.parse({ limit: '0' })).toThrow();
    expect(() => browsePublicPacksQuerySchema.parse({ limit: '51' })).toThrow();
  });
});

describe('publicPacksPageSchema', () => {
  it('wraps a page of packs with a nullable nextCursor', () => {
    const page = { items: [validPack], nextCursor: null };
    expect(publicPacksPageSchema.parse(page)).toEqual(page);
    const page2 = { items: [validPack], nextCursor: 'opaque-cursor' };
    expect(publicPacksPageSchema.parse(page2)).toEqual(page2);
  });
});
