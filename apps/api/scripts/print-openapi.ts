import { writeFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';

/** Recursively sorts every object's keys (arrays keep their original order —
 * order is semantically meaningful there, e.g. `required` field lists) so two
 * runs of this script over an unchanged schema produce byte-identical output,
 * independent of Zod/route registration order. A plain `JSON.stringify`
 * array-replacer only filters/orders TOP-level keys — it silently drops any
 * nested key absent from that top-level list, which would corrupt a spec
 * this deeply nested — so this walks the whole tree instead. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Prints the live `/v1` OpenAPI 3.1 document (generated from the
 * `packages/shared` Zod schemas via `fastify-type-provider-zod` +
 * `@fastify/swagger`, wired in `server.ts`) — same shape `GET
 * /v1/openapi.json` serves, produced in-process instead of over HTTP so this
 * script needs no listening port and no polling for readiness.
 *
 * Writes to the path given as `argv[2]`, or stdout if omitted. Writing
 * directly to a file (rather than relying on shell stdout redirection) sidesteps
 * `pnpm run`'s own banner lines ("> @sketchy/api@0.0.0 print:openapi ...")
 * landing in the same stream and corrupting the JSON — a real footgun the
 * hard way (`pnpm print:openapi > out.json` captures the banner too; `pnpm
 * print:openapi out.json` does not).
 *
 * Two consumers (arch/api-contract.md §0, §4 contract-change checklist):
 *   1. Regenerating `arch/openapi-v1.baseline.json`, the committed snapshot
 *      the `contract-v1.0.0` tag freezes — an intentional update, run by a
 *      human reviewing a real additive contract change:
 *        `pnpm --filter @sketchy/api print:openapi ../../arch/openapi-v1.baseline.json`
 *   2. The CI breaking-change gate job (`.github/workflows/ci.yml`
 *      `contract-verification`), which writes this same output to a
 *      throwaway file and diffs it against the committed baseline via
 *      `oasdiff` — any resolution/env difference between this script's output
 *      and the baseline's would show up as false-positive diff noise, so both
 *      are generated the SAME way (this script, `PUBLIC_API_URL` unset so
 *      `servers` stays `[]` — see `server.ts`).
 *
 * Requires `DATABASE_URL`/`REDIS_URL` reachable (the same dependencies
 * `buildServer()` always needs — the Socket.IO Redis adapter opens real
 * connections during registration; api-contract.md is silent on this but
 * `sockets/index.ts` is not) — sorted-key JSON output makes the committed
 * baseline diff-friendly and independent of Zod/route registration order.
 *
 * Explicit `process.exit(0)` at the end: `server.close()` resolves once
 * Fastify's own listeners/plugins tear down, but this process is never
 * actually `listen()`-ing (no `index.ts` involved) — the Socket.IO Redis
 * adapter's duplicated `ioredis` connections and Postgres pool are
 * long-lived singletons (`db/client.ts`) with no `onClose` hook wired here to
 * release them, so Node's event loop never drains on its own. Letting the
 * process hang is exactly the kind of thing that silently wedges a CI job.
 */
async function main(): Promise<void> {
  const outPath = process.argv[2];
  console.error(`[DEBUG] argv: [${process.argv.join(', ')}]`);
  console.error(`[DEBUG] outPath: ${outPath}`);

  const server = await buildServer();
  await server.ready();
  const spec: unknown = server.swagger();
  const json = `${JSON.stringify(sortKeysDeep(spec), null, 2)}\n`;

  if (outPath) {
    console.error(`[DEBUG] writing to ${outPath}`);
    writeFileSync(outPath, json, 'utf8');
    console.error(`[DEBUG] write complete`);
  } else {
    process.stdout.write(json);
  }
  await server.close();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
