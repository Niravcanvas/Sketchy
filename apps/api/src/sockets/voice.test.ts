import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type { BasicAck, JoinAck, VoiceRoster } from '@sketchy/shared/contract/socket';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

interface ClientHarness {
  playerId: string;
  socket: ClientSocket;
  rosters: VoiceRoster[];
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

async function makeClient(baseUrl: string, session: GuestSession): Promise<ClientHarness> {
  const socket = connectSocket(baseUrl, session.token);
  const harness: ClientHarness = { playerId: session.playerId, socket, rosters: [] };
  socket.on(SERVER_EVENTS.voiceRoster, (payload: VoiceRoster) => harness.rosters.push(payload));
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

/**
 * `voice:state` / `voice:roster` integration coverage (api-contract.md §2).
 * Voice is cosmetic to the engine, so these tests
 * never touch `GameState` — only the Redis mute mirror and its socket
 * fan-out (`sockets/voice.ts`).
 */
describe('voice socket integration', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];
  const originalVoiceEnabled = process.env.VOICE_ENABLED;

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.close();
    }
    await server.close();
    if (originalVoiceEnabled === undefined) {
      delete process.env.VOICE_ENABLED;
    } else {
      process.env.VOICE_ENABLED = originalVoiceEnabled;
    }
  });

  it('mutes fan out to every seated socket, including one not connected to voice', async () => {
    const aSession = await createGuest(server, { displayName: 'Alice' });
    const bSession = await createGuest(server, { displayName: 'Bob' });

    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${aSession.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });
    const { code } = createRes.json() as { code: string };

    const a = await makeClient(baseUrl, aSession);
    const b = await makeClient(baseUrl, bSession);
    openSockets.push(a.socket, b.socket);

    await emitAck<JoinAck>(a.socket, CLIENT_EVENTS.roomJoin, { code });
    await emitAck<JoinAck>(b.socket, CLIENT_EVENTS.roomJoin, { code });

    // A "joins voice" and reports muted:true — B never touches LiveKit at all, but must
    // still see A's mute state (the whole point of the mirror, api-contract.md §2.2).
    const muteAck = await emitAck<BasicAck>(a.socket, CLIENT_EVENTS.voiceState, { muted: true });
    expect(muteAck).toEqual({ ok: true });

    await waitFor(
      () => b.rosters.some((r) => r.muted[a.playerId] === true),
      'B to see A muted via the roster mirror',
    );

    const unmuteAck = await emitAck<BasicAck>(a.socket, CLIENT_EVENTS.voiceState, { muted: false });
    expect(unmuteAck).toEqual({ ok: true });
    await waitFor(
      () => b.rosters.at(-1)?.muted[a.playerId] === false,
      'B to see A unmute',
    );
  });

  it('a late joiner receives the current roster immediately on room:join', async () => {
    const aSession = await createGuest(server, { displayName: 'Alice2' });
    const bSession = await createGuest(server, { displayName: 'Bob2' });

    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${aSession.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });
    const { code } = createRes.json() as { code: string };

    const a = await makeClient(baseUrl, aSession);
    openSockets.push(a.socket);
    await emitAck<JoinAck>(a.socket, CLIENT_EVENTS.roomJoin, { code });
    await emitAck<BasicAck>(a.socket, CLIENT_EVENTS.voiceState, { muted: true });

    const b = await makeClient(baseUrl, bSession);
    openSockets.push(b.socket);
    await emitAck<JoinAck>(b.socket, CLIENT_EVENTS.roomJoin, { code });

    await waitFor(
      () => b.rosters.some((r) => r.muted[a.playerId] === true),
      "B's own join to deliver A's already-set mute state",
    );
  });

  it('a kicked player is dropped from the roster', async () => {
    const aSession = await createGuest(server, { displayName: 'Host3' });
    const bSession = await createGuest(server, { displayName: 'Target3' });

    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${aSession.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });
    const { code } = createRes.json() as { code: string };

    const a = await makeClient(baseUrl, aSession);
    const b = await makeClient(baseUrl, bSession);
    openSockets.push(a.socket, b.socket);
    await emitAck<JoinAck>(a.socket, CLIENT_EVENTS.roomJoin, { code });
    await emitAck<JoinAck>(b.socket, CLIENT_EVENTS.roomJoin, { code });

    await emitAck<BasicAck>(b.socket, CLIENT_EVENTS.voiceState, { muted: false });
    await waitFor(() => b.playerId in (a.rosters.at(-1)?.muted ?? {}), 'A to see B in the roster');

    await emitAck<BasicAck>(a.socket, CLIENT_EVENTS.lobbyKick, { playerId: b.playerId });

    await waitFor(
      () => !(b.playerId in (a.rosters.at(-1)?.muted ?? {})),
      "A's roster to drop the kicked player",
    );
  });

  it('rejects voice:state before room:join with validation', async () => {
    const session = await createGuest(server, { displayName: 'Solo' });
    const client = await makeClient(baseUrl, session);
    openSockets.push(client.socket);

    const ack = await emitAck<BasicAck>(client.socket, CLIENT_EVENTS.voiceState, { muted: true });
    expect(ack).toEqual({ ok: false, error: 'validation' });
  });

  it('the VOICE_ENABLED kill-switch rejects voice:state with voice_disabled', async () => {
    const aSession = await createGuest(server, { displayName: 'KillSwitch' });
    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${aSession.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });
    const { code } = createRes.json() as { code: string };

    const a = await makeClient(baseUrl, aSession);
    openSockets.push(a.socket);
    await emitAck<JoinAck>(a.socket, CLIENT_EVENTS.roomJoin, { code });

    process.env.VOICE_ENABLED = 'false';
    const ack = await emitAck<BasicAck>(a.socket, CLIENT_EVENTS.voiceState, { muted: true });
    expect(ack).toEqual({ ok: false, error: 'voice_disabled' });
  });
});
