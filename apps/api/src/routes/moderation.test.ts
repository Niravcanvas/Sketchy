import { CLIENT_EVENTS } from '@sketchy/shared/contract/socket';
import type { BasicAck, JoinAck } from '@sketchy/shared/contract/socket';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/client.js';
import { moderationActions, players, reports, wordPacks } from '../db/schema.js';
import { getEnv } from '../env.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

const ADMIN = getEnv().adminToken ?? 'dev-only-change-me';

function connectSocket(baseUrl: string, token: string): ClientSocket {
  return ioClient(`${baseUrl}/game`, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
}
function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err: Error) => reject(err));
  });
}
function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}

async function createRoom(server: FastifyInstance, session: GuestSession): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/rooms',
    headers: { authorization: `Bearer ${session.token}` },
    payload: {},
    remoteAddress: uniqueIp(),
  });
  return (res.json() as { code: string }).code;
}

describe('moderation: reports, admin queue, suspension, blocks (phase 16)', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });
  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.close();
    }
    await server.close();
  });

  it('captures room chat/clue context, surfaces it in the admin queue, and suspend blocks the player everywhere', async () => {
    const alice = await createGuest(server, { displayName: 'Alice' });
    const bob = await createGuest(server, { displayName: 'BobTheRude' });
    const code = await createRoom(server, alice);

    const aSock = connectSocket(baseUrl, alice.token);
    const bSock = connectSocket(baseUrl, bob.token);
    openSockets.push(aSock, bSock);
    await Promise.all([waitForConnect(aSock), waitForConnect(bSock)]);
    await emitAck<JoinAck>(aSock, CLIENT_EVENTS.roomJoin, { code });
    await emitAck<JoinAck>(bSock, CLIENT_EVENTS.roomJoin, { code });
    const chatAck = await emitAck<BasicAck>(bSock, CLIENT_EVENTS.chatSend, { text: 'you are all so sketchy honestly' });
    expect(chatAck.ok).toBe(true);

    // Alice reports Bob, WITH the room so context is captured server-side.
    const report = await server.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { reportedPlayerId: bob.playerId, roomCode: code, reason: 'chat', detail: 'rude in chat' },
      remoteAddress: uniqueIp(),
    });
    expect(report.statusCode).toBe(200);

    // Context captured into the row.
    const [row] = await getDb().select().from(reports).where(eq(reports.reportedId, bob.playerId));
    expect(row).toBeTruthy();
    expect(JSON.stringify(row?.context)).toContain('you are all so sketchy honestly');

    // Admin queue HTML shows the report + its context.
    const queue = await server.inject({ method: 'GET', url: `/v1/admin/reports?token=${ADMIN}` });
    expect(queue.statusCode).toBe(200);
    expect(queue.body).toContain('BobTheRude');
    expect(queue.body).toContain('you are all so sketchy honestly');

    // Admin suspends Bob via the form-POST action.
    const action = await server.inject({
      method: 'POST',
      url: `/v1/admin/reports/${row?.id}/action`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `token=${ADMIN}&action=suspend`,
    });
    expect(action.statusCode).toBe(302);

    // Report actioned, action logged, player flagged suspended.
    const [after] = await getDb().select().from(reports).where(eq(reports.id, row?.id ?? ''));
    expect(after?.status).toBe('actioned');
    const logs = await getDb().select().from(moderationActions).where(eq(moderationActions.targetPlayerId, bob.playerId));
    expect(logs.some((l) => l.action === 'suspend')).toBe(true);
    const [bobRow] = await getDb().select().from(players).where(eq(players.id, bob.playerId));
    expect(bobRow?.suspendedAt).not.toBeNull();

    // Suspended: a sanitized REST rejection (reason never leaked).
    const me = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${bob.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(me.statusCode).toBe(403);
    const err = (me.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('suspended');
    expect(err.message).not.toContain('report');

    // Suspended: the socket handshake is refused too.
    const suspendedSock = connectSocket(baseUrl, bob.token);
    openSockets.push(suspendedSock);
    await expect(waitForConnect(suspendedSock)).rejects.toBeTruthy();
  });

  it('rejects self-report and unknown target', async () => {
    const alice = await createGuest(server, { displayName: 'Alice' });
    const self = await server.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { reportedPlayerId: alice.playerId, reason: 'other' },
      remoteAddress: uniqueIp(),
    });
    expect(self.statusCode).toBe(400);

    const unknown = await server.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { reportedPlayerId: '00000000-0000-0000-0000-000000000000', reason: 'other' },
      remoteAddress: uniqueIp(),
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('warn action flags the reported player without suspending them', async () => {
    const alice = await createGuest(server, { displayName: 'Alice' });
    const carl = await createGuest(server, { displayName: 'Carl' });
    await server.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { reportedPlayerId: carl.playerId, reason: 'name' },
      remoteAddress: uniqueIp(),
    });
    const [row] = await getDb().select().from(reports).where(eq(reports.reportedId, carl.playerId));
    const action = await server.inject({
      method: 'POST',
      url: `/v1/admin/reports/${row?.id}/action`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `token=${ADMIN}&action=warn`,
    });
    expect(action.statusCode).toBe(302);
    const [carlRow] = await getDb().select().from(players).where(eq(players.id, carl.playerId));
    expect(carlRow?.warnedAt).not.toBeNull();
    expect(carlRow?.suspendedAt).toBeNull(); // warn is not a suspend

    // Carl can still play.
    const me = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${carl.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(me.statusCode).toBe(200);
  });

  it('rejects the admin queue without a valid token', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/admin/reports?token=wrong' });
    expect(res.statusCode).toBe(401);
  });

  it('lists a pending public pack in the admin queue and approves it via the form POST (dormant gate infra)', async () => {
    const owner = await createGuest(server, { displayName: 'CatalogHopeful' });
    // No API path produces a pending public pack today (going public self-approves), so this
    // exercises the dormant review infra by inserting one directly — the state a future,
    // switched-on gate would create. A direct insert defaults review_status='pending'.
    const [pack] = await getDb()
      .insert(wordPacks)
      .values({ name: 'Awaiting Review', isOfficial: false, ownerId: owner.playerId, visibility: 'public' })
      .returning();
    const packId = pack?.id ?? '';

    // The queue page surfaces a "Packs awaiting review" section listing it.
    const queue = await server.inject({ method: 'GET', url: `/v1/admin/reports?token=${ADMIN}` });
    expect(queue.statusCode).toBe(200);
    expect(queue.body).toContain('Packs awaiting review');
    expect(queue.body).toContain('Awaiting Review');
    expect(queue.body).toContain(packId);

    // Approve via the form-POST action → redirect back to the queue.
    const action = await server.inject({
      method: 'POST',
      url: `/v1/admin/packs/${packId}/action`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `token=${ADMIN}&action=approve_pack`,
    });
    expect(action.statusCode).toBe(302);

    // Pack approved + logged; it no longer appears in the pending queue.
    const [after] = await getDb().select().from(wordPacks).where(eq(wordPacks.id, packId));
    expect(after?.reviewStatus).toBe('approved');
    const logs = await getDb().select().from(moderationActions).where(eq(moderationActions.packId, packId));
    expect(logs.some((l) => l.action === 'approve_pack')).toBe(true);

    const requeue = await server.inject({ method: 'GET', url: `/v1/admin/reports?token=${ADMIN}` });
    expect(requeue.body).not.toContain(packId);
  });

  it('block / list / unblock (self-block rejected)', async () => {
    const alice = await createGuest(server, { displayName: 'Alice' });
    const bob = await createGuest(server, { displayName: 'Bob' });
    const auth = { authorization: `Bearer ${alice.token}` };

    const selfBlock = await server.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: auth,
      payload: { blockedPlayerId: alice.playerId },
      remoteAddress: uniqueIp(),
    });
    expect(selfBlock.statusCode).toBe(400);

    const block = await server.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: auth,
      payload: { blockedPlayerId: bob.playerId },
      remoteAddress: uniqueIp(),
    });
    expect(block.statusCode).toBe(200);

    const list = await server.inject({ method: 'GET', url: '/v1/blocks', headers: auth, remoteAddress: uniqueIp() });
    expect((list.json() as { items: { blockedPlayerId: string }[] }).items.map((i) => i.blockedPlayerId)).toContain(
      bob.playerId,
    );

    const unblock = await server.inject({
      method: 'DELETE',
      url: `/v1/blocks/${bob.playerId}`,
      headers: auth,
      remoteAddress: uniqueIp(),
    });
    expect(unblock.statusCode).toBe(200);
    const after = await server.inject({ method: 'GET', url: '/v1/blocks', headers: auth, remoteAddress: uniqueIp() });
    expect((after.json() as { items: unknown[] }).items).toHaveLength(0);
  });
});
