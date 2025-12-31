import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { gamePlayers, games } from '../../src/db/schema.js';
import { clearAllGraceTimers, stopAbandonSweeper } from '../../src/rooms/presence-timers.js';
import { loadRoom } from '../../src/rooms/room-store.js';
import { buildServer } from '../../src/server.js';
import { sleep } from '../bots/socket-bot.js';
import { closeTable, createTable } from '../bots/table.js';

/**
 * Abandoned-room reaping (game-design.md §8): every player
 * disconnected mid-game past the abandon deadline → the game is persisted as
 * UNFINISHED (winner NULL) and the room is freed. Uses shrunk `ABANDON_MS` /
 * `ABANDON_SWEEP_MS` so the background reaper acts in ~sub-second instead of the
 * 10-minute spec default.
 */

const saved: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  saved[key] = process.env[key];
  process.env[key] = value;
}
function restoreEnv(): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('abandoned-room reaping', () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeAll(() => {
    setEnv('ABANDON_MS', '200');
    setEnv('ABANDON_SWEEP_MS', '80');
    setEnv('GRACE_WINDOW_MS', '120');
  });
  afterAll(() => {
    restoreEnv();
  });

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });
  afterEach(async () => {
    clearAllGraceTimers();
    stopAbandonSweeper();
    await server.close();
  });

  it('persists an all-disconnected mid-game room as unfinished (winner NULL) and frees it', async () => {
    const table = await createTable(server, baseUrl, { n: 3, namePrefix: 'Abandon' });
    let gameId: string | undefined;
    try {
      await table.host.waitForPhase('clue');
      const roomCode = table.code;

      const [row] = await getDb().select().from(games).where(eq(games.roomCode, roomCode)).limit(1);
      expect(row).toBeDefined();
      gameId = row!.id;
      expect(row!.endedAt).toBeNull();
      expect(row!.winnerFaction).toBeNull();

      // Everyone's phone dies at once.
      for (const bot of table.bots) bot.hardDisconnect();

      // Wait past the abandon deadline for the background reaper to act.
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if ((await loadRoom(roomCode)) === null) break;
        await sleep(80);
      }

      // Room freed from Redis.
      expect(await loadRoom(roomCode)).toBeNull();

      // Game persisted as UNFINISHED.
      const [after] = await getDb().select().from(games).where(eq(games.id, gameId)).limit(1);
      expect(after!.endedAt).not.toBeNull();
      expect(after!.winnerFaction).toBeNull();
      expect(after!.summary).not.toBeNull();

      // History rows written for every player, no points, no win.
      const gpRows = await getDb().select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
      expect(gpRows.length).toBe(3);
      expect(gpRows.every((r) => r.points === 0 && r.won === false)).toBe(true);
    } finally {
      closeTable(table);
    }
  });

  it('does NOT reap a room while at least one player stays connected', async () => {
    const table = await createTable(server, baseUrl, { n: 3, namePrefix: 'Survive' });
    try {
      await table.host.waitForPhase('clue');
      const roomCode = table.code;

      // All but one drop.
      table.bots[1]!.hardDisconnect();
      table.bots[2]!.hardDisconnect();

      // Well past the abandon deadline — the lone survivor keeps the room alive.
      await sleep(700);
      expect(await loadRoom(roomCode)).not.toBeNull();
    } finally {
      closeTable(table);
    }
  });
});
