import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type {
  BasicAck,
  ChatMessage,
  JoinAck,
  RoomEvent,
  RoomSnapshot,
  SyncAck,
} from '@sketchy/shared/contract/socket';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

interface ClientHarness {
  playerId: string;
  displayName: string;
  socket: ClientSocket;
  snapshots: RoomSnapshot[];
  events: RoomEvent[];
  chatMessages: ChatMessage[];
  superseded: number;
}

function connectSocket(baseUrl: string, token: string): ClientSocket {
  return ioClient(`${baseUrl}/game`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err: Error) => reject(err));
  });
}

function attachTracking(harness: ClientHarness): void {
  harness.socket.on(SERVER_EVENTS.roomSnapshot, (snap: RoomSnapshot) => harness.snapshots.push(snap));
  harness.socket.on(SERVER_EVENTS.roomEvent, (evt: RoomEvent) => harness.events.push(evt));
  harness.socket.on(SERVER_EVENTS.chatMessage, (msg: ChatMessage) => harness.chatMessages.push(msg));
  harness.socket.on(SERVER_EVENTS.sessionSuperseded, () => {
    harness.superseded += 1;
  });
}

async function makeClient(baseUrl: string, session: GuestSession): Promise<ClientHarness> {
  const socket = connectSocket(baseUrl, session.token);
  const harness: ClientHarness = {
    playerId: session.playerId,
    displayName: session.displayName,
    socket,
    snapshots: [],
    events: [],
    chatMessages: [],
    superseded: 0,
  };
  attachTracking(harness);
  await waitForConnect(socket);
  return harness;
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: T) => resolve(response));
  });
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

function findPlayer(snapshot: RoomSnapshot, playerId: string) {
  return snapshot.state.players.find((p) => p.id === playerId);
}

/**
 * Multi-socket integration coverage for the lobby/presence layer: three real
 * socket.io-client connections against a real listening server, real
 * Postgres + Redis (vitest.global-setup.ts).
 */
