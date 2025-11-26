import { randomUUID } from 'node:crypto';
import { CLIENT_EVENTS } from '@sketchy/shared/contract/socket';
import type { BasicAck, JoinAck, RoomSnapshot } from '@sketchy/shared/contract/socket';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRedis } from '../db/client.js';
import { getDb } from '../db/client.js';
import { wordPacks, wordPairs } from '../db/schema.js';
import { loadRoom } from '../rooms/room-store.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

/** One raw frame captured off a client socket — either a server-pushed event
 * (`socket.onAny`) or an ack response (wrapped manually, since acks aren't
 * "events" socket.io-client's `onAny` sees). */
interface CapturedFrame {
  event: string;
  payload: unknown;
}

interface ClientHarness {
  playerId: string;
  displayName: string;
  socket: ClientSocket;
  frames: CapturedFrame[];
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
  const harness: ClientHarness = {
    playerId: session.playerId,
    displayName: session.displayName,
    socket,
    frames: [],
  };
  socket.onAny((event: string, payload: unknown) => harness.frames.push({ event, payload }));
  await waitForConnect(socket);
  return harness;
}

/** Emits and captures the ACK response as a frame too (api-contract.md §2:
 * acks carry the same `room:snapshot`-shaped payloads on `room:join`/
 * `room:sync` — those must be just as redacted as any broadcast). */
function emitAckCaptured<T>(harness: ClientHarness, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    harness.socket.emit(event, payload, (response: T) => {
      harness.frames.push({ event: `${event}:ack`, payload: response });
      resolve(response);
    });
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

function latestSnapshot(harness: ClientHarness): RoomSnapshot | undefined {
  for (let i = harness.frames.length - 1; i >= 0; i -= 1) {
    const frame = harness.frames[i] as CapturedFrame;
    if (frame.event === 'room:snapshot') {
      return frame.payload as RoomSnapshot;
    }
  }
  return undefined;
}

async function insertPack(ownerId: string, wordA: string, wordB: string): Promise<string> {
  const db = getDb();
  const [pack] = await db
    .insert(wordPacks)
    .values({
      name: `Redaction ${randomUUID().slice(0, 8)}`,
      isOfficial: false,
      ownerId,
      visibility: 'private',
    })
    .returning();
  if (!pack) throw new Error('pack insert failed');
  await db.insert(wordPairs).values({ packId: pack.id, wordA, wordB, difficulty: 'easy' });
  return pack.id;
}

async function createRoomViaRest(
  server: FastifyInstance,
  token: string,
  settings: Record<string, unknown>,
): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/rooms',
    headers: { authorization: `Bearer ${token}` },
    payload: { settings },
    remoteAddress: uniqueIp(),
  });
  if (res.statusCode !== 200) {
    throw new Error(`room create failed: ${res.statusCode} ${res.body}`);
  }
  return (res.json() as { code: string }).code;
}

/** Finds the `YouSlice`-shaped object nested in a captured frame, if any —
 * the ONLY legitimate place either secret word may appear (`room:snapshot`
 * events carry it at `.you`; `room:join`/`room:sync` acks nest it one level
 * down at `.snapshot.you`). */
function findYouSlice(payload: unknown): { word: string | null } | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const obj = payload as Record<string, unknown>;
  if (obj.you && typeof obj.you === 'object') {
    return obj.you as { word: string | null };
  }
  const snapshot = obj.snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const you = (snapshot as Record<string, unknown>).you;
    if (you && typeof you === 'object') {
      return you as { word: string | null };
    }
  }
  return undefined;
}

/** Structural check (b)/(c): the public `state` slice of a snapshot must
 * never carry `pair`, nor any ALIVE player's `role`/`word` — regardless of
 * viewer, since the broadcast `state` is ALWAYS the 'spectator' redaction
 * (`rooms/snapshot.ts` `buildSnapshot`); only the top-level `you` slice ever
 * carries the viewer's own truth. */
