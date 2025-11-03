import { randomUUID } from 'node:crypto';
import { makeSettings, makeState } from '@sketchy/engine/test-support';
import type { GameState } from '@sketchy/engine/types';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/client.js';
import { gamePlayers, games, players } from '../db/schema.js';
import { getEnv } from '../env.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

const TTL_SECONDS = 180 * 24 * 60 * 60;

async function signRawToken(
  secret: string,
  playerId: string,
  opts: { iat?: number; exp?: number; guest?: boolean } = {},
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ guest: opts.guest ?? true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(playerId)
    .setIssuedAt(opts.iat ?? nowSeconds)
    .setExpirationTime(opts.exp ?? nowSeconds + TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

describe('GET /v1/players/me', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('401s with no Authorization header at all', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('401s on a malformed/garbage token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: 'Bearer not-a-real-jwt' },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('401s on an expired token', async () => {
    const { playerId } = await createGuest(server);
    const env = getEnv();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = await signRawToken(env.jwtSecret ?? '', playerId, {
      iat: nowSeconds - TTL_SECONDS - 10,
      exp: nowSeconds - 10,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${expired}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('401s when the token references a player row that no longer exists', async () => {
    const env = getEnv();
    const bogusPlayerId = '00000000-0000-4000-8000-000000000000';
    const token = await signRawToken(env.jwtSecret ?? '', bogusPlayerId);

    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('sets X-Refreshed-Token when the token is past its halfway point', async () => {
    const { playerId } = await createGuest(server);
    const env = getEnv();
    const nowSeconds = Math.floor(Date.now() / 1000);
    // 100 days old: past the 90-day halfway mark, still short of the 180-day expiry.
    const oldToken = await signRawToken(env.jwtSecret ?? '', playerId, {
      iat: nowSeconds - 100 * 24 * 60 * 60,
      exp: nowSeconds - 100 * 24 * 60 * 60 + TTL_SECONDS,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${oldToken}` },
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-refreshed-token']).toBeTypeOf('string');
    expect(res.headers['x-refreshed-token']).not.toBe(oldToken);
  });

  it('does NOT set X-Refreshed-Token for a fresh token', async () => {
    const { token } = await createGuest(server);

    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-refreshed-token']).toBeUndefined();
  });

  it('accepts a token signed with JWT_SECRET_PREVIOUS during a rotation window', async () => {
    const { playerId } = await createGuest(server);
    const previousSecret = 'previous-rotation-secret';
    process.env.JWT_SECRET_PREVIOUS = previousSecret;
    try {
      const token = await signRawToken(previousSecret, playerId);
      const res = await server.inject({
        method: 'GET',
        url: '/v1/players/me',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().player.id).toBe(playerId);
    } finally {
      delete process.env.JWT_SECRET_PREVIOUS;
    }
  });

  it('rejects a token signed with an unknown secret even if JWT_SECRET_PREVIOUS is unset', async () => {
    const { playerId } = await createGuest(server);
    const token = await signRawToken('some-other-secret-entirely', playerId);
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/players/me', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('updates displayName only', async () => {
    const { token } = await createGuest(server, { displayName: 'Original' });
    const res = await server.inject({
      method: 'PATCH',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'Renamed' },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().player.displayName).toBe('Renamed');
  });

  it('updates avatar only', async () => {
    const { token } = await createGuest(server);
    const newAvatar = {
      head: 'square',
      face: 'grin',
      accessory: 'glasses',
      inkColor: 'undercover',
    };
    const res = await server.inject({
      method: 'PATCH',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatar: newAvatar },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().player.avatar).toEqual(newAvatar);
  });

  it('rejects a profanity display name with 400 profanity', async () => {
    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'PATCH',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'hell' },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('profanity');
  });

  it('rejects an invalid avatar (missing field) with a validation error', async () => {
    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'PATCH',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatar: { head: 'round', face: 'smile', accessory: 'none' } },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('rejects a too-long display name with a validation error', async () => {
    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'PATCH',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'x'.repeat(21) },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('401s without a token', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/v1/players/me',
      payload: { displayName: 'Nope' },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/players/me/stats, GET /v1/players/me/games, GET /v1/players/me/games/:gameId
// ("the scrapbook"). These insert `games`/`game_players` rows directly
// rather than driving a real socket game to completion (that path is already exhaustively
// covered by `sockets/vote.test.ts`'s `waitForPersistedGames` assertions) — this file only
// needs to prove the READ layer shapes/redacts/paginates correctly over rows that already
// look like what `rooms/persist-game.ts` would have written.
// ---------------------------------------------------------------------------

/** Mirrors `rooms/persist-game.ts`'s `computeGamePoints`/lifetime-bump shape closely enough
 * for read-layer tests: inserts one `games` row + a `game_players` row per participant, and
 * — for a FINISHED game only (`winnerFaction !== null`) — bumps the subject player's
 * denormalized `players` totals the same way `persistFinishedGame`'s transaction does. Never
 * bumps totals for an abandoned game (`winnerFaction: null`), matching `persistAbandonedGame`.
 */
async function insertGameRow(opts: {
  subjectPlayerId: string;
  subjectRole: 'civilian' | 'undercover' | 'mrwhite';
  subjectPoints: number;
  subjectWon: boolean;
  winnerFaction: 'civilian' | 'undercover' | 'mrwhite' | 'infiltrators' | null;
  roomCode?: string;
  civilianWord?: string;
  undercoverWord?: string;
  roundsPlayed?: number;
  endedAt?: Date;
  otherPlayerIds?: string[];
  summary?: GameState;
}): Promise<string> {
  const db = getDb();
  const gameId = randomUUID();
  const roomCode = opts.roomCode ?? 'ABCJK';
  const civilianWord = opts.civilianWord ?? 'Latte';
  const undercoverWord = opts.undercoverWord ?? 'Espresso';

  await db.insert(games).values({
    id: gameId,
    roomCode,
    mode: 'online_private',
    hostPlayerId: opts.subjectPlayerId,
    settings: makeSettings(),
    civilianWord,
    undercoverWord,
    roundsPlayed: opts.roundsPlayed ?? 2,
    winnerFaction: opts.winnerFaction ?? undefined,
    summary: (opts.summary ?? undefined) as unknown as Record<string, unknown>,
    endedAt: opts.endedAt ?? new Date(),
  });

  await db.insert(gamePlayers).values([
    {
      gameId,
      playerId: opts.subjectPlayerId,
      seat: 0,
      role: opts.subjectRole,
      points: opts.subjectPoints,
      won: opts.subjectWon,
      wasHost: true,
    },
    ...(opts.otherPlayerIds ?? []).map((playerId, index) => ({
      gameId,
      playerId,
      seat: index + 1,
      role: 'civilian' as const,
      points: 0,
      won: false,
      wasHost: false,
    })),
  ]);

  if (opts.winnerFaction !== null) {
    // SQL-increment (not a flat `set`) so a test inserting several finished games for the
    // same subject player accumulates correctly — the exact bump `persist-game.ts` does.
    await db
      .update(players)
      .set({
        totalPoints: sql`${players.totalPoints} + ${opts.subjectPoints}`,
        gamesPlayed: sql`${players.gamesPlayed} + 1`,
        gamesWon: sql`${players.gamesWon} + ${opts.subjectWon ? 1 : 0}`,
      })
      .where(eq(players.id, opts.subjectPlayerId));
  }

  return gameId;
}

describe('GET /v1/players/me/stats', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('401s without a token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/stats',
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns all-zero totals and byRole for a brand new player', async () => {
    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/stats',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      totalPoints: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      byRole: {
        civilian: { played: 0, won: 0, points: 0 },
        undercover: { played: 0, won: 0, points: 0 },
        mrwhite: { played: 0, won: 0, points: 0 },
      },
    });
  });

  it('aggregates finished games by role and excludes abandoned games from both header and byRole', async () => {
    const { token, playerId } = await createGuest(server);

    await insertGameRow({
      subjectPlayerId: playerId,
      subjectRole: 'undercover',
      subjectPoints: 10,
      subjectWon: true,
      winnerFaction: 'undercover',
    });
    await insertGameRow({
      subjectPlayerId: playerId,
      subjectRole: 'civilian',
      subjectPoints: 2,
      subjectWon: true,
      winnerFaction: 'civilian',
    });
    // Abandoned: has a game_players row (it happened) but must not count toward totals.
    await insertGameRow({
      subjectPlayerId: playerId,
      subjectRole: 'mrwhite',
      subjectPoints: 0,
      subjectWon: false,
      winnerFaction: null,
    });

    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/stats',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalPoints).toBe(12);
    expect(body.gamesPlayed).toBe(2);
    expect(body.gamesWon).toBe(2);
    expect(body.byRole).toEqual({
      civilian: { played: 1, won: 1, points: 2 },
      undercover: { played: 1, won: 1, points: 10 },
      mrwhite: { played: 0, won: 0, points: 0 },
    });
  });
});

describe('GET /v1/players/me/games', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('401s without a token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/games',
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns an empty page with a null cursor for a player with no games', async () => {
    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/games',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('orders newest-finished-first and includes an abandoned game with a null winnerFaction', async () => {
    const { token, playerId } = await createGuest(server);
    const other = await createGuest(server);

    await insertGameRow({
      subjectPlayerId: playerId,
      subjectRole: 'civilian',
      subjectPoints: 2,
      subjectWon: true,
      winnerFaction: 'civilian',
      endedAt: new Date(Date.now() - 60_000),
      otherPlayerIds: [other.playerId],
    });
    const secondGameId = await insertGameRow({
      subjectPlayerId: playerId,
      subjectRole: 'mrwhite',
      subjectPoints: 0,
      subjectWon: false,
      winnerFaction: null,
      endedAt: new Date(),
    });

    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/games',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    // Newest (the abandoned game, just now) first.
    expect(body.items[0].gameId).toBe(secondGameId);
    expect(body.items[0].winnerFaction).toBeNull();
    expect(body.items[0].won).toBe(false);
    expect(body.items[1].winnerFaction).toBe('civilian');
    expect(body.items[1].playerCount).toBe(2);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with a cursor that never repeats or skips a row', async () => {
    const { token, playerId } = await createGuest(server);
    const gameIds: string[] = [];
    // Sequential (not Promise.all) so `endedAt` strictly increases insert-to-insert.
    for (let i = 0; i < 5; i += 1) {
      const gameId = await insertGameRow({
        subjectPlayerId: playerId,
        subjectRole: 'civilian',
        subjectPoints: 2,
        subjectWon: true,
        winnerFaction: 'civilian',
        endedAt: new Date(Date.now() + i * 1000),
      });
      gameIds.push(gameId);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    // Deliberately sequential — each page's cursor comes from the previous response.
    for (let page = 0; page < 10; page += 1) {
      const res = await server.inject({
        method: 'GET',
        url: `/v1/players/me/games?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      seen.push(...body.items.map((item: { gameId: string }) => item.gameId));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    // Newest-first order, no dupes, no gaps.
    expect(seen).toEqual([...gameIds].reverse());
  });

  it('rejects a malformed cursor with a validation error', async () => {
    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/games?cursor=not-valid-base64url-json',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it("never returns another player's game", async () => {
    const { playerId: otherPlayerId } = await createGuest(server);
    await insertGameRow({
      subjectPlayerId: otherPlayerId,
      subjectRole: 'civilian',
      subjectPoints: 2,
      subjectWon: true,
      winnerFaction: 'civilian',
    });

    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'GET',
      url: '/v1/players/me/games',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });
});

describe('GET /v1/players/me/games/:gameId', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('401s without a token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/players/me/games/${randomUUID()}`,
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('404s for a game the caller never played (existence-hiding)', async () => {
    const other = await createGuest(server);
    const gameId = await insertGameRow({
      subjectPlayerId: other.playerId,
      subjectRole: 'civilian',
      subjectPoints: 2,
      subjectWon: true,
      winnerFaction: 'civilian',
    });

    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'GET',
      url: `/v1/players/me/games/${gameId}`,
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('404s for a well-formed but nonexistent game id', async () => {
    const { token } = await createGuest(server);
    const res = await server.inject({
      method: 'GET',
      url: `/v1/players/me/games/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('redacts vote ballots to aggregate tallies — never a voter identity', async () => {
    const alice: GuestSession = await createGuest(server, { displayName: 'Alice' });
    const bob: GuestSession = await createGuest(server, { displayName: 'Bob' });
    const cara: GuestSession = await createGuest(server, { displayName: 'Cara' });

    const state = makeState({
      round: 1,
      winnerFaction: 'civilian',
      players: [
        {
          id: alice.playerId,
          name: 'Alice',
          avatar: { head: 'h', face: 'f', accessory: 'none', inkColor: 'civilian' },
          seat: 0,
          connected: true,
          isReady: true,
          hasSeenWord: true,
          alive: true,
          eliminatedRound: null,
          role: 'civilian',
          word: 'Latte',
          specialRole: null,
          usedSpecialPower: false,
          hasLeft: false,
        },
        {
          id: bob.playerId,
          name: 'Bob',
          avatar: { head: 'h', face: 'f', accessory: 'none', inkColor: 'civilian' },
          seat: 1,
          connected: true,
          isReady: true,
          hasSeenWord: true,
          alive: false,
          eliminatedRound: 1,
          role: 'undercover',
          word: 'Espresso',
          specialRole: null,
          usedSpecialPower: false,
          hasLeft: false,
        },
        {
          id: cara.playerId,
          name: 'Cara',
          avatar: { head: 'h', face: 'f', accessory: 'none', inkColor: 'civilian' },
          seat: 2,
          connected: true,
          isReady: true,
          hasSeenWord: true,
          alive: true,
          eliminatedRound: null,
          role: 'civilian',
          word: 'Latte',
          specialRole: null,
          usedSpecialPower: false,
          hasLeft: false,
        },
      ],
      clues: [
        { round: 1, playerId: alice.playerId, text: 'Warm', mimed: false },
        { round: 1, playerId: bob.playerId, text: 'Hot', mimed: false },
        { round: 1, playerId: cara.playerId, text: 'Morning', mimed: false },
      ],
      voteHistory: [
        {
          round: 1,
          revote: false,
          votes: { [alice.playerId]: bob.playerId, [cara.playerId]: bob.playerId },
          eliminated: bob.playerId,
        },
      ],
    });

    const gameId = await insertGameRow({
      subjectPlayerId: alice.playerId,
      subjectRole: 'civilian',
      subjectPoints: 2,
      subjectWon: true,
      winnerFaction: 'civilian',
      otherPlayerIds: [bob.playerId, cara.playerId],
      summary: state,
    });

    const res = await server.inject({
      method: 'GET',
      url: `/v1/players/me/games/${gameId}`,
      headers: { authorization: `Bearer ${alice.token}` },
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gameId).toBe(gameId);
    expect(body.rounds).toHaveLength(1);
    const round = body.rounds[0];
    expect(round.round).toBe(1);
    expect(round.clues).toEqual([
      { playerId: alice.playerId, playerName: 'Alice', text: 'Warm' },
      { playerId: bob.playerId, playerName: 'Bob', text: 'Hot' },
      { playerId: cara.playerId, playerName: 'Cara', text: 'Morning' },
    ]);
    expect(round.eliminated).toEqual({
      playerId: bob.playerId,
      playerName: 'Bob',
      role: 'undercover',
    });
    // Aggregate tally only — two votes landed on Bob, and NOTHING in the payload names who
    // cast them (the redaction rule under test).
    expect(round.voteTally).toEqual([{ playerId: bob.playerId, playerName: 'Bob', votes: 2 }]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('"voterId"');
    // Alice's and Cara's ids appear only as clue authors / avatar owners above — the ballot
    // map itself (`{aliceId: bobId, caraId: bobId}`) must never be serialized verbatim.
    expect(raw).not.toContain(JSON.stringify({ [alice.playerId]: bob.playerId }).slice(1, -1));
  });

  it("any other participant sees the same redacted summary (aggregate, not just the caller's own view)", async () => {
    const alice: GuestSession = await createGuest(server, { displayName: 'Alice' });
    const bob: GuestSession = await createGuest(server, { displayName: 'Bob' });

    const state = makeState({
      round: 1,
      winnerFaction: 'civilian',
      players: [
        {
          id: alice.playerId,
          name: 'Alice',
          avatar: { head: 'h', face: 'f', accessory: 'none', inkColor: 'civilian' },
          seat: 0,
          connected: true,
          isReady: true,
          hasSeenWord: true,
          alive: true,
          eliminatedRound: null,
          role: 'civilian',
          word: 'Latte',
          specialRole: null,
          usedSpecialPower: false,
          hasLeft: false,
        },
        {
          id: bob.playerId,
          name: 'Bob',
          avatar: { head: 'h', face: 'f', accessory: 'none', inkColor: 'civilian' },
          seat: 1,
          connected: true,
          isReady: true,
          hasSeenWord: true,
          alive: false,
          eliminatedRound: 1,
          role: 'undercover',
          word: 'Espresso',
          specialRole: null,
          usedSpecialPower: false,
          hasLeft: false,
        },
      ],
      clues: [{ round: 1, playerId: alice.playerId, text: 'Warm', mimed: false }],
      voteHistory: [
        {
          round: 1,
          revote: false,
          votes: { [alice.playerId]: bob.playerId },
          eliminated: bob.playerId,
        },
      ],
    });

    const gameId = await insertGameRow({
      subjectPlayerId: alice.playerId,
      subjectRole: 'civilian',
      subjectPoints: 2,
      subjectWon: true,
      winnerFaction: 'civilian',
      otherPlayerIds: [bob.playerId],
      summary: state,
    });

    const res = await server.inject({
      method: 'GET',
      url: `/v1/players/me/games/${gameId}`,
      headers: { authorization: `Bearer ${bob.token}` },
      remoteAddress: uniqueIp(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().rounds[0].voteTally).toEqual([
      { playerId: bob.playerId, playerName: 'Bob', votes: 1 },
    ]);
  });
});
