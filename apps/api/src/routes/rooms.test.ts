import { createGame } from '@sketchy/engine/create-game';
import type { GamePlayer, GameSettings } from '@sketchy/engine/types';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@sketchy/shared/room-code';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocateRoomCode } from '../rooms/room-codes.js';
import { createRoom } from '../rooms/room-store.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp } from '../test-support.js';

const DEFAULT_AVATAR = { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' } as const;

function fakePlayer(id: string, name: string, seat: number): GamePlayer {
  return {
    id,
    name,
    avatar: DEFAULT_AVATAR,
    seat,
    connected: true,
    isReady: false,
    hasSeenWord: false,
    alive: true,
    eliminatedRound: null,
    role: null,
    word: null,
    specialRole: null,
    usedSpecialPower: false,
    hasLeft: false,
  };
}

describe('rooms REST endpoints', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('POST /v1/rooms', () => {
    it('creates a room with a well-formed code and a joinUrl pointing at it', async () => {
      const { token } = await createGuest(server);
      const res = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
        remoteAddress: uniqueIp(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.code).toHaveLength(ROOM_CODE_LENGTH);
      for (const char of body.code as string) {
        expect(ROOM_CODE_ALPHABET.includes(char)).toBe(true);
      }
      expect(body.joinUrl.endsWith(`/r/${body.code}`)).toBe(true);
    });

    it('rejects with 401 when unauthenticated', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        payload: {},
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(401);
    });

    it('merges a custom maxPlayers setting over the defaults', async () => {
      const { token } = await createGuest(server);
      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${token}` },
        payload: { settings: { maxPlayers: 6 } },
        remoteAddress: uniqueIp(),
      });
      expect(createRes.statusCode).toBe(200);
      const { code } = createRes.json();

      const getRes = await server.inject({
        method: 'GET',
        url: `/v1/rooms/${code}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().maxPlayers).toBe(6);
    });

    it('rejects settings that fail engine lobby validation', async () => {
      const { token } = await createGuest(server);
      const res = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${token}` },
        // maxPlayers 2 with the default undercoverCount 1 fails role-math
        // (isValidRoleMath: total must be < ceil(playerCount/2)).
        payload: { settings: { maxPlayers: 2 } },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation');
    });

    it('rate-limits the 6th room creation from the same player within a minute', async () => {
      const { token } = await createGuest(server);

      for (let i = 0; i < 5; i += 1) {
        const res = await server.inject({
          method: 'POST',
          url: '/v1/rooms',
          headers: { authorization: `Bearer ${token}` },
          payload: {},
          remoteAddress: uniqueIp(),
        });
        expect(res.statusCode).toBe(200);
      }

      const sixth = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
        remoteAddress: uniqueIp(),
      });
      expect(sixth.statusCode).toBe(429);
      expect(sixth.json().error.code).toBe('rate_limited');
    });
  });

  describe('GET /v1/rooms/:code', () => {
    it('a fresh lobby the caller has not joined: canJoin true, canRejoin false', async () => {
      const host = await createGuest(server, { displayName: 'Host' });
      const stranger = await createGuest(server, { displayName: 'Stranger' });

      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${host.token}` },
        payload: {},
        remoteAddress: uniqueIp(),
      });
      const { code } = createRes.json();

      const res = await server.inject({
        method: 'GET',
        url: `/v1/rooms/${code}`,
        headers: { authorization: `Bearer ${stranger.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.canJoin).toBe(true);
      expect(body.canRejoin).toBe(false);
      expect(body.phase).toBe('lobby');
      expect(body.playerCount).toBe(1);
      expect(body.hostName).toBe('Host');
    });

    it('the creator (host, already seated): canRejoin true', async () => {
      const host = await createGuest(server, { displayName: 'HostTwo' });
      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${host.token}` },
        payload: {},
        remoteAddress: uniqueIp(),
      });
      const { code } = createRes.json();

      const res = await server.inject({
        method: 'GET',
        url: `/v1/rooms/${code}`,
        headers: { authorization: `Bearer ${host.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.canRejoin).toBe(true);
      expect(body.canJoin).toBe(false); // already seated
    });

    it('an unknown code 404s with the room_not_found envelope', async () => {
      const { token } = await createGuest(server);
      const res = await server.inject({
        method: 'GET',
        url: '/v1/rooms/ZZZZZ',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('room_not_found');
    });

    it('a room already at maxPlayers: canJoin false for a caller not seated', async () => {
      const code = await allocateRoomCode();
      if (!code) throw new Error('allocateRoomCode failed');

      const settings: GameSettings = {
        maxPlayers: 3,
        undercoverCount: 1,
        mrWhiteCount: 0,
        specialRoles: [],
        packIds: [],
        difficulties: ['easy', 'medium', 'hard'],
        clueTimerSec: 60,
        discussionTimerSec: 120,
        voteTimerSec: 45,
        mrWhiteFirstClueBan: true,
        eliminationReveal: 'role',
      };
      const fullPlayers = [
        fakePlayer('11111111-1111-4111-8111-111111111111', 'Alpha', 0),
        fakePlayer('22222222-2222-4222-8222-222222222222', 'Bravo', 1),
        fakePlayer('33333333-3333-4333-8333-333333333333', 'Charlie', 2),
      ];
      const state = { ...createGame(settings, fullPlayers, 'seed', Date.now()), mode: 'online_private' as const, code };
      const created = await createRoom(code, state);
      expect(created).toBe(true);

      const { token } = await createGuest(server, { displayName: 'LateComer' });
      const res = await server.inject({
        method: 'GET',
        url: `/v1/rooms/${code}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.canJoin).toBe(false);
      expect(body.playerCount).toBe(3);
      expect(body.maxPlayers).toBe(3);
    });
  });

  describe('GET /v1/rooms/:code/voice-token', () => {
    const originalVoiceEnabled = process.env.VOICE_ENABLED;

    afterEach(() => {
      if (originalVoiceEnabled === undefined) {
        delete process.env.VOICE_ENABLED;
      } else {
        process.env.VOICE_ENABLED = originalVoiceEnabled;
      }
    });

    it('mints a token + url for a seated member', async () => {
      const host = await createGuest(server, { displayName: 'VoiceHost' });
      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${host.token}` },
        payload: {},
        remoteAddress: uniqueIp(),
      });
      const { code } = createRes.json();

      const res = await server.inject({
        method: 'GET',
        url: `/v1/rooms/${code}/voice-token`,
        headers: { authorization: `Bearer ${host.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
      expect(typeof body.url).toBe('string');
      // A JWT is three dot-separated base64url segments.
      expect(body.token.split('.')).toHaveLength(3);
    });

    it('rejects a non-member with room_not_found (existence-hiding)', async () => {
      const host = await createGuest(server, { displayName: 'VoiceHost2' });
      const stranger = await createGuest(server, { displayName: 'VoiceStranger' });
      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${host.token}` },
        payload: {},
        remoteAddress: uniqueIp(),
      });
      const { code } = createRes.json();

      const res = await server.inject({
        method: 'GET',
        url: `/v1/rooms/${code}/voice-token`,
        headers: { authorization: `Bearer ${stranger.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('room_not_found');
    });

    it('rejects an unauthenticated caller with 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/v1/rooms/AB2CD/voice-token',
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(401);
    });

    it('404s an unknown room code', async () => {
      const { token } = await createGuest(server, { displayName: 'VoiceHost3' });
      const res = await server.inject({
        method: 'GET',
        url: '/v1/rooms/ZZZZZ/voice-token',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('room_not_found');
    });

    it('the VOICE_ENABLED kill-switch returns a clean voice_disabled 403', async () => {
      const host = await createGuest(server, { displayName: 'VoiceHost4' });
      const createRes = await server.inject({
        method: 'POST',
        url: '/v1/rooms',
        headers: { authorization: `Bearer ${host.token}` },
        payload: {},
        remoteAddress: uniqueIp(),
      });
      const { code } = createRes.json();

      process.env.VOICE_ENABLED = 'false';
      const res = await server.inject({
        method: 'GET',
        url: `/v1/rooms/${code}/voice-token`,
        headers: { authorization: `Bearer ${host.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('voice_disabled');
    });
  });
});
