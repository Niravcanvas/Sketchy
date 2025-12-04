import { randomUUID } from 'node:crypto';
import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type { BasicAck, JoinAck, RoomEvent, RoomSnapshot } from '@sketchy/shared/contract/socket';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getRedis } from '../db/client.js';
import { gamePlayers, games, players, wordPacks, wordPairs } from '../db/schema.js';
import { gameIdKey } from '../rooms/room-store.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp, type GuestSession } from '../test-support.js';

// ---------------------------------------------------------------------------
// Harness (mirrors sockets/play.test.ts — real socket.io clients, real PG+Redis).
// ---------------------------------------------------------------------------

interface ClientHarness {
  playerId: string;
  displayName: string;
  socket: ClientSocket;
  snapshots: RoomSnapshot[];
  events: RoomEvent[];
}

interface Table {
  server: FastifyInstance;
  baseUrl: string;
  code: string;
  harnesses: ClientHarness[];
  host: ClientHarness;
  sessions: GuestSession[];
  clueCounter: number;
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

async function waitFor(predicate: () => boolean, description: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function insertPack(ownerId: string, pairs: Array<{ wordA: string; wordB: string }>): Promise<string> {
  const db = getDb();
  const [pack] = await db
    .insert(wordPacks)
    .values({ name: `Pack ${randomUUID().slice(0, 8)}`, isOfficial: false, ownerId, visibility: 'private' })
    .returning();
  if (!pack) throw new Error('pack insert failed');
  await db
    .insert(wordPairs)
    .values(pairs.map((p) => ({ packId: pack.id, wordA: p.wordA, wordB: p.wordB, difficulty: 'easy' as const })));
  return pack.id;
}

async function createRoomViaRest(server: FastifyInstance, token: string, settings: Record<string, unknown>): Promise<string> {
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

// ---------------------------------------------------------------------------
// Game-driver helpers — read roles from the you-slices, then orchestrate.
// ---------------------------------------------------------------------------

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

function latest(h: ClientHarness): RoomSnapshot {
  const snap = h.snapshots.at(-1);
  if (!snap) throw new Error(`${h.displayName} has no snapshot yet`);
  return snap;
}

function phaseOf(table: Table): string {
  return latest(table.host).state.phase;
}

function pendingOf(table: Table): string | null {
  return latest(table.host).state.pendingElimination;
}

function harnessFor(table: Table, playerId: string): ClientHarness {
  const h = table.harnesses.find((hh) => hh.playerId === playerId);
  if (!h) throw new Error(`no harness for ${playerId}`);
  return h;
}

function aliveIds(table: Table): string[] {
  return latest(table.host).state.players.filter((p) => p.alive).map((p) => p.id);
}

/** playerId → role, read from each client's OWN you-slice (never someone else's secret). */
function roleMap(table: Table): Map<string, BaseRole> {
  const map = new Map<string, BaseRole>();
  for (const h of table.harnesses) {
    const role = latest(h).you.role;
    if (role) map.set(h.playerId, role);
  }
  return map;
}

function idsWithRole(table: Table, role: BaseRole): string[] {
  return [...roleMap(table).entries()].filter(([, r]) => r === role).map(([id]) => id);
}

/** A Civilian's own word == the shared civilian word (all civilians hold it). */
function civilianWord(table: Table): string {
  for (const h of table.harnesses) {
    const you = latest(h).you;
    if (you.role === 'civilian' && you.word) return you.word;
  }
  throw new Error('no civilian word found');
}

function isCluePhase(table: Table): boolean {
  const phase = phaseOf(table);
  return phase === 'clue' || phase === 'tiebreak_clue';
}

function currentTurnHolder(table: Table): ClientHarness | undefined {
  return table.harnesses.find((h) => h.snapshots.at(-1)?.you.canAct.submitClue === true);
}

/** Submit a unique clue for every turn-holder until the clue/tiebreak phase ends. */
async function submitCluesForRound(table: Table): Promise<void> {
  while (isCluePhase(table)) {
    await waitFor(
      () => currentTurnHolder(table) !== undefined || !isCluePhase(table),
      'a clue turn-holder or the clue phase to end',
    );
    if (!isCluePhase(table)) return;
    const holder = currentTurnHolder(table);
    if (!holder) continue;
    const holderId = holder.playerId;
    table.clueCounter += 1;
    const ack = await emitAck<BasicAck>(holder.socket, CLIENT_EVENTS.clueSubmit, {
      text: `clue${table.clueCounter}`,
    });
    if (!ack.ok) throw new Error(`clue submit failed for ${holderId}: ${ack.error}`);
    await waitFor(
      () => currentTurnHolder(table)?.playerId !== holderId || !isCluePhase(table),
      'the clue turn to advance',
    );
  }
}

async function hostAdvanceToVoting(table: Table): Promise<void> {
  await waitFor(() => phaseOf(table) === 'discussion', 'discussion phase');
  const ack = await emitAck<BasicAck>(table.host.socket, CLIENT_EVENTS.phaseAdvance, {});
  if (!ack.ok) throw new Error(`host advance to voting failed: ${ack.error}`);
  await waitFor(() => phaseOf(table) === 'voting', 'voting phase');
}

/** Cast an explicit set of ballots (voter → target). */
async function castBallots(table: Table, assignments: Array<[string, string]>): Promise<void> {
  for (const [voterId, targetId] of assignments) {
    const ack = await emitAck<BasicAck>(harnessFor(table, voterId).socket, CLIENT_EVENTS.voteCast, {
      targetId,
    });
    if (!ack.ok) throw new Error(`vote ${voterId} -> ${targetId} failed: ${ack.error}`);
  }
}

/** Everyone alive votes `targetId` out (the target casts a throwaway ballot at someone else,
 * since self-votes are rejected and an un-cast ballot would keep the untimed vote open). */
async function voteOutAndReveal(table: Table, targetId: string): Promise<void> {
  const alive = aliveIds(table);
  const other = alive.find((id) => id !== targetId);
  if (!other) throw new Error('no non-target voter available');
  const assignments: Array<[string, string]> = alive.map((id) =>
    id === targetId ? [id, other] : [id, targetId],
  );
  await castBallots(table, assignments);
  await waitFor(
    () => phaseOf(table) === 'reveal' && pendingOf(table) === targetId,
    `reveal of ${targetId}`,
  );
}

/** Host dismisses the reveal; the engine routes to mrwhite_guess / next round / game over. */
async function advanceReveal(table: Table): Promise<void> {
  const ack = await emitAck<BasicAck>(table.host.socket, CLIENT_EVENTS.phaseAdvance, {});
  if (!ack.ok) throw new Error(`advance reveal failed: ${ack.error}`);
  await waitFor(() => phaseOf(table) !== 'reveal', 'the reveal to resolve');
}

async function mrWhiteGuesses(table: Table, guesserId: string, word: string): Promise<void> {
  await waitFor(() => phaseOf(table) === 'mrwhite_guess', 'the mrwhite guess window');
  const ack = await emitAck<BasicAck>(harnessFor(table, guesserId).socket, CLIENT_EVENTS.mrWhiteGuess, {
    word,
  });
  if (!ack.ok) throw new Error(`mrwhite guess failed: ${ack.error}`);
  await waitFor(() => phaseOf(table) !== 'mrwhite_guess', 'the guess to resolve');
}

/** One full round that eliminates a non-Mr.-White target (clue → discussion → vote → reveal). */
async function roundEliminating(table: Table, targetId: string): Promise<void> {
  await submitCluesForRound(table);
  await hostAdvanceToVoting(table);
  await voteOutAndReveal(table, targetId);
  await advanceReveal(table);
}

async function setupTable(
  server: FastifyInstance,
  baseUrl: string,
  namePrefix: string,
  pairs: Array<{ wordA: string; wordB: string }>,
): Promise<Table> {
  const sessions: GuestSession[] = [];
  for (let i = 0; i < 5; i += 1) {
    sessions.push(await createGuest(server, { displayName: `${namePrefix}${i}` }));
  }
  const host = sessions[0]!;
  const packId = await insertPack(host.playerId, pairs);
  const code = await createRoomViaRest(server, host.token, {
    packIds: [packId],
    difficulties: ['easy'],
    maxPlayers: 6,
  });

  const harnesses: ClientHarness[] = [];
  for (const session of sessions) {
    const client = await makeClient(baseUrl, session);
    harnesses.push(client);
    const joinAck = await emitAck<JoinAck>(client.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!joinAck.ok) throw new Error(`${session.displayName} join failed: ${joinAck.error}`);
  }

  const table: Table = { server, baseUrl, code, harnesses, host: harnesses[0]!, sessions, clueCounter: 0 };

  // 1 undercover + 1 mrwhite + 3 civilians, and untimed clue/discussion/vote so every phase
  // transition is driven by an explicit action, not a racing timer (dealing/reveal/mrwhite
  // timers still exist but are acted on promptly).
  const settingsAck = await emitAck<BasicAck>(table.host.socket, CLIENT_EVENTS.lobbySettings, {
    undercoverCount: 1,
    mrWhiteCount: 1,
    clueTimerSec: null,
    discussionTimerSec: null,
    voteTimerSec: null,
  });
  if (!settingsAck.ok) throw new Error(`settings failed: ${settingsAck.error}`);

  return table;
}

async function startAndDeal(table: Table): Promise<void> {
  const startAck = await emitAck<BasicAck>(table.host.socket, CLIENT_EVENTS.gameStart, {});
  if (!startAck.ok) throw new Error(`start failed: ${startAck.error}`);
  for (const h of table.harnesses) {
    await waitFor(() => h.snapshots.at(-1)?.state.phase === 'dealing', `${h.displayName} to deal`);
    const ackResult = await emitAck<BasicAck>(h.socket, CLIENT_EVENTS.dealAck, {});
    if (!ackResult.ok) throw new Error(`deal ack failed: ${ackResult.error}`);
  }
  for (const h of table.harnesses) {
    await waitFor(() => h.snapshots.at(-1)?.state.phase === 'clue', `${h.displayName} to reach clue`);
  }
}

/** Poll the DB until this room's game is completed (persistGame is fire-and-forget). */
async function waitForPersistedGames(code: string, expectedCount: number): Promise<Array<typeof games.$inferSelect>> {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const rows = await getDb()
      .select()
      .from(games)
      .where(eq(games.roomCode, code))
      .orderBy(asc(games.startedAt));
    const finished = rows.filter((r) => r.endedAt !== null);
    if (finished.length >= expectedCount) return finished;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`room ${code}: expected ${expectedCount} persisted game(s)`);
}

// ---------------------------------------------------------------------------

describe('online loop B — voting → reveal → mrwhite → win → rematch (full loop)', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  const openTables: Table[] = [];

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });

