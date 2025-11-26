import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { createGuest, uniqueIp } from '../../src/test-support.js';

/**
 * `GET /v1/admin/stats` (api-contract.md §1): admin-token
 * gated operational gauges. Driven via `.inject()` — pure REST, no sockets. The
 * dev default `ADMIN_TOKEN` is `dev-only-change-me`.
 */
describe('GET /v1/admin/stats', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('rejects a request with no admin token', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/admin/stats' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('rejects a wrong admin token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization: 'Bearer not-the-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns count-only gauges with the admin token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization: 'Bearer dev-only-change-me' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'actionsPerMin',
      'gamesToday',
      'roomsActive',
      'socketsConnected',
    ]);
    for (const value of Object.values(body)) {
      expect(typeof value).toBe('number');
    }
  });

  it('counts a freshly created room in roomsActive', async () => {
    const guest = await createGuest(server, { displayName: 'Ops', ip: uniqueIp() });
    const before = await server.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization: 'Bearer dev-only-change-me' },
    });
    const roomsBefore = (before.json() as { roomsActive: number }).roomsActive;

    const created = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });
    expect(created.statusCode).toBe(200);

    const after = await server.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization: 'Bearer dev-only-change-me' },
    });
    const roomsAfter = (after.json() as { roomsActive: number }).roomsActive;
    expect(roomsAfter).toBeGreaterThan(roomsBefore);
  });
});
