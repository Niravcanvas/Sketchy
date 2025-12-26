import { writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearAllGraceTimers, stopAbandonSweeper } from '../../src/rooms/presence-timers.js';
import { buildServer } from '../../src/server.js';
import { setAckLatencyCollector } from '../bots/socket-bot.js';
import { closeTable, createTable, freshestState, playToGameOver, priority, type Table } from '../bots/table.js';

/**
 * Load smoke: 60 rooms × 8 bots (480 sockets) driven to
 * completion, asserting p95 action→snapshot latency < 150 ms, zero stuck rooms,
 * and flat memory across rounds. OPT-IN (`LOAD_SMOKE=1`) so the normal API suite
 * stays fast — it's a laptop smoke run, not a
 * per-commit gate. Scale is env-tunable (`LOAD_ROOMS`, `LOAD_BOTS`, `LOAD_ROUNDS`).
 *
 * Run:  ulimit -n 8192 && LOAD_SMOKE=1 pnpm --filter @sketchy/api exec vitest run test/load/load-smoke.test.ts
 */

const ROOMS = Number.parseInt(process.env.LOAD_ROOMS ?? '60', 10);
const BOTS = Number.parseInt(process.env.LOAD_BOTS ?? '8', 10);
const ROUNDS = Number.parseInt(process.env.LOAD_ROUNDS ?? '1', 10);
const BATCH = 12; // create rooms in batches to avoid a thundering-herd connect storm.

function heapMB(): number {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function createTablesBatched(server: FastifyInstance, baseUrl: string): Promise<Table[]> {
  const tables: Table[] = [];
  for (let i = 0; i < ROOMS; i += BATCH) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(BATCH, ROOMS - i) }, (_, j) =>
        createTable(server, baseUrl, {
          n: BOTS,
          namePrefix: `L${i + j}_`,
          settings: { clueTimerSec: 2, discussionTimerSec: 1, voteTimerSec: 2 },
        }),
      ),
    );
    tables.push(...batch);
  }
  return tables;
}

describe.skipIf(!process.env.LOAD_SMOKE)('load smoke', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ['GRACE_WINDOW_MS', 'ABANDON_MS']) saved[k] = process.env[k];
    process.env.GRACE_WINDOW_MS = '90000';
    process.env.ABANDON_MS = '600000';
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });
  afterAll(async () => {
    setAckLatencyCollector(null);
    clearAllGraceTimers();
    stopAbandonSweeper();
    await server.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it(
    `${ROOMS} rooms × ${BOTS} bots: p95 action→snapshot < 150ms, zero stuck rooms, flat memory`,
    async () => {
      const latencies: number[] = [];
      setAckLatencyCollector((ms) => latencies.push(ms));
      const heapTrend: Array<{ round: number; heapMB: number }> = [];
      let stuckRooms = 0;

      for (let round = 1; round <= ROUNDS; round += 1) {
        const roundStart = Date.now();
        const tables = await createTablesBatched(server, baseUrl);
        try {
          const finals = await Promise.all(
            tables.map((t) =>
              playToGameOver(t, { priority: priority.civilianWin, timeoutMs: 120_000, pollMs: 150 })
                .catch(() => null),
            ),
          );
          for (let i = 0; i < finals.length; i += 1) {
            const final = finals[i];
            if (!final || final.phase !== 'game_over') {
              stuckRooms += 1;
              console.warn(`stuck room: ${freshestState(tables[i]!).phase}`);
            }
          }
        } finally {
          for (const t of tables) closeTable(t);
        }
        // Between rounds, drain the grace timers the closed bots armed (in
        // production a 90s grace self-clears; here rounds are seconds apart, so
        // without this they'd pile up as retained setTimeout closures and read as
        // a "leak" that isn't one). Then GC (needs --expose-gc) for a true heap read.
        clearAllGraceTimers();
        global.gc?.();
        heapTrend.push({ round, heapMB: heapMB() });
        console.log(`round ${round}: ${tables.length} games in ${Date.now() - roundStart}ms, heap ${heapMB()}MB`);
      }

      setAckLatencyCollector(null);
      const sorted = [...latencies].sort((a, b) => a - b);
      const stats = {
        sockets: ROOMS * BOTS,
        rounds: ROUNDS,
        actionsMeasured: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.at(-1) ?? 0,
        stuckRooms,
        heapTrend,
      };
      console.log('LOAD SMOKE RESULTS', JSON.stringify(stats, null, 2));
      // vitest buffers test-file console output behind the pino flood, so also
      // write the numbers to a file for the PR/handoff record.
      if (process.env.LOAD_SMOKE_OUT) {
        writeFileSync(process.env.LOAD_SMOKE_OUT, JSON.stringify(stats, null, 2));
      }

      expect(stuckRooms).toBe(0);
      expect(stats.p95).toBeLessThan(150);
      // Memory flat: last round's heap must not balloon vs the first (allow 2× headroom
      // for lazy allocation / fragmentation; a leak would grow unbounded across rounds).
      if (heapTrend.length > 1) {
        expect(heapTrend.at(-1)!.heapMB).toBeLessThan(heapTrend[0]!.heapMB * 2 + 50);
      }
    },
    600_000,
  );
});
