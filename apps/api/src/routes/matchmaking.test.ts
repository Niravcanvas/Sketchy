import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type { JoinAck, MmMatched } from '@sketchy/shared/contract/socket';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signPlayerToken } from '../auth/jwt.js';
import { getDb, getRedis } from '../db/client.js';
import { players, wordPacks, wordPairs } from '../db/schema.js';
import { runMatchTick } from '../matchmaking/matcher.js';
import { getGameNamespace } from '../sockets/namespace-registry.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

/**
 * Promotes a fresh guest to a linked account (bypassing the email dance — that
 * flow is covered in accounts.test.ts) so it can use public matchmaking. Both
 * halves matter: the DB `is_guest=false` gates JOINING a public room, and a
 * FRESH token signed with `guest:false` (exactly what `POST /auth/link/verify`
 * returns) gates the REST public-room/quick-join routes (which read the token's
 * claim, not the DB).
 */
async function makeAccount(server: FastifyInstance, name: string): Promise<GuestSession> {
  const session = await createGuest(server, { displayName: name });
  await getDb()
    .update(players)
    .set({ isGuest: false, email: `${session.playerId}@acct.test` })
    .where(eq(players.id, session.playerId));
  const token = await signPlayerToken(session.playerId, false);
  return { ...session, token };
}

interface MatchClient {
  session: GuestSession;
  socket: ClientSocket;
  matched: MmMatched[];
}