function assertSnapshotStructurallyRedacted(snapshot: RoomSnapshot): void {
  expect(snapshot.state.pair).toBeNull();
  for (const p of snapshot.state.players) {
    if (p.alive) {
      expect(p.role).toBeNull();
      expect(p.word).toBeNull();
    }
  }
  const voterIds = Object.keys(snapshot.state.votes);
  if (voterIds.length > 0) {
    expect(voterIds.every((id) => id === snapshot.you.playerId)).toBe(true);
  }
}

function findSnapshotShaped(payload: unknown): RoomSnapshot | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const obj = payload as Record<string, unknown>;
  if (obj.state && obj.you) {
    return obj as unknown as RoomSnapshot;
  }
  const snapshot = obj.snapshot;
  if (snapshot && typeof snapshot === 'object') {
    return snapshot as RoomSnapshot;
  }
  return undefined;
}

/**
 * A RAW-FRAME-level redaction audit. Unlike
 * `play.test.ts` (which asserts through the typed `RoomSnapshot` shape),
 * this test captures EVERY frame a client socket receives — via
 * `socket.onAny` for server-pushed events, plus wrapped ack callbacks for
 * `room:join`/`room:sync` (whose acks carry the same snapshot shape) — and
 * greps the raw JSON for the two secret pair words. The only place either
 * word may legitimately appear is a viewer's OWN `you.word`; that field is
 * blanked before the grep so this test can't produce a false positive off a
 * player's own, correctly-delivered word.
 */
