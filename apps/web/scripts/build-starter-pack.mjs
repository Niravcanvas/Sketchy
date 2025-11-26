#!/usr/bin/env node
// Builds apps/web/src/data/starter-pack.json — the curated offline word subset for
// pass-and-play (plan/phase3.md task 8). Plain node, no deps.
//
// Selection is deterministic: for each official pack (in the fixed order below), take the
// first N pairs per difficulty *in authored order* from apps/api/seed/packs/<slug>.json.
// Packs author their strongest/most approachable pairs first within each difficulty tier
// specifically so this slice picks up the best material. Ratio target: ~24 easy / 24 medium
// / 12 hard across 60 pairs total (offline pass-and-play favors approachable pairs).
//
// Run: node apps/web/scripts/build-starter-pack.mjs  (or `pnpm build:starter-pack`)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '../../api/seed/packs');
const OUT_FILE = path.resolve(__dirname, '../src/data/starter-pack.json');

// Official pack order, matching the table in plan/phase3.md / arch/copy.md §13.
// easyCount + mediumCount are the same for every pack (3 + 3 = 24 + 24 across 8 packs);
// hardCount varies per pack so the 8 packs sum to exactly 12 hard pairs (not evenly
// divisible by 8) while every pack still contributes at least one hard pair.
const PACKS = [
  { slug: 'food-drink', easyCount: 3, mediumCount: 3, hardCount: 2 },
  { slug: 'animals', easyCount: 3, mediumCount: 3, hardCount: 2 },
  { slug: 'objects', easyCount: 3, mediumCount: 3, hardCount: 2 },
  { slug: 'jobs', easyCount: 3, mediumCount: 3, hardCount: 2 },
  { slug: 'screens-series', easyCount: 3, mediumCount: 3, hardCount: 1 },
  { slug: 'tech', easyCount: 3, mediumCount: 3, hardCount: 1 },
  { slug: 'travel-places', easyCount: 3, mediumCount: 3, hardCount: 1 },
  { slug: 'feelings', easyCount: 3, mediumCount: 3, hardCount: 1 },
];

/** Reads and parses one seed pack JSON file by slug. */
function loadPack(slug) {
  const file = path.join(SEED_DIR, `${slug}.json`);
  const raw = readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

/** Returns the first `count` pairs of `difficulty`, in authored (file) order. */
function takeByDifficulty(pairs, difficulty, count) {
  return pairs
    .filter((pair) => pair.difficulty === difficulty)
    .slice(0, count)
    .map(({ wordA, wordB, difficulty }) => ({ wordA, wordB, difficulty }));
}

function buildStarterPack() {
  const byPackDifficulty = { easy: [], medium: [], hard: [] };

  for (const { slug, easyCount, mediumCount, hardCount } of PACKS) {
    const pack = loadPack(slug);
    byPackDifficulty.easy.push(...takeByDifficulty(pack.pairs, 'easy', easyCount));
    byPackDifficulty.medium.push(...takeByDifficulty(pack.pairs, 'medium', mediumCount));
    byPackDifficulty.hard.push(...takeByDifficulty(pack.pairs, 'hard', hardCount));
  }

  // Final order: easy (pack order) -> medium (pack order) -> hard (pack order).
  const pairs = [...byPackDifficulty.easy, ...byPackDifficulty.medium, ...byPackDifficulty.hard];

  const starterPack = {
    name: 'Starter pack',
    language: 'en',
    pairs,
  };

  writeFileSync(OUT_FILE, JSON.stringify(starterPack, null, 2) + '\n', 'utf8');

  const easy = pairs.filter((p) => p.difficulty === 'easy').length;
  const medium = pairs.filter((p) => p.difficulty === 'medium').length;
  const hard = pairs.filter((p) => p.difficulty === 'hard').length;
  console.log(
    `Wrote ${pairs.length} pairs to ${path.relative(process.cwd(), OUT_FILE)} ` +
      `(easy=${easy} medium=${medium} hard=${hard})`,
  );
}

buildStarterPack();
