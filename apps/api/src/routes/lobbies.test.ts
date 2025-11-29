import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp } from '../test-support.js';

/**
 * `GET /v1/lobbies` behavioral coverage lives in matchmaking.test.ts (it needs
 * the socket + public-room machinery). This file isolates the one thing that
 * doesn't: the dedicated per-player browse limiter (`lobbiesRateLimit`), which
 * caps scraping of the public-room browser below the 60/min global limit.
 */
describe('GET /v1/lobbies', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('rate-limits the 21st lobby-browse request from the same player within a minute', async () => {
    // A fresh guest → fresh per-player limiter buckets; any authenticated caller
    // may browse, so a guest token is enough to exercise the limiter.
    const { token } = await createGuest(server);

    for (let i = 0; i < 20; i += 1) {
      const res = await server.inject({
        method: 'GET',
        url: '/v1/lobbies',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
    }

    // The 21st crosses the 20/min lobbies ceiling (well under the 60/min global),
    // so the dedicated limiter — not the global one — is what bites.
    const twentyFirst = await server.inject({
      method: 'GET',
      url: '/v1/lobbies',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(twentyFirst.statusCode).toBe(429);
    expect(twentyFirst.json().error.code).toBe('rate_limited');
  });
});