describe('lobby socket integration', () => {
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

  it('7. rejects a socket handshake carrying a garbage token', async () => {
    const socket = connectSocket(baseUrl, 'not-a-real-jwt');
    openSockets.push(socket);
    await expect(waitForConnect(socket)).rejects.toBeTruthy();
    expect(socket.connected).toBe(false);
  });

  it('join/ready/settings/chat/kick/reconnect/supersede — ver strictly increases per client throughout', async () => {
    const aSession = await createGuest(server, { displayName: 'Alice' });
    const bSession = await createGuest(server, { displayName: 'Bob' });
    const cSession = await createGuest(server, { displayName: 'Cleo' });

    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${aSession.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });
    expect(createRes.statusCode).toBe(200);
    const { code } = createRes.json() as { code: string };

    const a = await makeClient(baseUrl, aSession);
    const b = await makeClient(baseUrl, bSession);
    const c = await makeClient(baseUrl, cSession);
    openSockets.push(a.socket, b.socket, c.socket);

    // --- 1. Join sequence: each join's ack carries all seated so far; every
    // already-bound client receives a room:snapshot broadcast per join. ---
    const joinAckA = await emitAck<JoinAck>(a.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!joinAckA.ok) throw new Error(`A join failed: ${joinAckA.error}`);
    expect(joinAckA.snapshot.state.players).toHaveLength(1);

    const joinAckB = await emitAck<JoinAck>(b.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!joinAckB.ok) throw new Error(`B join failed: ${joinAckB.error}`);
    expect(joinAckB.snapshot.state.players).toHaveLength(2);

    const joinAckC = await emitAck<JoinAck>(c.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!joinAckC.ok) throw new Error(`C join failed: ${joinAckC.error}`);
    expect(joinAckC.snapshot.state.players).toHaveLength(3);

    await waitFor(() => a.snapshots.length >= 3, 'A to observe all 3 joins');
    await waitFor(() => b.snapshots.length >= 2, 'B to observe B+C joins');
    await waitFor(() => c.snapshots.length >= 1, 'C to observe its own join');

    const lastSeatedIds = a.snapshots.at(-1)!.state.players.map((p) => p.id).sort();
    expect(lastSeatedIds).toEqual([a.playerId, b.playerId, c.playerId].sort());

    // --- 2. Ready + host-only settings ---
    const readyAck = await emitAck<BasicAck>(b.socket, CLIENT_EVENTS.lobbyReady, { ready: true });
    expect(readyAck).toEqual({ ok: true });
    await waitFor(
      () => findPlayer(a.snapshots.at(-1)!, b.playerId)?.isReady === true,
      'A to see B become ready',
    );

    const settingsAck = await emitAck<BasicAck>(a.socket, CLIENT_EVENTS.lobbySettings, {
      maxPlayers: 8,
    });
    expect(settingsAck).toEqual({ ok: true });
    await waitFor(
      () => b.snapshots.at(-1)?.state.settings.maxPlayers === 8,
      'B to see the updated maxPlayers',
    );

    const nonHostSettingsAck = await emitAck<BasicAck>(c.socket, CLIENT_EVENTS.lobbySettings, {
      maxPlayers: 5,
    });
    expect(nonHostSettingsAck).toEqual({ ok: false, error: 'not_host' });

    // --- 3. Chat: broadcast to the room; profanity rejected with no broadcast ---
    const chatAck = await emitAck<BasicAck>(b.socket, CLIENT_EVENTS.chatSend, {
      text: 'hello everyone',
    });
    expect(chatAck).toEqual({ ok: true });
    await waitFor(() => a.chatMessages.length >= 1, 'A to receive the chat message');
    await waitFor(() => c.chatMessages.length >= 1, 'C to receive the chat message');
    expect(a.chatMessages.at(-1)).toMatchObject({
      from: { id: b.playerId, name: 'Bob' },
      text: 'hello everyone',
    });
    expect(c.chatMessages.at(-1)).toMatchObject({ from: { id: b.playerId, name: 'Bob' } });

    const profanityAck = await emitAck<BasicAck>(b.socket, CLIENT_EVENTS.chatSend, {
      text: 'you fucking idiot',
    });
    expect(profanityAck).toEqual({ ok: false, error: 'profanity' });
    const chatCountBeforeWait = a.chatMessages.length;
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(a.chatMessages.length).toBe(chatCountBeforeWait); // no broadcast happened

    // --- 4. Kick ---
    const kickAck = await emitAck<BasicAck>(a.socket, CLIENT_EVENTS.lobbyKick, {
      playerId: c.playerId,
    });
    expect(kickAck).toEqual({ ok: true });
    await waitFor(
      () => c.events.some((e) => e.type === 'kicked' && e.playerId === c.playerId),
      'C to receive the kicked room:event',
    );
    await waitFor(
      () => !findPlayer(a.snapshots.at(-1)!, c.playerId),
      "A's snapshot to no longer list C",
    );
    expect(findPlayer(b.snapshots.at(-1)!, c.playerId)).toBeUndefined();

    // Kicked player is no longer seated: the engine rejects further lobby actions.
    const cReadyAfterKick = await emitAck<BasicAck>(c.socket, CLIENT_EVENTS.lobbyReady, {
      ready: true,
    });
    expect(cReadyAfterKick).toEqual({ ok: false, error: 'validation' });

    // --- 5. Reconnect / resync ---
    b.socket.close();
    await waitFor(
      () => a.events.some((e) => e.type === 'playerDisconnected' && e.playerId === b.playerId),
      'A to receive playerDisconnected',
    );
    await waitFor(
      () => findPlayer(a.snapshots.at(-1)!, b.playerId)?.connected === false,
      "A's snapshot to show B disconnected",
    );

    const bReconnect = await makeClient(baseUrl, bSession);
    openSockets.push(bReconnect.socket);
    // Route the reconnected socket's snapshots into the SAME logical
    // "client B" series used for the ver-monotonicity assertion below.
    bReconnect.socket.on(SERVER_EVENTS.roomSnapshot, (snap: RoomSnapshot) => b.snapshots.push(snap));

    const rejoinAck = await emitAck<JoinAck>(bReconnect.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!rejoinAck.ok) throw new Error(`B rejoin failed: ${rejoinAck.error}`);
    await waitFor(
      () => a.snapshots.at(-1)?.ver === rejoinAck.snapshot.ver,
      'A to catch up to the rejoin snapshot',
    );
    expect(
      a.events.some((e) => e.type === 'playerReconnected' && e.playerId === b.playerId),
    ).toBe(true);

    const syncAck = await emitAck<SyncAck>(bReconnect.socket, CLIENT_EVENTS.roomSync, {
      lastVer: 0,
    });
    if (!syncAck.ok) throw new Error(`B room:sync failed: ${syncAck.error}`);
    expect(syncAck.snapshot.state).toEqual(a.snapshots.at(-1)!.state);
    expect(findPlayer(syncAck.snapshot, b.playerId)?.connected).toBe(true);

    // --- 6. Supersede: a second socket for B replaces the reconnected one ---
    const bSupersede = await makeClient(baseUrl, bSession);
    openSockets.push(bSupersede.socket);
    const supersedeJoinAck = await emitAck<JoinAck>(bSupersede.socket, CLIENT_EVENTS.roomJoin, {
      code,
    });
    if (!supersedeJoinAck.ok) throw new Error(`B supersede join failed: ${supersedeJoinAck.error}`);

    await waitFor(() => bReconnect.superseded >= 1, 'the previously-live B socket to be superseded');
    await waitFor(
      () => bReconnect.socket.connected === false,
      'the superseded B socket to be disconnected by the server',
    );

    // A superseded socket no longer affects the room: its own copy of the
    // connection is closed, so it structurally cannot emit further actions.
    expect(bReconnect.socket.connected).toBe(false);

    // --- ver monotonicity across the WHOLE test, per logical client (A/B/C) ---
    for (const versions of [
      a.snapshots.map((s) => s.ver),
      b.snapshots.map((s) => s.ver),
      c.snapshots.map((s) => s.ver),
    ]) {
      for (let i = 1; i < versions.length; i += 1) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]!);
      }
    }
  });
});