describe('redaction audit — raw socket frames', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];
  const createdRoomCodes: string[] = [];

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.close();
    }
    await server.close();
    const redis = getRedis();
    for (const code of createdRoomCodes.splice(0)) {
      await redis.del(
        `room:${code}:state`,
        `room:${code}:ver`,
        `room:${code}:lock`,
        `room:${code}:conn`,
        `room:${code}:usedPairs`,
        `room:${code}:gameId`,
      );
    }
  });

  it('no captured frame (broadcast OR ack) ever leaks a non-viewer secret word or role', async () => {
    const host = await createGuest(server, { displayName: 'RedHost' });
    const bob = await createGuest(server, { displayName: 'RedBob' });
    const cleo = await createGuest(server, { displayName: 'RedCleo' });
    const dee = await createGuest(server, { displayName: 'RedDee' });

    // Distinctive, unlikely-to-collide words — a single pair in the pack so
    // the exact draw is known ahead of time (not that it matters: we read
    // the true words back from the store below regardless).
    const packId = await insertPack(host.playerId, 'Xylophone', 'Zeppelin');
    const code = await createRoomViaRest(server, host.token, {
      packIds: [packId],
      difficulties: ['easy'],
      maxPlayers: 6,
    });
    createdRoomCodes.push(code);

    const hostClient = await makeClient(baseUrl, host);
    const bobClient = await makeClient(baseUrl, bob);
    const cleoClient = await makeClient(baseUrl, cleo);
    const deeClient = await makeClient(baseUrl, dee);
    const harnesses = [hostClient, bobClient, cleoClient, deeClient];
    openSockets.push(hostClient.socket, bobClient.socket, cleoClient.socket, deeClient.socket);

    const hostJoin = await emitAckCaptured<JoinAck>(hostClient, CLIENT_EVENTS.roomJoin, { code });
    if (!hostJoin.ok) throw new Error(`host join failed: ${hostJoin.error}`);
    const bobJoin = await emitAckCaptured<JoinAck>(bobClient, CLIENT_EVENTS.roomJoin, { code });
    if (!bobJoin.ok) throw new Error(`bob join failed: ${bobJoin.error}`);
    const cleoJoin = await emitAckCaptured<JoinAck>(cleoClient, CLIENT_EVENTS.roomJoin, { code });
    if (!cleoJoin.ok) throw new Error(`cleo join failed: ${cleoJoin.error}`);
    const deeJoin = await emitAckCaptured<JoinAck>(deeClient, CLIENT_EVENTS.roomJoin, { code });
    if (!deeJoin.ok) throw new Error(`dee join failed: ${deeJoin.error}`);

    // A `room:sync` per client — its ack carries the same snapshot shape and
    // must pass the same audit (api-contract.md §2.1).
    for (const h of harnesses) {
      const syncAck = await emitAckCaptured<{ ok: boolean }>(h, CLIENT_EVENTS.roomSync, { lastVer: 0 });
      expect(syncAck.ok).toBe(true);
    }

    const startAck = await emitAckCaptured<BasicAck>(hostClient, CLIENT_EVENTS.gameStart, {});
    expect(startAck).toEqual({ ok: true });

    for (const h of harnesses) {
      await waitFor(() => latestSnapshot(h)?.state.phase === 'dealing', `${h.displayName} to see dealing`);
      const ackResult = await emitAckCaptured<BasicAck>(h, CLIENT_EVENTS.dealAck, {});
      expect(ackResult).toEqual({ ok: true });
    }

    for (const h of harnesses) {
      await waitFor(() => latestSnapshot(h)?.state.phase === 'clue', `${h.displayName} to see clue phase`);
    }

    // Drive one full clue round (deal + one clue round) — nobody is
    // eliminated, so every alive player's `role`/`word` stays secret in the
    // broadcast `state` throughout.
    const clueTexts = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    for (const text of clueTexts) {
      let turnHolder: ClientHarness | undefined;
      await waitFor(() => {
        turnHolder = harnesses.find((h) => latestSnapshot(h)?.you.canAct.submitClue === true);
        return turnHolder !== undefined;
      }, 'a turn holder');
      const ackResult = await emitAckCaptured<BasicAck>(turnHolder as ClientHarness, CLIENT_EVENTS.clueSubmit, {
        text,
      });
      expect(ackResult).toEqual({ ok: true });
    }

    for (const h of harnesses) {
      await waitFor(() => latestSnapshot(h)?.state.phase === 'discussion', `${h.displayName} to reach discussion`);
    }

    // A chat message too — never has a `you` slice, should never contain a
    // secret word either (nobody typed one; this just exercises the frame
    // audit against a non-snapshot event shape).
    const chatAck = await emitAckCaptured<BasicAck>(hostClient, CLIENT_EVENTS.chatSend, {
      text: 'good luck everyone',
    });
    expect(chatAck).toEqual({ ok: true });
    await waitFor(
      () => bobClient.frames.some((f) => f.event === 'chat:message'),
      'the room to receive the chat message',
    );

    const room = await loadRoom(code);
    if (!room) throw new Error('room disappeared mid-test');
    const { civilianWord, undercoverWord } = room.state.pair;
    expect(civilianWord).toBeTruthy();
    expect(undercoverWord).toBeTruthy();
    expect(civilianWord).not.toBe(undercoverWord);
    const secretWords = [civilianWord.toLowerCase(), undercoverWord.toLowerCase()];

    let framesChecked = 0;
    for (const harness of harnesses) {
      for (const frame of harness.frames) {
        framesChecked += 1;
        const clone = structuredClone(frame.payload);
        const you = findYouSlice(clone);
        if (you) {
          // The viewer's OWN word is the one legitimate place a secret word
          // may appear — blank it before grepping so it can't produce a
          // false positive. Everyone ELSE's word (and this player's own
          // entry inside `state.players[]`) must never carry it at all
          // (redact-for.ts: the broadcast `state` is always the spectator
          // view, even for your own entry).
          you.word = '__OWN_WORD__';
        }
        const raw = JSON.stringify(clone).toLowerCase();
        for (const secret of secretWords) {
          expect(raw, `${harness.displayName}'s "${frame.event}" frame leaked a secret word`).not.toContain(
            secret,
          );
        }

        const snapshot = findSnapshotShaped(frame.payload);
        if (snapshot) {
          assertSnapshotStructurallyRedacted(snapshot);
        }
      }
    }

    // Sanity check the audit itself isn't vacuous (i.e. it actually looked
    // at a meaningful number of frames across joins/syncs/acks/snapshots).
    expect(framesChecked).toBeGreaterThan(harnesses.length * 3);
  }, 20000);
});