  afterEach(async () => {
    for (const table of openTables.splice(0)) {
      for (const h of table.harnesses) h.socket.close();
    }
    await server.close();
    const redis = getRedis();
    // Clean every room key so a mid-run room isn't boot-re-armed by a later test.
    const keys = await redis.keys('room:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  it('civilians win via a tie-break then a clean sweep; DB rows + scoreboard correct', async () => {
    const table = await setupTable(server, baseUrl, 'Civ', [{ wordA: 'Latte', wordB: 'Espresso' }]);
    openTables.push(table);
    await startAndDeal(table);

    const uc = idsWithRole(table, 'undercover')[0]!;
    const mw = idsWithRole(table, 'mrwhite')[0]!;
    const civs = idsWithRole(table, 'civilian');
    expect(civs).toHaveLength(3);

    // Round 1: force a 2-2 tie between the undercover and a civilian, then re-vote the
    // undercover out among the tied pair.
    await submitCluesForRound(table);
    await hostAdvanceToVoting(table);
    await castBallots(table, [
      [uc, civs[0]!],
      [mw, uc],
      [civs[0]!, uc],
      [civs[1]!, civs[0]!],
      [civs[2]!, civs[1]!],
    ]);
    await waitFor(() => phaseOf(table) === 'tiebreak_clue', 'a tie to route to tiebreak_clue');
    await submitCluesForRound(table); // tied players give one more clue each → re-vote
    await waitFor(
      () => phaseOf(table) === 'voting' && latest(table.host).state.revoteCount === 1,
      'the sudden-death re-vote',
    );
    await castBallots(table, [
      [uc, civs[0]!],
      [mw, uc],
      [civs[0]!, uc],
      [civs[1]!, uc],
      [civs[2]!, uc],
    ]);
    await waitFor(() => phaseOf(table) === 'reveal' && pendingOf(table) === uc, 'the undercover reveal');
    await advanceReveal(table);

    // Round 2: vote the Mr. White out; they guess WRONG → civilians win.
    await roundEliminatingMrWhite(table, mw, 'zzzznotaword', 'civilian');

    await waitFor(() => phaseOf(table) === 'game_over', 'game over');
    const finalState = latest(table.host).state;
    expect(finalState.winnerFaction).toBe('civilian');
    for (const civ of civs) expect(finalState.scoreboard[civ]).toBe(2);
    expect(finalState.scoreboard[uc] ?? 0).toBe(0);
    expect(finalState.scoreboard[mw] ?? 0).toBe(0);

    const [gameRow] = await waitForPersistedGames(table.code, 1);
    if (!gameRow) throw new Error('no game row');
    expect(gameRow.winnerFaction).toBe('civilian');
    expect(gameRow.roundsPlayed).toBe(2);
    expect(gameRow.summary).not.toBeNull();
    expect(await getRedis().get(gameIdKey(table.code))).toBe(gameRow.id);

    const gpRows = await getDb().select().from(gamePlayers).where(eq(gamePlayers.gameId, gameRow.id));
    expect(gpRows).toHaveLength(5);
    for (const row of gpRows) {
      if (row.role === 'civilian') {
        expect(row.won).toBe(true);
        expect(row.points).toBe(2);
      } else {
        expect(row.won).toBe(false);
        expect(row.points).toBe(0);
      }
    }
    // The per-game points summed into each player's lifetime total.
    const civRow = await getDb().select().from(players).where(eq(players.id, civs[0]!));
    expect(civRow[0]?.totalPoints).toBe(2);
    expect(civRow[0]?.gamesPlayed).toBe(1);
    expect(civRow[0]?.gamesWon).toBe(1);
  }, 30000);

  it('the undercover survives to the end and wins (+10)', async () => {
    const table = await setupTable(server, baseUrl, 'Uc', [{ wordA: 'Piano', wordB: 'Organ' }]);
    openTables.push(table);
    await startAndDeal(table);

    const uc = idsWithRole(table, 'undercover')[0]!;
    const mw = idsWithRole(table, 'mrwhite')[0]!;
    const civs = idsWithRole(table, 'civilian');

    // Round 1: Mr. White out (wrong guess). Rounds 2-3: two civilians out → 1 civ + 1 uc left.
    await roundEliminatingMrWhite(table, mw, 'zzzznotaword', null);
    await roundEliminating(table, civs[0]!);
    await roundEliminating(table, civs[1]!);

    await waitFor(() => phaseOf(table) === 'game_over', 'game over');
    const finalState = latest(table.host).state;
    expect(finalState.winnerFaction).toBe('undercover');
    expect(finalState.scoreboard[uc]).toBe(10);

    const [gameRow] = await waitForPersistedGames(table.code, 1);
    if (!gameRow) throw new Error('no game row');
    expect(gameRow.winnerFaction).toBe('undercover');
    const gpRows = await getDb().select().from(gamePlayers).where(eq(gamePlayers.gameId, gameRow.id));
    const ucRow = gpRows.find((r) => r.playerId === uc);
    expect(ucRow?.won).toBe(true);
    expect(ucRow?.points).toBe(10);
    expect(ucRow?.eliminatedRound).toBeNull();
  }, 30000);

  it('undercover + Mr. White jointly infiltrate to the end (10 / 6)', async () => {
    const table = await setupTable(server, baseUrl, 'Inf', [{ wordA: 'Beach', wordB: 'Desert' }]);
    openTables.push(table);
    await startAndDeal(table);

    const uc = idsWithRole(table, 'undercover')[0]!;
    const mw = idsWithRole(table, 'mrwhite')[0]!;
    const civs = idsWithRole(table, 'civilian');

    // Vote out two civilians, sparing both impostors → civilianAlive <= 1 with both alive.
    await roundEliminating(table, civs[0]!);
    await roundEliminating(table, civs[1]!);

    await waitFor(() => phaseOf(table) === 'game_over', 'game over');
    const finalState = latest(table.host).state;
    expect(finalState.winnerFaction).toBe('infiltrators');
    expect(finalState.scoreboard[uc]).toBe(10);
    expect(finalState.scoreboard[mw]).toBe(6);

    const [gameRow] = await waitForPersistedGames(table.code, 1);
    if (!gameRow) throw new Error('no game row');
    expect(gameRow.winnerFaction).toBe('infiltrators');
    const gpRows = await getDb().select().from(gamePlayers).where(eq(gamePlayers.gameId, gameRow.id));
    expect(gpRows.find((r) => r.playerId === uc)?.points).toBe(10);
    expect(gpRows.find((r) => r.playerId === mw)?.points).toBe(6);
    expect(gpRows.filter((r) => r.role === 'civilian').every((r) => !r.won)).toBe(true);
  }, 30000);

  it('Mr. White is caught but steals the win with a correct guess (+6)', async () => {
    const table = await setupTable(server, baseUrl, 'Steal', [{ wordA: 'Comet', wordB: 'Meteor' }]);
    openTables.push(table);
    await startAndDeal(table);

    const mw = idsWithRole(table, 'mrwhite')[0]!;
    const word = civilianWord(table);

    await submitCluesForRound(table);
    await hostAdvanceToVoting(table);
    await voteOutAndReveal(table, mw);
    await advanceReveal(table); // reveal → mrwhite_guess
    await mrWhiteGuesses(table, mw, word.toUpperCase()); // case-insensitive → correct

    await waitFor(() => phaseOf(table) === 'game_over', 'the steal to end the game');
    const finalState = latest(table.host).state;
    expect(finalState.winnerFaction).toBe('mrwhite');
    expect(finalState.lastGuess?.correct).toBe(true);
    expect(finalState.scoreboard[mw]).toBe(6);

    const [gameRow] = await waitForPersistedGames(table.code, 1);
    if (!gameRow) throw new Error('no game row');
    expect(gameRow.winnerFaction).toBe('mrwhite');
    const gpRows = await getDb().select().from(gamePlayers).where(eq(gamePlayers.gameId, gameRow.id));
    const mwRow = gpRows.find((r) => r.playerId === mw);
    expect(mwRow?.won).toBe(true);
    expect(mwRow?.points).toBe(6);
    expect(mwRow?.word).toBeNull(); // Mr. White never held a word
  }, 30000);

  it('rematch carries the scoreboard forward and never repeats a pair in the session', async () => {
    const table = await setupTable(server, baseUrl, 'Re', [
      { wordA: 'Latte', wordB: 'Espresso' },
      { wordA: 'Piano', wordB: 'Organ' },
    ]);
    openTables.push(table);

    // Game 1: infiltrators (fast — two civilian eliminations).
    await startAndDeal(table);
    let civs = idsWithRole(table, 'civilian');
    await roundEliminating(table, civs[0]!);
    await roundEliminating(table, civs[1]!);
    await waitFor(() => phaseOf(table) === 'game_over', 'game 1 over');
    const scoreAfterGame1 = { ...latest(table.host).state.scoreboard };
    const game1Rows = await waitForPersistedGames(table.code, 1);
    const game1PairId = game1Rows[0]!.pairId;

    // Host rematch → fresh deal, scoreboard carried, a DIFFERENT pair drawn.
    const rematchAck = await emitAck<BasicAck>(table.host.socket, CLIENT_EVENTS.gameRematch, {});
    expect(rematchAck).toEqual({ ok: true });
    for (const h of table.harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'dealing', `${h.displayName} to re-deal`);
    }
    // Scoreboard carried into the new game's snapshot.
    expect(latest(table.host).state.scoreboard).toEqual(scoreAfterGame1);
    expect(latest(table.host).state.gamesPlayedInRoom).toBe(1);

    // Finish game 2 (any faction — drive another infiltration).
    for (const h of table.harnesses) {
      const ackResult = await emitAck<BasicAck>(h.socket, CLIENT_EVENTS.dealAck, {});
      if (!ackResult.ok) throw new Error(`deal ack failed: ${ackResult.error}`);
    }
    for (const h of table.harnesses) {
      await waitFor(() => h.snapshots.at(-1)?.state.phase === 'clue', `${h.displayName} clue (game 2)`);
    }
    civs = idsWithRole(table, 'civilian');
    await roundEliminating(table, civs[0]!);
    await roundEliminating(table, civs[1]!);
    await waitFor(() => phaseOf(table) === 'game_over', 'game 2 over');

    const bothGames = await waitForPersistedGames(table.code, 2);
    expect(bothGames).toHaveLength(2);
    // Two distinct games rows, two distinct pairs (session de-dup).
    expect(bothGames[0]!.id).not.toBe(bothGames[1]!.id);
    expect(bothGames[1]!.pairId).not.toBe(game1PairId);

    // Session scoreboard accumulated across both games; lifetime totals reflect 2 games.
    const finalScore = latest(table.host).state.scoreboard;
    const uc = idsWithRole(table, 'undercover')[0]!;
    expect(finalScore[uc]).toBeGreaterThanOrEqual(scoreAfterGame1[uc] ?? 0);
    const anyPlayer = await getDb().select().from(players).where(eq(players.id, table.host.playerId));
    expect(anyPlayer[0]?.gamesPlayed).toBe(2);
  }, 45000);
});

/** One full round that ends on a Mr. White elimination + guess. `expectWinner` asserts the
 * post-guess faction (or `null` when play should continue after a wrong guess). */
async function roundEliminatingMrWhite(
  table: Table,
  mwId: string,
  guessWord: string,
  expectWinner: 'civilian' | 'undercover' | 'mrwhite' | 'infiltrators' | null,
): Promise<void> {
  await submitCluesForRound(table);
  await hostAdvanceToVoting(table);
  await voteOutAndReveal(table, mwId);
  await advanceReveal(table); // reveal → mrwhite_guess
  await mrWhiteGuesses(table, mwId, guessWord);
  if (expectWinner !== null) {
    await waitFor(() => phaseOf(table) === 'game_over', 'game over after the guess');
    expect(latest(table.host).state.winnerFaction).toBe(expectWinner);
  }
}
