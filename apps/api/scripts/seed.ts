/**
 * Idempotent official-pack seed script. Reads every
 * `apps/api/seed/packs/*.json`, upserts one `word_packs` row per file BY
 * SLUG, then diffs `word_pairs` (insert-missing, leave-existing) and
 * refreshes the `pair_count` denormalization. Safe to re-run: a second run
 * against the same files inserts zero new rows.
 *
 * The seed directory content (`apps/api/seed/packs/*.json`) is maintained
 * separately — this script only reads it, and
 * fails with a clear message (not a stack trace) if that directory is
 * missing or empty, so `pnpm db:seed` run before the content lands is a
 * clean, understandable no-go rather than a confusing crash.
 *
 * The seed directory is configurable (first CLI arg, then `SEED_PACKS_DIR`)
 * so integration tests can point this at a small fixture directory instead
 * of the real 8-pack content set.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { closeConnections, getDb } from '../src/db/client.js';
import { wordPacks, wordPairs } from '../src/db/schema.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const pairFileSchema = z.object({
  wordA: z.string().min(1).max(40),
  wordB: z.string().min(1).max(40),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

export const packFileSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(2).max(40),
  description: z.string(),
  category: z.string(),
  language: z.string(),
  pairs: z.array(pairFileSchema),
});

export type PackFile = z.infer<typeof packFileSchema>;

export function resolveSeedDir(): string {
  const argDir = process.argv[2];
  const envDir = process.env.SEED_PACKS_DIR;
  return path.resolve(argDir ?? envDir ?? path.join(scriptDir, '../seed/packs'));
}

/** Reads + zod-validates every `*.json` in `dir`. Throws with a clear, file-scoped message on any problem. */
export async function loadPackFiles(dir: string): Promise<{ file: string; data: PackFile }[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(
      `Seed directory not found: ${dir}\n` +
        'Nothing to seed — this is expected if the pack content set has not landed yet.',
    );
  }

  const jsonFiles = entries.filter((name) => name.endsWith('.json')).sort();
  if (jsonFiles.length === 0) {
    throw new Error(`Seed directory has no *.json files: ${dir}`);
  }

  const loaded: { file: string; data: PackFile }[] = [];
  for (const file of jsonFiles) {
    const raw = await readFile(path.join(dir, file), 'utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${file}: invalid JSON (${(error as Error).message})`);
    }

    const result = packFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`${file}: schema validation failed — ${result.error.message}`);
    }
    loaded.push({ file, data: result.data });
  }
  return loaded;
}

/** Upserts one pack (by slug) + diffs its pairs. Returns a one-line summary for logging. */
export async function seedPack(db: ReturnType<typeof getDb>, packFile: PackFile): Promise<string> {
  const [pack] = await db
    .insert(wordPacks)
    .values({
      slug: packFile.slug,
      name: packFile.name,
      description: packFile.description,
      category: packFile.category,
      language: packFile.language,
      isOfficial: true,
      ownerId: null,
      visibility: 'public',
      // Official curated content is pre-approved — it never sits in the public-review
      // queue. Set explicitly here because the column defaults to 'pending', and the
      // one-time grandfather backfill in the migration can't reach rows the seed inserts
      // AFTER the migration has run.
      reviewStatus: 'approved',
    })
    .onConflictDoUpdate({
      target: wordPacks.slug,
      set: {
        name: packFile.name,
        description: packFile.description,
        category: packFile.category,
        language: packFile.language,
        // Re-seeding also heals an official pack that somehow ended up unapproved.
        reviewStatus: 'approved',
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!pack) {
    throw new Error(`Failed to upsert pack "${packFile.slug}"`);
  }

  const [beforeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wordPairs)
    .where(eq(wordPairs.packId, pack.id));
  const beforeTotal = beforeRow?.count ?? 0;

  if (packFile.pairs.length > 0) {
    await db
      .insert(wordPairs)
      .values(
        packFile.pairs.map((pair) => ({
          packId: pack.id,
          wordA: pair.wordA,
          wordB: pair.wordB,
          difficulty: pair.difficulty,
        })),
      )
      // Unique on (pack_id, word_a, word_b) — data-model.md §1. Existing
      // pairs are left untouched, even if their difficulty changed upstream;
      // that's an explicit editorial decision, not something re-seeding fixes.
      .onConflictDoNothing({ target: [wordPairs.packId, wordPairs.wordA, wordPairs.wordB] });
  }

  const [afterRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wordPairs)
    .where(eq(wordPairs.packId, pack.id));
  const afterTotal = afterRow?.count ?? 0;

  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wordPairs)
    .where(and(eq(wordPairs.packId, pack.id), eq(wordPairs.status, 'active')));
  const activeCount = activeRow?.count ?? 0;

  await db.update(wordPacks).set({ pairCount: activeCount }).where(eq(wordPacks.id, pack.id));

  const insertedCount = afterTotal - beforeTotal;
  return `${packFile.slug}: ${insertedCount} new pair(s) inserted, ${activeCount} active pair(s) total`;
}

async function main(): Promise<void> {
  const seedDir = resolveSeedDir();
  const packFiles = await loadPackFiles(seedDir);

  const db = getDb();
  for (const { file, data } of packFiles) {
    try {
      const summary = await seedPack(db, data);
      console.log(summary);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
    }
  }
  console.log(`Seeded ${packFiles.length} pack(s) from ${seedDir}`);
}

// Only run as a side effect when executed directly (`tsx scripts/seed.ts`),
// never when imported as a module — integration tests import `seedPack` /
// `loadPackFiles` / `resolveSeedDir` directly to exercise idempotency
// against fixture data without also triggering a real end-to-end run.
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main()
    .then(() => closeConnections())
    .catch(async (error: unknown) => {
      console.error('Seed failed:', error instanceof Error ? error.message : error);
      await closeConnections();
      process.exitCode = 1;
    });
}
