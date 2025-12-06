#!/usr/bin/env node
/**
 * Proves `packages/engine` and
 * `packages/shared` bundle cleanly for a React Native / Metro-style target —
 * no DOM globals, no Node built-ins leaking into code the future mobile app
 * (and today's pass-and-play, which already imports the engine straight into
 * the browser — api-contract.md §3) needs to import unmodified.
 *
 * Method: bundle EVERY non-test `.ts` file under each package's `src/` as its
 * own esbuild entry point with `platform: 'neutral'` (esbuild's stance for
 * "don't assume Node OR a browser exist" — the closest built-in proxy for a
 * Metro/Hermes runtime) and `bundle: true` (so it actually walks and
 * resolves every import, not just transpiles syntax). `node:*`-scheme
 * imports are ONLY auto-external under `platform: 'node'`; under `neutral`
 * esbuild tries to actually resolve them, fails (no such package on disk),
 * and the build errors — exactly the "did a Node built-in leak in here"
 * signal this check exists to catch. Every source file gets its own entry
 * (rather than one barrel) because both packages export via a wildcard
 * (`"./*": "./src/*.ts"`, no single barrel file) — any of these files can be
 * the thing an RN app imports directly.
 *
 * This is a real, if imperfect, proxy for "does Metro's bundler accept this"
 * — it is not literally Metro (no Expo/RN project exists in this repo; an
 * actual React Native app remains out of scope), but it exercises the
 * identical failure mode (an unresolvable platform-specific import) with
 * zero new app scaffolding.
 * DOM-global usage (referencing `window`/`document`/`localStorage` as bare
 * identifiers, as opposed to importing them) is a different failure mode
 * esbuild bundling can't catch by itself — a valid *reference* to an
 * undefined global is not a bundle-time error, only a runtime one — so that
 * half is covered separately by `packages/config/eslint.config.mjs`'s
 * `no-restricted-imports` purity rules for `packages/engine/**` and
 * `packages/shared/**`, plus a manual grep sweep for stray DOM-global
 * references.
 */
import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

/** Packages this check covers (engine + shared only —
 * NOT apps/web, apps/api, which are legitimately platform-specific). */
const TARGET_PACKAGES = ['packages/engine', 'packages/shared'];

/** Leaf npm dependencies these packages use — left unbundled (external)
 * since their OWN RN-safety is a separately-vetted, widely-used-package
 * concern, not something this repo's source audit needs to re-prove. Keep in
 * sync with `packages/engine/package.json` (currently zero runtime deps) and
 * `packages/shared/package.json` ("dependencies"). */
const EXTERNAL_DEPENDENCIES = ['zod'];

function collectEntryPoints(srcDir) {
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        entries.push(full);
      }
    }
  };
  walk(srcDir);
  return entries;
}

async function main() {
  const entryPoints = TARGET_PACKAGES.flatMap((pkg) =>
    collectEntryPoints(join(rootDir, pkg, 'src')),
  );

  console.log(
    `check:rn-build — bundling ${entryPoints.length} source file(s) across ` +
      `${TARGET_PACKAGES.join(', ')} with platform:'neutral' (React-Native-safe proxy)...`,
  );

  try {
    await build({
      entryPoints,
      bundle: true,
      write: false,
      // Multiple entry points require `outdir` (rather than `outfile`) even
      // with `write: false` — esbuild uses it only to compute each output's
      // in-memory path; nothing is ever written to disk.
      outdir: 'out',
      platform: 'neutral',
      format: 'esm',
      target: 'es2022',
      logLevel: 'silent',
      external: EXTERNAL_DEPENDENCIES,
    });
  } catch (error) {
    console.error(
      '\ncheck:rn-build FAILED — packages/engine or packages/shared references something ' +
        "that doesn't resolve for a platform-neutral (React Native / Metro) target. This " +
        'usually means a Node built-in (fs, path, node:crypto, ...) leaked into portable ' +
        'code; see arch/mobile-notes.md and plan/phase17-handoff.md for context.\n',
    );
    console.error(error.message ?? error);
    process.exitCode = 1;
    return;
  }

  console.log(
    'check:rn-build OK — packages/engine and packages/shared bundle cleanly for a ' +
      'platform-neutral target (zero patches needed).',
  );
}

await main();