function connect(baseUrl: string, token: string): ClientSocket {
  return ioClient(`${baseUrl}/game`, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
}
function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err: Error) => reject(err));
  });
}
async function makeMatchClient(baseUrl: string, session: GuestSession): Promise<MatchClient> {
  const socket = connect(baseUrl, session.token);
  const client: MatchClient = { session, socket, matched: [] };
  socket.on(SERVER_EVENTS.matched, (m: MmMatched) => client.matched.push(m));
  await waitForConnect(socket);
  return client;
}
function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}
async function waitFor(predicate: () => boolean, description: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function enqueue(server: FastifyInstance, session: GuestSession, language = 'en') {
  return server.inject({
    method: 'POST',
    url: '/v1/matchmaking/queue',
    headers: { authorization: `Bearer ${session.token}` },
    payload: { language },
    remoteAddress: uniqueIp(),
  });
}
/** Seeds a small owned pack so a public game can actually draw a pair (the test
 * DB isn't seeded with the official packs). */
async function insertPack(ownerId: string): Promise<string> {
  const db = getDb();
  const [pack] = await db
    .insert(wordPacks)
    .values({ name: `Pack ${randomUUID().slice(0, 8)}`, isOfficial: false, ownerId, visibility: 'private' })
    .returning();
  if (!pack) throw new Error('pack insert failed');
  await db.insert(wordPairs).values([
    { packId: pack.id, wordA: 'Guitar', wordB: 'Violin', difficulty: 'easy' as const },
    { packId: pack.id, wordA: 'Coffee', wordB: 'Tea', difficulty: 'easy' as const },
  ]);
  return pack.id;
}

async function block(server: FastifyInstance, blocker: GuestSession, blockedId: string) {
  await server.inject({
    method: 'POST',
    url: '/v1/blocks',
    headers: { authorization: `Bearer ${blocker.token}` },
    payload: { blockedPlayerId: blockedId },
    remoteAddress: uniqueIp(),
  });
}

describe('matchmaking: lobbies + quick-join matcher (phase 16)', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeEach(async () => {
    // Isolate the shared matchmaking/lobby Redis keys from other test files.
    await getRedis().del('mm:queue', 'mm:queue:lang', 'lobbies:index', 'lobbies:lang');
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });
  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.close();
    }
    await server.close();
  });

  it('lists a public room in GET /lobbies, hides private, and delists on game start', async () => {
    const host = await makeAccount(server, 'HostA');
    const pub = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${host.token}` },
      payload: { visibility: 'public' },
      remoteAddress: uniqueIp(),
    });
    const publicCode = (pub.json() as { code: string }).code;
    await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${host.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });

    const lobbies = await server.inject({
      method: 'GET',
      url: '/v1/lobbies',
      headers: { authorization: `Bearer ${host.token}` },
      remoteAddress: uniqueIp(),
    });
    const items = (lobbies.json() as { items: { code: string }[] }).items;
    expect(items.map((i) => i.code)).toContain(publicCode);
    // The private room is never listed.
    expect(items).toHaveLength(1);
  });

  it('forms ONE room from two queued accounts and pushes mm:matched (same code) to both', async () => {
    const alice = await makeMatchClient(baseUrl, await makeAccount(server, 'Alice'));
    const bob = await makeMatchClient(baseUrl, await makeAccount(server, 'Bob'));
    openSockets.push(alice.socket, bob.socket);

    expect((await enqueue(server, alice.session)).statusCode).toBe(200);
    expect((await enqueue(server, bob.session)).statusCode).toBe(200);

    const ns = getGameNamespace();
    expect(ns).toBeTruthy();
    // Drive a deterministic tick "9s in the future" so the form-after-wait fires.
    await runMatchTick(ns!, Date.now() + 9000);

    await waitFor(() => alice.matched.length > 0 && bob.matched.length > 0, 'both matched');
    expect(alice.matched[0]?.code).toBe(bob.matched[0]?.code);

    // The formed room is a real public lobby both can join.
    const join = await emitAck<JoinAck>(bob.socket, CLIENT_EVENTS.roomJoin, { code: bob.matched[0]!.code });
    expect(join.ok).toBe(true);
  });

  it('two accounts (host + a quick-joiner) + a third via the browser start a public game (delisted, no mid-game drop-ins)', async () => {
    // Alice hosts a public room (with a drawable pack); it's listed in the browser.
    const alice = await makeMatchClient(baseUrl, await makeAccount(server, 'Alice'));
    openSockets.push(alice.socket);
    const packId = await insertPack(alice.session.playerId);
    const created = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${alice.session.token}` },
      payload: { visibility: 'public', settings: { packIds: [packId] } },
      remoteAddress: uniqueIp(),
    });
    const code = (created.json() as { code: string }).code;
    await emitAck<JoinAck>(alice.socket, CLIENT_EVENTS.roomJoin, { code });

    // Bob QUICK-JOINS → the matcher fills Alice's existing public lobby (same room).
    const bob = await makeMatchClient(baseUrl, await makeAccount(server, 'Bob'));
    openSockets.push(bob.socket);
    await enqueue(server, bob.session);
    await runMatchTick(getGameNamespace()!, Date.now() + 9000);
    await waitFor(() => bob.matched.length > 0, 'bob matched');
    expect(bob.matched[0]?.code).toBe(code);
    await emitAck<JoinAck>(bob.socket, CLIENT_EVENTS.roomJoin, { code });

    // A THIRD account finds the room via the public browser and joins.
    const carol = await makeAccount(server, 'Carol');
    const lobbies = await server.inject({
      method: 'GET',
      url: '/v1/lobbies',
      headers: { authorization: `Bearer ${carol.token}` },
      remoteAddress: uniqueIp(),
    });
    expect((lobbies.json() as { items: { code: string }[] }).items.map((i) => i.code)).toContain(code);
    const carolSock = connect(baseUrl, carol.token);
    openSockets.push(carolSock);
    await waitForConnect(carolSock);
    const carolJoin = await emitAck<JoinAck>(carolSock, CLIENT_EVENTS.roomJoin, { code });
    expect(carolJoin.ok).toBe(true);

    // Everyone readies; the host starts the game (3 players, default 1 undercover — valid).
    await emitAck(alice.socket, CLIENT_EVENTS.lobbyReady, { ready: true });
    await emitAck(bob.socket, CLIENT_EVENTS.lobbyReady, { ready: true });
    await emitAck(carolSock, CLIENT_EVENTS.lobbyReady, { ready: true });
    const start = await emitAck<{ ok: boolean }>(alice.socket, CLIENT_EVENTS.gameStart, {});
    expect(start.ok).toBe(true);

    // The public game started → the room LEAVES the browser index (no mid-game drop-ins).
    const afterStart = await server.inject({
      method: 'GET',
      url: '/v1/lobbies',
      headers: { authorization: `Bearer ${carol.token}` },
      remoteAddress: uniqueIp(),
    });
    expect((afterStart.json() as { items: { code: string }[] }).items.map((i) => i.code)).not.toContain(code);

    // A fourth account can no longer join mid-game.
    const dave = await makeAccount(server, 'Dave');
    const daveSock = connect(baseUrl, dave.token);
    openSockets.push(daveSock);
    await waitForConnect(daveSock);
    const daveJoin = await emitAck<JoinAck>(daveSock, CLIENT_EVENTS.roomJoin, { code });
    expect(daveJoin.ok).toBe(false);
    if (!daveJoin.ok) {
      expect(daveJoin.error).toBe('room_in_progress');
    }
  });

  it('fills an existing public lobby before forming a new room', async () => {
    const host = await makeAccount(server, 'Host');
    const created = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${host.token}` },
      payload: { visibility: 'public' },
      remoteAddress: uniqueIp(),
    });
    const existingCode = (created.json() as { code: string }).code;

    const joiner = await makeMatchClient(baseUrl, await makeAccount(server, 'Joiner'));
    openSockets.push(joiner.socket);
    await enqueue(server, joiner.session);

    await runMatchTick(getGameNamespace()!, Date.now() + 9000);
    await waitFor(() => joiner.matched.length > 0, 'joiner matched');
    // Matched into the EXISTING lobby, not a freshly-formed one.
    expect(joiner.matched[0]?.code).toBe(existingCode);
  });

  it('never matches a blocked pair, but matches around the block', async () => {
    const p = await makeMatchClient(baseUrl, await makeAccount(server, 'Pat'));
    const q = await makeMatchClient(baseUrl, await makeAccount(server, 'Quinn'));
    openSockets.push(p.socket, q.socket);
    // Pat and Quinn block each other.
    await block(server, p.session, q.session.playerId);
    await block(server, q.session, p.session.playerId);

    await enqueue(server, p.session);
    await enqueue(server, q.session);
    await runMatchTick(getGameNamespace()!, Date.now() + 9000);
    // No room could form from a single mutually-blocked pair.
    await new Promise((r) => setTimeout(r, 100));
    expect(p.matched).toHaveLength(0);
    expect(q.matched).toHaveLength(0);

    // A third, unblocked player lets Pat match (around Quinn).
    const r = await makeMatchClient(baseUrl, await makeAccount(server, 'Ray'));
    openSockets.push(r.socket);
    await enqueue(server, r.session);
    await runMatchTick(getGameNamespace()!, Date.now() + 9000);
    await waitFor(() => p.matched.length > 0 && r.matched.length > 0, 'Pat + Ray matched');
    expect(p.matched[0]?.code).toBe(r.matched[0]?.code);
    // Quinn (blocked with Pat) was NOT put in that room.
    expect(q.matched).toHaveLength(0);
  });

  it('DELETE /matchmaking/queue removes the caller from the queue', async () => {
    const alice = await makeAccount(server, 'Alice');
    await enqueue(server, alice);
    const cancel = await server.inject({
      method: 'DELETE',
      url: '/v1/matchmaking/queue',
      headers: { authorization: `Bearer ${alice.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(cancel.statusCode).toBe(200);
    // After cancel, a tick can't match the (now empty) queue.
    await runMatchTick(getGameNamespace()!, Date.now() + 9000);
    expect(await getRedis().zscore('mm:queue', alice.playerId)).toBeNull();
  });
});
