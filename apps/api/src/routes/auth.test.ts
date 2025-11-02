import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGuest, uniqueIp } from '../test-support.js';
import { buildServer } from '../server.js';

describe('POST /v1/auth/guest', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('creates a guest player and the token round-trips through GET /players/me', async () => {
    const { token, playerId } = await createGuest(server, { displayName: 'Sam' });
    expect(playerId).toMatch(/^[0-9a-f-]{36}$/);

    const meRes = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });

    expect(meRes.statusCode).toBe(200);
    const body = meRes.json();
    expect(body.player.id).toBe(playerId);
    expect(body.player.displayName).toBe('Sam');
    expect(body.player.isGuest).toBe(true);
    expect(body.player.avatar).toEqual({
      head: 'round',
      face: 'smile',
      accessory: 'none',
      inkColor: 'ink',
    });
    expect(typeof body.player.createdAt).toBe('number');
  });

  it('rejects a profanity-laden display name with the 400 profanity envelope', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { displayName: 'ass' },
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'profanity', message: "Let's keep it printable. Try different words." },
    });
  });

  it('rejects a too-short display name with a validation error', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { displayName: 'a' },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('rate-limits the 6th guest-creation from the same IP within a minute', async () => {
    const ip = uniqueIp();

    for (let i = 0; i < 5; i += 1) {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/guest',
        payload: { displayName: `Guest${i}` },
        remoteAddress: ip,
      });
      expect(res.statusCode).toBe(200);
    }

    const sixth = await server.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { displayName: 'GuestSix' },
      remoteAddress: ip,
    });

    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual({
      error: { code: 'rate_limited', message: 'Easy there. Give it a few seconds and try again.' },
    });
  });
});
