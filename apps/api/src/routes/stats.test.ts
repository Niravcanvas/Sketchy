import { randomUUID } from 'node:crypto';
import { makeSettings } from '@sketchy/engine/test-support';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/client.js';
import { games } from '../db/schema.js';
import { buildServer } from '../server.js';
import { uniqueIp } from '../test-support.js';

/**
 * `GET /v1/stats/games-today` (api-contract.md §1 "Ops", post-launch-backlog.md item 4) —
 * the public, unauthenticated counterpart to `GET /v1/admin/stats`. Covers the three things
 * that make it safe to expose with no `requireAuth`: the response shape is EXACTLY
 * `{ gamesToday }` (nothing else leaks), it's reachable with no Authorization header at all,
 * and it's protected by its own per-IP limiter (`statsRateLimit`) rather than relying solely
 * on the 60/min global. `GET /v1/admin/stats` itself is covered by
 * `test/observability/admin-stats.test.ts` and is untouched by this change.
 */
describe('GET /v1/stats/games-today', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns exactly { gamesToday } with no Authorization header', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/stats/games-today',
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['gamesToday']);
    expect(typeof body.gamesToday).toBe('number');
    expect(body.gamesToday as number).toBeGreaterThanOrEqual(0);
    // Never leaks the admin-only operational gauges, even by accident.
    expect(body).not.toHaveProperty('roomsActive');
    expect(body).not.toHaveProperty('socketsConnected');
    expect(body).not.toHaveProperty('actionsPerMin');
  });

  it('counts a game started today, exactly like GET /v1/admin/stats does', async () => {
    const before = await server.inject({
      method: 'GET',
      url: '/v1/stats/games-today',
      remoteAddress: uniqueIp(),
    });
    const countBefore = (before.json() as { gamesToday: number }).gamesToday;

    // Inserted directly (no REST route persists a `games` row short of playing a full game
    // through sockets) — `startedAt` defaults to `now()`, same as a real game start.
    await getDb()
      .insert(games)
      .values({
        id: randomUUID(),
        roomCode: 'STATS1',
        mode: 'online_private',
        settings: makeSettings(),
        civilianWord: 'Latte',
        undercoverWord: 'Espresso',
      });

    const after = await server.inject({
      method: 'GET',
      url: '/v1/stats/games-today',
      remoteAddress: uniqueIp(),
    });
    const countAfter = (after.json() as { gamesToday: number }).gamesToday;

    expect(countAfter).toBe(countBefore + 1);
  });

  it('rate-limits the 21st request from the same IP within a minute', async () => {
    const ip = uniqueIp();

    for (let i = 0; i < 20; i += 1) {
      const res = await server.inject({ method: 'GET', url: '/v1/stats/games-today', remoteAddress: ip });
      expect(res.statusCode).toBe(200);
    }

    const twentyFirst = await server.inject({
      method: 'GET',
      url: '/v1/stats/games-today',
      remoteAddress: ip,
    });
    expect(twentyFirst.statusCode).toBe(429);
    expect(twentyFirst.json()).toEqual({
      error: { code: 'rate_limited', message: 'Easy there. Give it a few seconds and try again.' },
    });
  });

  it('is registered under the OpenAPI doc as a public path', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/openapi.json' });
    const doc = res.json() as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty('/v1/stats/games-today');
  });
});
