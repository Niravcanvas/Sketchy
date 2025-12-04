import { randomUUID } from 'node:crypto';
import { applyAction } from '@sketchy/engine/apply-action';
import { DEAL_TIMEOUT_SEC, SKIPPED_CLUE } from '@sketchy/engine/constants';
import type { DealtPair } from '@sketchy/engine/actions';
import { createGame } from '@sketchy/engine/create-game';
import type { GamePlayer, GameSettings } from '@sketchy/engine/types';
import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type {
  BasicAck,
  JoinAck,
  RoomEvent,
  RoomSnapshot,
} from '@sketchy/shared/contract/socket';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getRedis } from '../db/client.js';
import { games, wordPacks, wordPairs } from '../db/schema.js';
import { applyRoomAction, createRoom, gameIdKey, loadRoom } from '../rooms/room-store.js';
import { isTimerArmed } from '../rooms/timer-wheel.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

const DEFAULT_AVATAR = { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' } as const;

interface ClientHarness {
  playerId: string;
  displayName: string;
  socket: ClientSocket;
  snapshots: RoomSnapshot[];
  events: RoomEvent[];
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
    snapshots: [],
    events: [],
  };
  socket.on(SERVER_EVENTS.roomSnapshot, (snap: RoomSnapshot) => harness.snapshots.push(snap));
  socket.on(SERVER_EVENTS.roomEvent, (evt: RoomEvent) => harness.events.push(evt));
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

/** The harness (if any) whose latest snapshot says it's their clue turn. */
function currentTurnHarness(harnesses: ClientHarness[]): ClientHarness | undefined {
  return harnesses.find((h) => h.snapshots.at(-1)?.you.canAct.submitClue === true);
}

async function insertPack(
  ownerId: string,
  pairs: Array<{ wordA: string; wordB: string }>,
): Promise<string> {
  const db = getDb();
  const [pack] = await db
    .insert(wordPacks)
    .values({
      name: `Pack ${randomUUID().slice(0, 8)}`,
      isOfficial: false,
      ownerId,
      visibility: 'private',
    })
    .returning();
  if (!pack) throw new Error('pack insert failed');
  await db
    .insert(wordPairs)
    .values(pairs.map((p) => ({ packId: pack.id, wordA: p.wordA, wordB: p.wordB, difficulty: 'easy' as const })));
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

/**
 * Integration coverage for the loop-A gameplay events (`sockets/play.ts`)
 * and the timer wheel (`rooms/timer-wheel.ts`) — real socket.io-client
 * connections, real Postgres + Redis (vitest.global-setup.ts). Mirrors
 * `sockets/lobby.test.ts`'s harness style.
 */
describe('play socket integration', () => {
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
    // Best-effort cleanup so a room left mid-game (a deliberate outcome of
    // several tests below) doesn't get boot-re-armed by a LATER test's fresh
    // server in this same file/process (rooms/timer-wheel.ts's boot re-arm
    // scans the WHOLE `room:*:state` keyspace, which this suite shares with
    // every other test in the run via the dedicated test Redis db).
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

  it('full loop-A flow: deal, clue round (turn order + rejections), discussion, timer:extend, advance to voting', async () => {
    const host = await createGuest(server, { displayName: 'Host1' });
    const bob = await createGuest(server, { displayName: 'Bob1' });
    const cleo = await createGuest(server, { displayName: 'Cleo1' });
    const dee = await createGuest(server, { displayName: 'Dee1' });

    const packId = await insertPack(host.playerId, [{ wordA: 'Guitar', wordB: 'Violin' }]);

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

    // Host's socket rejoins the already-seated REST-created host; the other
    // three actually seat themselves via `room:join` — sequential so seats
    // are deterministic (1, 2, 3 in this order).
    const hostJoin = await emitAck<JoinAck>(hostClient.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!hostJoin.ok) throw new Error(`host join failed: ${hostJoin.error}`);
    const bobJoin = await emitAck<JoinAck>(bobClient.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!bobJoin.ok) throw new Error(`bob join failed: ${bobJoin.error}`);
    const cleoJoin = await emitAck<JoinAck>(cleoClient.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!cleoJoin.ok) throw new Error(`cleo join failed: ${cleoJoin.error}`);
    const deeJoin = await emitAck<JoinAck>(deeClient.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!deeJoin.ok) throw new Error(`dee join failed: ${deeJoin.error}`);

    // Tiny timers via `lobby:settings` — deliberately NOT touching `packIds`
    // (that field is gated `pack_forbidden` unless every id is an official
    // pack; our custom pack was only accepted because it rode the
    // `POST /rooms` body directly, which has no such gate).
    const settingsAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.lobbySettings, {
      clueTimerSec: 2,
      discussionTimerSec: 2,
    });
    expect(settingsAck).toEqual({ ok: true });

    const startAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.gameStart, {});
    expect(startAck).toEqual({ ok: true });

    for (const h of harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'dealing', `${h.displayName} to see dealing`);
      const you = h.snapshots.at(-1)!.you;
      expect(you.role).not.toBeNull();
      // Mr. White's word is null by design (data-model.md §4) — every other
      // role always has a non-null word. Nobody drew Mr. White in this run
      // (default settings: mrWhiteCount 0), so this simplifies to non-null,
      // but the assertion stays generically correct either way.
      expect(you.word === null ? you.role === 'mrwhite' : true).toBe(true);
      expect(you.role === 'mrwhite' ? true : you.word).not.toBeNull();
    }

    for (const h of harnesses) {
      const ackResult = await emitAck<BasicAck>(h.socket, CLIENT_EVENTS.dealAck, {});
      expect(ackResult).toEqual({ ok: true });
    }

    for (const h of harnesses) {
      await waitFor(
        () => h.snapshots.at(-1)?.state.phase === 'clue' && h.snapshots.at(-1)?.state.round === 1,
        `${h.displayName} to see clue round 1`,
      );
    }

    // Exactly one client can act; the other three must not.
    await waitFor(() => currentTurnHarness(harnesses) !== undefined, 'someone to hold the clue turn');
    let turnHolder = currentTurnHarness(harnesses) as ClientHarness;
    for (const h of harnesses) {
      expect(h.snapshots.at(-1)!.you.canAct.submitClue).toBe(h.playerId === turnHolder.playerId);
    }

    const nonTurnHolder = harnesses.find((h) => h.playerId !== turnHolder.playerId) as ClientHarness;
    const wrongTurnAck = await emitAck<BasicAck>(nonTurnHolder.socket, CLIENT_EVENTS.clueSubmit, {
      text: 'Nope',
    });
    expect(wrongTurnAck).toEqual({ ok: false, error: 'not_your_turn' });

    const clueTexts = ['Blue', 'Green', 'Yellow', 'Purple'];
    for (let i = 0; i < harnesses.length; i += 1) {
      await waitFor(() => currentTurnHarness(harnesses) !== undefined, 'a turn holder');
      turnHolder = currentTurnHarness(harnesses) as ClientHarness;

      if (i === 1) {
        // Only exercised once (mid-round): repeat / secret-word / profane
        // rejections, all from the CURRENT turn holder, none of which
        // advance the turn.
        const repeatAck = await emitAck<BasicAck>(turnHolder.socket, CLIENT_EVENTS.clueSubmit, {
          text: clueTexts[0]!.toUpperCase(), // case-insensitive repeat of round 1's clue
        });
        expect(repeatAck).toEqual({ ok: false, error: 'clue_repeated' });

        const room = await loadRoom(code);
        if (!room) throw new Error('failed to read room state for secret-word check');
        const secretWordAck = await emitAck<BasicAck>(turnHolder.socket, CLIENT_EVENTS.clueSubmit, {
          text: room.state.pair.civilianWord,
        });
        expect(secretWordAck).toEqual({ ok: false, error: 'clue_is_secret_word' });

        const profaneAck = await emitAck<BasicAck>(turnHolder.socket, CLIENT_EVENTS.clueSubmit, {
          text: 'you fucking idiot',
        });
        expect(profaneAck).toEqual({ ok: false, error: 'profanity' });
      }

      const clueAck = await emitAck<BasicAck>(turnHolder.socket, CLIENT_EVENTS.clueSubmit, {
        text: clueTexts[i] as string,
      });
      expect(clueAck).toEqual({ ok: true });
    }

    for (const h of harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'discussion', `${h.displayName} to reach discussion`);
    }

    const extendAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.timerExtend, {});
    expect(extendAck).toEqual({ ok: true });
    await waitFor(
      () => hostClient.events.some((e) => e.type === 'timerExtended'),
      'the room to see the timerExtended event',
    );
    const secondExtendAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.timerExtend, {});
    expect(secondExtendAck).toEqual({ ok: false, error: 'validation' });

    const nonHostExtendAck = await emitAck<BasicAck>(bobClient.socket, CLIENT_EVENTS.timerExtend, {});
    expect(nonHostExtendAck).toEqual({ ok: false, error: 'not_host' });

    const advanceAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.phaseAdvance, {});
    expect(advanceAck).toEqual({ ok: true });
    for (const h of harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'voting', `${h.displayName} to reach voting`);
    }

    const db = getDb();
    const gameRows = await db.select().from(games).where(eq(games.roomCode, code));
    expect(gameRows).toHaveLength(1);
    expect(gameRows[0]?.civilianWord).toBeTruthy();
    expect(gameRows[0]?.undercoverWord).toBeTruthy();
    expect(gameRows[0]?.civilianWord).not.toBe(gameRows[0]?.undercoverWord);

    const storedGameId = await getRedis().get(gameIdKey(code));
    expect(storedGameId).toBe(gameRows[0]?.id);
  }, 20000);

  it('clue and discussion timers auto-skip/auto-advance with no client emits', async () => {
    const host = await createGuest(server, { displayName: 'Host2' });
    const bob = await createGuest(server, { displayName: 'Bob2' });
    const cleo = await createGuest(server, { displayName: 'Cleo2' });

    const packId = await insertPack(host.playerId, [{ wordA: 'Mountain', wordB: 'Ocean' }]);
    const code = await createRoomViaRest(server, host.token, {
      packIds: [packId],
      difficulties: ['easy'],
      maxPlayers: 5,
    });
    createdRoomCodes.push(code);

    const hostClient = await makeClient(baseUrl, host);
    const bobClient = await makeClient(baseUrl, bob);
    const cleoClient = await makeClient(baseUrl, cleo);
    const harnesses = [hostClient, bobClient, cleoClient];
    openSockets.push(hostClient.socket, bobClient.socket, cleoClient.socket);

    for (const h of [hostClient, bobClient, cleoClient]) {
      const joinAck = await emitAck<JoinAck>(h.socket, CLIENT_EVENTS.roomJoin, { code });
      if (!joinAck.ok) throw new Error(`${h.displayName} join failed: ${joinAck.error}`);
    }

    const settingsAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.lobbySettings, {
      clueTimerSec: 2,
      discussionTimerSec: 2,
    });
    expect(settingsAck).toEqual({ ok: true });

    const startAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.gameStart, {});
    expect(startAck).toEqual({ ok: true });

    for (const h of harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'dealing', `${h.displayName} to see dealing`);
      const ackResult = await emitAck<BasicAck>(h.socket, CLIENT_EVENTS.dealAck, {});
      expect(ackResult).toEqual({ ok: true });
    }

    for (const h of harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'clue', `${h.displayName} to see clue phase`);
    }

    // No client ever calls clue:submit / turn:skip / phase:advance below —
    // every transition from here happens purely off the 2s timers.
    await waitFor(
      () => hostClient.snapshots.at(-1)?.state.phase === 'discussion',
      'discussion phase to start automatically off the clue timer',
      15000,
    );
    const cluesSoFar = hostClient.snapshots.at(-1)!.state.clues;
    expect(cluesSoFar.length).toBe(3);
    expect(cluesSoFar.every((c) => c.text === SKIPPED_CLUE)).toBe(true);

    await waitFor(
      () => hostClient.snapshots.at(-1)?.state.phase === 'voting',
      'voting phase to start automatically off the discussion timer',
      6000,
    );
  }, 30000);

  it('dealing phase deadline is ~45s out and armed in the wheel', async () => {
    const host = await createGuest(server, { displayName: 'Host3' });
    const bob = await createGuest(server, { displayName: 'Bob3' });
    const cleo = await createGuest(server, { displayName: 'Cleo3' });

    const packId = await insertPack(host.playerId, [{ wordA: 'Sun', wordB: 'Moon' }]);
    const code = await createRoomViaRest(server, host.token, {
      packIds: [packId],
      difficulties: ['easy'],
      maxPlayers: 5,
    });
    createdRoomCodes.push(code);

    const hostClient = await makeClient(baseUrl, host);
    const bobClient = await makeClient(baseUrl, bob);
    const cleoClient = await makeClient(baseUrl, cleo);
    openSockets.push(hostClient.socket, bobClient.socket, cleoClient.socket);

    for (const h of [hostClient, bobClient, cleoClient]) {
      const joinAck = await emitAck<JoinAck>(h.socket, CLIENT_EVENTS.roomJoin, { code });
      if (!joinAck.ok) throw new Error(`join failed: ${joinAck.error}`);
    }

    const before = Date.now();
    const startAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.gameStart, {});
    expect(startAck).toEqual({ ok: true });

    await waitFor(() => hostClient.snapshots.at(-1)?.state.phase === 'dealing', 'dealing phase');
    const { phaseEndsAt } = hostClient.snapshots.at(-1)!.state;
    expect(phaseEndsAt).not.toBeNull();
    expect(Math.abs((phaseEndsAt as number) - (before + DEAL_TIMEOUT_SEC * 1000))).toBeLessThan(3000);
    expect(isTimerArmed(code)).toBe(true);
  });

  it('boot re-arm: a freshly built server picks up an in-flight timer from Redis', async () => {
    const host = await createGuest(server, { displayName: 'Host4' });
    const bob = await createGuest(server, { displayName: 'Bob4' });
    const cleo = await createGuest(server, { displayName: 'Cleo4' });

    const packId = await insertPack(host.playerId, [{ wordA: 'Comet', wordB: 'Rocket' }]);
    const code = await createRoomViaRest(server, host.token, {
      packIds: [packId],
      difficulties: ['easy'],
      maxPlayers: 5,
    });
    createdRoomCodes.push(code);

    const hostClient = await makeClient(baseUrl, host);
    const bobClient = await makeClient(baseUrl, bob);
    const cleoClient = await makeClient(baseUrl, cleo);
    openSockets.push(hostClient.socket, bobClient.socket, cleoClient.socket);

    for (const h of [hostClient, bobClient, cleoClient]) {
      const joinAck = await emitAck<JoinAck>(h.socket, CLIENT_EVENTS.roomJoin, { code });
      if (!joinAck.ok) throw new Error(`join failed: ${joinAck.error}`);
    }

    const settingsAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.lobbySettings, {
      clueTimerSec: 2,
    });
    expect(settingsAck).toEqual({ ok: true });

    const startAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.gameStart, {});
    expect(startAck).toEqual({ ok: true });

    for (const h of [hostClient, bobClient, cleoClient]) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'dealing', 'dealing phase');
      const ackResult = await emitAck<BasicAck>(h.socket, CLIENT_EVENTS.dealAck, {});
      expect(ackResult).toEqual({ ok: true });
    }
    await waitFor(() => hostClient.snapshots.at(-1)?.state.phase === 'clue', 'clue phase');
    const cluesBeforeRestart = hostClient.snapshots.at(-1)!.state.clues.length;

    // Simulate a process restart: close the sockets AND the server (clearing
    // this process's in-memory timer wheel entirely — `clearAllTimers()` on
    // fastify's `onClose`), then build a brand-new server against the SAME
    // Redis. Reassigning `server` means the outer `afterEach` closes THIS
    // new instance, not the already-closed original.
    for (const socket of openSockets.splice(0)) {
      socket.close();
    }
    await server.close();

    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });

    const reconnected = await makeClient(baseUrl, host);
    openSockets.push(reconnected.socket);
    const rejoinAck = await emitAck<JoinAck>(reconnected.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!rejoinAck.ok) throw new Error(`rejoin failed: ${rejoinAck.error}`);

    await waitFor(
      () => (reconnected.snapshots.at(-1)?.state.clues.length ?? 0) > cluesBeforeRestart,
      'the clue timer to fire on the NEW server, proving Redis is the source of truth',
      6000,
    );
  }, 20000);

  it('Mr. White never lands on seat 0 (mrWhiteFirstClueBan) across 20 fresh deals', async () => {
    const settings: GameSettings = {
      maxPlayers: 5,
      undercoverCount: 0,
      mrWhiteCount: 1,
      specialRoles: [],
      packIds: [],
      difficulties: ['easy', 'medium', 'hard'],
      clueTimerSec: 60,
      discussionTimerSec: 120,
      voteTimerSec: 45,
      mrWhiteFirstClueBan: true,
      eliminationReveal: 'role',
    };
    const playerIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    const pair: DealtPair = { wordA: 'Alpha', wordB: 'Beta', pairId: null };

    for (let i = 0; i < 20; i += 1) {
      const code = `MWSEAT${i}`;
      const players = playerIds.map((id, seat) => fakePlayer(id, `Player${seat}`, seat));
      const state = {
        ...createGame(settings, players, `seed-${i}`, Date.now()),
        mode: 'online_private' as const,
        code,
      };
      const created = await createRoom(code, state);
      expect(created).toBe(true);
      createdRoomCodes.push(code);

      const result = await applyRoomAction(code, (s) =>
        applyAction(s, { type: 'start', playerId: playerIds[0] as string, pair, at: Date.now() }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state.players[0]?.role).not.toBe('mrwhite');
      }
    }
  });

  it('turn-holder disconnects mid-clue: timer keeps running, host skip advances, rejoin restores', async () => {
    const host = await createGuest(server, { displayName: 'Host5' });
    const bob = await createGuest(server, { displayName: 'Bob5' });
    const cleo = await createGuest(server, { displayName: 'Cleo5' });

    const packId = await insertPack(host.playerId, [{ wordA: 'River', wordB: 'Lake' }]);
    const code = await createRoomViaRest(server, host.token, {
      packIds: [packId],
      difficulties: ['easy'],
      maxPlayers: 5,
    });
    createdRoomCodes.push(code);

    const hostClient = await makeClient(baseUrl, host);
    const bobClient = await makeClient(baseUrl, bob);
    const cleoClient = await makeClient(baseUrl, cleo);
    const harnesses = [hostClient, bobClient, cleoClient];
    openSockets.push(hostClient.socket, bobClient.socket, cleoClient.socket);

    // Join order fixes seats: host is seat 0 (REST-created, rejoins here), then
    // bob seat 1, cleo seat 2.
    for (const h of harnesses) {
      const joinAck = await emitAck<JoinAck>(h.socket, CLIENT_EVENTS.roomJoin, { code });
      if (!joinAck.ok) throw new Error(`${h.displayName} join failed: ${joinAck.error}`);
    }

    // A long clue timer: this test drives the stalled turn forward with a host
    // SKIP, never the timer — so 60s guarantees the timer never fires during
    // the test and the only thing that can advance the turn is `turn:skip`. We
    // still assert the timer stays ARMED after the disconnect (the disconnected
    // clue-giver's countdown keeps running server-side).
    const settingsAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.lobbySettings, {
      clueTimerSec: 60,
    });
    expect(settingsAck).toEqual({ ok: true });

    const startAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.gameStart, {});
    expect(startAck).toEqual({ ok: true });

    for (const h of harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'dealing', `${h.displayName} to see dealing`);
      const ackResult = await emitAck<BasicAck>(h.socket, CLIENT_EVENTS.dealAck, {});
      expect(ackResult).toEqual({ ok: true });
    }
    for (const h of harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'clue', `${h.displayName} to see clue phase`);
    }

    // Seat 0 (the host) holds the first turn; advance past it with a real clue
    // so the NEXT (stalled) turn-holder is a non-host — the host must stay
    // connected to issue `turn:skip`.
    await waitFor(() => currentTurnHarness(harnesses) !== undefined, 'a turn holder');
    const firstHolder = currentTurnHarness(harnesses) as ClientHarness;
    expect(firstHolder.playerId).toBe(host.playerId);
    const firstClueAck = await emitAck<BasicAck>(firstHolder.socket, CLIENT_EVENTS.clueSubmit, {
      text: 'Flowing',
    });
    expect(firstClueAck).toEqual({ ok: true });

    await waitFor(
      () => {
        const h = currentTurnHarness(harnesses);
        return h !== undefined && h.playerId !== host.playerId;
      },
      'a non-host to hold the clue turn',
    );
    const stalled = currentTurnHarness(harnesses) as ClientHarness;
    const stalledId = stalled.playerId;
    const stalledSession = stalledId === bob.playerId ? bob : cleo;
    const bystander = harnesses.find((h) => h.playerId !== host.playerId && h.playerId !== stalledId)!;
    const turnSeatBefore = hostClient.snapshots.at(-1)!.state.turnSeat;
    const phaseEndsAtBefore = hostClient.snapshots.at(-1)!.state.phaseEndsAt;
    const cluesBefore = hostClient.snapshots.at(-1)!.state.clues.length;

    // The turn-holder "closes their tab".
    stalled.socket.close();

    // Other devices see the player go disconnected — but the turn does NOT
    // advance on its own: same turnSeat, same (non-null) deadline, and the
    // wheel timer is still armed. The countdown "visibly continues" everywhere,
    // and no other player becomes able to act.
    await waitFor(
      () => hostClient.snapshots.at(-1)?.state.players.find((p) => p.id === stalledId)?.connected === false,
      'the host to see the stalled player disconnected',
    );
    expect(hostClient.snapshots.at(-1)!.state.phase).toBe('clue');
    expect(hostClient.snapshots.at(-1)!.state.turnSeat).toBe(turnSeatBefore);
    expect(hostClient.snapshots.at(-1)!.state.phaseEndsAt).toBe(phaseEndsAtBefore);
    expect(hostClient.snapshots.at(-1)!.state.phaseEndsAt).not.toBeNull();
    expect(isTimerArmed(code)).toBe(true);
    expect(bystander.snapshots.at(-1)!.you.canAct.submitClue).toBe(false);

    // Host skips the stalled turn (game-design.md §8, api-contract §2.1).
    const skipAck = await emitAck<BasicAck>(hostClient.socket, CLIENT_EVENTS.turnSkip, {});
    expect(skipAck).toEqual({ ok: true });

    // The skip lands a muted "(skipped)" clue for the disconnected player and
    // moves the turn on — observed from a still-connected device.
    await waitFor(
      () => (hostClient.snapshots.at(-1)?.state.clues.length ?? 0) > cluesBefore,
      'the skip to append a clue and advance the turn',
    );
    const skippedClue = hostClient.snapshots.at(-1)!.state.clues.at(-1)!;
    expect(skippedClue.playerId).toBe(stalledId);
    expect(skippedClue.text).toBe(SKIPPED_CLUE);
    expect(hostClient.snapshots.at(-1)!.state.phase).toBe('clue');

    // The player reopens the tab: a fresh socket, same identity, `room:join`
    // (api-contract §2.3 — idempotent rejoin for an already-seated player)
    // returns a full snapshot at the CURRENT phase, presence flips back, and
    // the room is told.
    const rejoined = await makeClient(baseUrl, stalledSession);
    openSockets.push(rejoined.socket);
    const rejoinAck = await emitAck<JoinAck>(rejoined.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!rejoinAck.ok) throw new Error(`rejoin failed: ${rejoinAck.error}`);
    expect(rejoinAck.snapshot.state.phase).toBe(hostClient.snapshots.at(-1)!.state.phase);
    expect(rejoinAck.snapshot.state.phase).toBe('clue');
    expect(rejoinAck.snapshot.state.players.find((p) => p.id === stalledId)?.connected).toBe(true);
    await waitFor(
      () => hostClient.events.some((e) => e.type === 'playerReconnected' && e.playerId === stalledId),
      'the host to see the reconnect toast',
    );
  }, 20000);
});
