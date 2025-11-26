import { randomUUID } from 'node:crypto';
import { makeSettings } from '@sketchy/engine/test-support';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { gamePlayers, games, players } from '../../src/db/schema.js';
import { buildServer } from '../../src/server.js';
import { createGuest, uniqueIp } from '../../src/test-support.js';

/**
 * Stats endpoints should hold p95 <50 ms against a 10k-game
 * seed. Seeds ~10k `games` rows (system-wide realistic volume) + their `game_players` rows,
 * gives ONE target player ("me") a realistic PERSONAL history (a few hundred games — nobody
 * plays 10k games themselves), then measures `GET /players/me/stats` and
 * `GET /players/me/games` latency against that seed, and asserts the driving query actually
 * uses `idx_gp_player` rather than a sequential scan of `game_players`.
 *
 * Note: this file's `beforeAll` recreates a large synthetic dataset directly against
 * whatever `sketchy_test` Postgres the api vitest project points at — running it
 * concurrently with another worktree's api test run WOULD corrupt both.
 *
 * Seeding ~10k games × ~4 participants each (~40k `game_players` rows) via naive
 * one-row-at-a-time inserts would dominate the run time, so everything below is
 * chunked-bulk-inserted; the seeding itself is not what's being measured (only the two
 * `server.inject()` loops below are timed).
 */

const TOTAL_GAMES = 10_000;
const FILLER_PLAYER_COUNT = 300;
const ME_GAME_COUNT = 200;
const PARTICIPANTS_PER_GAME = 4;
const CHUNK_SIZE = 1000;
const LATENCY_SAMPLES = 20;
const P95_BUDGET_MS = 50;

const BASE_ROLES = ['civilian', 'undercover', 'mrwhite'] as const;

async function insertChunked<T extends Record<string, unknown>>(
  table: Parameters<ReturnType<typeof getDb>['insert']>[0],
  rows: T[],
): Promise<void> {
  const db = getDb();
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    // `any` is fine here (test file — conventions.md §1 exempts test fixtures): this helper
    // bulk-inserts into three differently-shaped tables, and drizzle's per-table insert
    // typing doesn't factor through a single generic signature cleanly.
    await db.insert(table).values(chunk as any);
  }
}

function percentile(samplesMs: number[], p: number): number {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

describe('players/me stats + history — 10k-game volume', () => {
  let server: FastifyInstance;
  let meToken: string;
  let meId: string;

  beforeAll(async () => {
    server = await buildServer();
    const me = await createGuest(server, { displayName: 'VolumeTester' });
    meToken = me.token;
    meId = me.playerId;

    const fillerIds = Array.from({ length: FILLER_PLAYER_COUNT }, () => randomUUID());
    await insertChunked(
      players,
      fillerIds.map((id, i) => ({
        id,
        displayName: `Filler${String(i).padStart(4, '0')}`,
        isGuest: true,
      })),
    );

    const gameRows: (typeof games.$inferInsert)[] = [];
    const gamePlayerRows: (typeof gamePlayers.$inferInsert)[] = [];
    const settings = makeSettings();
    const now = Date.now();

    for (let g = 0; g < TOTAL_GAMES; g += 1) {
      const gameId = randomUUID();
      const includesMe = g < ME_GAME_COUNT;
      const others = new Set<string>();
      while (others.size < PARTICIPANTS_PER_GAME - (includesMe ? 1 : 0)) {
        others.add(fillerIds[Math.floor(Math.random() * fillerIds.length)]!);
      }
      const participantIds = includesMe ? [meId, ...others] : [...others];
      // A handful of abandoned games in the mix (winner_faction NULL) — realistic, and
      // exercises the "abandoned games don't inflate byRole/gamesPlayed" filter under load.
      const abandoned = g % 47 === 0;
      const winnerFaction = abandoned ? null : BASE_ROLES[g % BASE_ROLES.length];

      gameRows.push({
        id: gameId,
        roomCode: 'ABCJK',
        mode: 'online_private',
        hostPlayerId: participantIds[0],
        settings,
        civilianWord: 'Latte',
        undercoverWord: 'Espresso',
        roundsPlayed: 2 + (g % 4),
        winnerFaction: winnerFaction ?? undefined,
        // No `summary` — this perf test only exercises /stats and /games (the list), never
        // the per-game round-summary endpoint, so a large jsonb blob per row would only slow
        // down seeding for no measurement benefit.
        endedAt: new Date(now - g * 1000),
      });

      participantIds.forEach((playerId, seat) => {
        const role = BASE_ROLES[seat % BASE_ROLES.length]!;
        const won = !abandoned && role === winnerFaction;
        gamePlayerRows.push({
          gameId,
          playerId,
          seat,
          role,
          points: abandoned ? 0 : won ? 6 : 0,
          won: abandoned ? false : won,
          wasHost: seat === 0,
        });
      });
    }

    await insertChunked(games, gameRows);
    await insertChunked(gamePlayers, gamePlayerRows);
  }, 180_000);

  afterAll(async () => {
    await server.close();
  });

  it('GET /players/me/stats p95 < 50ms', async () => {
    const samples: number[] = [];
    // Sequential (not Promise.all) — this measures single-request latency, not throughput.
    for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
      const startedAt = performance.now();
      const res = await server.inject({
        method: 'GET',
        url: '/v1/players/me/stats',
        headers: { authorization: `Bearer ${meToken}` },
        remoteAddress: uniqueIp(),
      });
      samples.push(performance.now() - startedAt);
      expect(res.statusCode).toBe(200);
    }

    const p95 = percentile(samples, 95);
    console.log(
      `GET /players/me/stats p95=${p95.toFixed(1)}ms samples=${JSON.stringify(samples.map((s) => Math.round(s)))}`,
    );
    expect(p95).toBeLessThan(P95_BUDGET_MS);
  }, 30_000);

  it('GET /players/me/games (first page) p95 < 50ms', async () => {
    const samples: number[] = [];
    // Sequential (not Promise.all) — this measures single-request latency, not throughput.
    for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
      const startedAt = performance.now();
      const res = await server.inject({
        method: 'GET',
        url: '/v1/players/me/games?limit=20',
        headers: { authorization: `Bearer ${meToken}` },
        remoteAddress: uniqueIp(),
      });
      samples.push(performance.now() - startedAt);
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThan(0);
    }

    const p95 = percentile(samples, 95);
    console.log(
      `GET /players/me/games p95=${p95.toFixed(1)}ms samples=${JSON.stringify(samples.map((s) => Math.round(s)))}`,
    );
    expect(p95).toBeLessThan(P95_BUDGET_MS);
  }, 30_000);

  it('the driving game_players query uses idx_gp_player, not a sequential scan', async () => {
    const db = getDb();
    const result = await db.execute(
      sql`EXPLAIN (FORMAT JSON) SELECT * FROM game_players WHERE player_id = ${meId}::uuid`,
    );
    // node-postgres `QueryResult.rows` — one row, one column (`"QUERY PLAN"`) holding the
    // JSON-formatted plan tree.
    const rows = result.rows as { 'QUERY PLAN': unknown }[];
    const planText = JSON.stringify(rows[0]?.['QUERY PLAN']);
    expect(planText).not.toContain('Seq Scan on game_players');
    expect(planText).toContain('idx_gp_player');
  });
});
