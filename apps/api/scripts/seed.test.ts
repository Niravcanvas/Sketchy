import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client.js';
import { wordPacks, wordPairs } from '../src/db/schema.js';
import { loadPackFiles, resolveSeedDir, seedPack } from './seed.js';

const FIXTURE_PACK_A = {
  slug: 'seed-test-fixture-a',
  name: 'Fixture Pack A',
  description: 'A small fixture pack for seed script tests.',
  category: 'test',
  language: 'en',
  pairs: [
    { wordA: 'Fixture Alpha', wordB: 'Fixture Beta', difficulty: 'easy' },
    { wordA: 'Fixture Gamma', wordB: 'Fixture Delta', difficulty: 'medium' },
  ],
};

const FIXTURE_PACK_B = {
  slug: 'seed-test-fixture-b',
  name: 'Fixture Pack B',
  description: 'A second small fixture pack.',
  category: 'test',
  language: 'en',
  pairs: [{ wordA: 'Fixture Epsilon', wordB: 'Fixture Zeta', difficulty: 'hard' }],
};

describe('seed script', () => {
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'sketchy-seed-fixture-'));
    await writeFile(path.join(fixtureDir, 'a.json'), JSON.stringify(FIXTURE_PACK_A), 'utf8');
    await writeFile(path.join(fixtureDir, 'b.json'), JSON.stringify(FIXTURE_PACK_B), 'utf8');
  });

  afterEach(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
    // Clean up so re-running this suite (or other pack tests) never sees
    // leftover fixture rows from a previous run.
    const db = getDb();
    await db.delete(wordPacks).where(eq(wordPacks.slug, FIXTURE_PACK_A.slug));
    await db.delete(wordPacks).where(eq(wordPacks.slug, FIXTURE_PACK_B.slug));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(wordPacks).where(eq(wordPacks.slug, FIXTURE_PACK_A.slug));
    await db.delete(wordPacks).where(eq(wordPacks.slug, FIXTURE_PACK_B.slug));
  });

  it('resolveSeedDir honors the SEED_PACKS_DIR env override', () => {
    process.env.SEED_PACKS_DIR = fixtureDir;
    try {
      expect(resolveSeedDir()).toBe(path.resolve(fixtureDir));
    } finally {
      delete process.env.SEED_PACKS_DIR;
    }
  });

  it('loadPackFiles reads and validates every *.json in the directory', async () => {
    const loaded = await loadPackFiles(fixtureDir);
    expect(loaded.map((l) => l.data.slug).sort()).toEqual([
      FIXTURE_PACK_A.slug,
      FIXTURE_PACK_B.slug,
    ]);
  });

  it('throws a clear error for a missing seed directory', async () => {
    await expect(loadPackFiles(path.join(fixtureDir, 'does-not-exist'))).rejects.toThrow(
      /Seed directory not found/,
    );
  });

  it('throws a clear error for an empty seed directory', async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'sketchy-seed-empty-'));
    try {
      await expect(loadPackFiles(emptyDir)).rejects.toThrow(/no \*\.json files/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('throws a clear, file-scoped error for invalid content', async () => {
    const badDir = await mkdtemp(path.join(os.tmpdir(), 'sketchy-seed-bad-'));
    try {
      await writeFile(path.join(badDir, 'broken.json'), JSON.stringify({ slug: 'x' }), 'utf8');
      await expect(loadPackFiles(badDir)).rejects.toThrow(/broken\.json/);
    } finally {
      await rm(badDir, { recursive: true, force: true });
    }
  });

  it('is idempotent: running twice inserts pairs once and leaves pair_count stable', async () => {
    const db = getDb();
    const loaded = await loadPackFiles(fixtureDir);

    const firstRunSummaries: string[] = [];
    for (const { data } of loaded) {
      firstRunSummaries.push(await seedPack(db, data));
    }
    expect(firstRunSummaries.some((s) => s.includes('2 new pair(s) inserted'))).toBe(true);
    expect(firstRunSummaries.some((s) => s.includes('1 new pair(s) inserted'))).toBe(true);

    const secondRunSummaries: string[] = [];
    for (const { data } of loaded) {
      secondRunSummaries.push(await seedPack(db, data));
    }
    // Re-running with identical content inserts nothing new.
    for (const summary of secondRunSummaries) {
      expect(summary).toContain('0 new pair(s) inserted');
    }

    const [packA] = await db
      .select()
      .from(wordPacks)
      .where(eq(wordPacks.slug, FIXTURE_PACK_A.slug));
    expect(packA?.isOfficial).toBe(true);
    expect(packA?.ownerId).toBeNull();
    expect(packA?.visibility).toBe('public');
    expect(packA?.pairCount).toBe(2);

    const pairsA = packA
      ? await db.select().from(wordPairs).where(eq(wordPairs.packId, packA.id))
      : [];
    expect(pairsA).toHaveLength(2);
  });

  it('updates pack metadata on re-seed without duplicating the pack row', async () => {
    const db = getDb();
    const loaded = await loadPackFiles(fixtureDir);
    const packAFile = loaded.find((l) => l.data.slug === FIXTURE_PACK_A.slug);
    if (!packAFile) throw new Error('fixture missing');

    await seedPack(db, packAFile.data);
    const renamed = { ...packAFile.data, name: 'Renamed Fixture Pack A' };
    await seedPack(db, renamed);

    const rows = await db.select().from(wordPacks).where(eq(wordPacks.slug, FIXTURE_PACK_A.slug));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Renamed Fixture Pack A');
  });
});
