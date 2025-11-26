import { randomUUID } from 'node:crypto';
import { makeSettings } from '@sketchy/engine/test-support';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client.js';
import { gamePlayers, games, players } from '../src/db/schema.js';
import { findDrift } from './reconcile-totals.js';

/**
 * This file proves `findDrift` itself is correct in isolation
 * (zero drift on consistent data, exactly-the-right row on a manufactured drift, abandoned
 * games correctly excluded from both sides of the comparison); running it against the REAL
 * database after a full chaos-suite run is a separate, manual verification step.
 */

async function insertPlayer(displayName: string): Promise<string> {
  const db = getDb();
  const [row] = await db.insert(players).values({ displayName, isGuest: true }).returning();
  if (!row) throw new Error('insertPlayer failed');
  return row.id;
}

/** Inserts a `games` + `game_players` row and, for a FINISHED game, bumps the player's
 * denormalized totals the same way `rooms/persist-game.ts` does — i.e. builds
 * ALREADY-CONSISTENT data by construction, so a test only introduces drift when it
 * deliberately corrupts one side afterward. */
async function insertConsistentGame(opts: {
  playerId: string;
  points: number;
  won: boolean;
  finished: boolean;
}): Promise<void> {
  const db = getDb();
  const gameId = randomUUID();
  await db.insert(games).values({
    id: gameId,
    roomCode: 'ABCJK',
    mode: 'online_private',
    hostPlayerId: opts.playerId,
    settings: makeSettings(),
    civilianWord: 'Latte',
    undercoverWord: 'Espresso',
    roundsPlayed: 2,
    winnerFaction: opts.finished ? 'civilian' : undefined,
    endedAt: new Date(),
  });
  await db.insert(gamePlayers).values({
    gameId,
    playerId: opts.playerId,
    seat: 0,
    role: 'civilian',
    points: opts.finished ? opts.points : 0,
    won: opts.finished && opts.won,
    wasHost: true,
  });
  if (opts.finished) {
    await db
      .update(players)
      .set({
        totalPoints: sql`${players.totalPoints} + ${opts.points}`,
        gamesPlayed: sql`${players.gamesPlayed} + 1`,
        gamesWon: sql`${players.gamesWon} + ${opts.won ? 1 : 0}`,
      })
      .where(eq(players.id, opts.playerId));
  }
}

// Reconciliation reads the WHOLE `players` table, so leftover rows from a previous run would
// corrupt the "zero drift" assertions below — every test cleans up its own player row in a
// `finally` block (cascades to its games/game_players, data-model.md §1 deletion note).
describe('findDrift', () => {
  it('reports zero drift for a freshly-created player with no games', async () => {
    const db = getDb();
    const playerId = await insertPlayer('ReconcileFreshPlayer');
    try {
      const drift = await findDrift(db);
      expect(drift.find((row) => row.playerId === playerId)).toBeUndefined();
    } finally {
      await db.delete(players).where(eq(players.id, playerId));
    }
  });

  it('reports zero drift for a player whose denormalized totals match SUM(game_players)', async () => {
    const db = getDb();
    const playerId = await insertPlayer('ReconcileOK');
    try {
      await insertConsistentGame({ playerId, points: 2, won: true, finished: true });
      await insertConsistentGame({ playerId, points: 10, won: true, finished: true });

      const drift = await findDrift(db);
      expect(drift.find((row) => row.playerId === playerId)).toBeUndefined();
    } finally {
      await db.delete(players).where(eq(players.id, playerId));
    }
  });

  it('excludes an abandoned game from the actual side — no false-positive drift', async () => {
    const db = getDb();
    const playerId = await insertPlayer('ReconcileAbandoned');
    try {
      await insertConsistentGame({ playerId, points: 0, won: false, finished: false });

      const drift = await findDrift(db);
      expect(drift.find((row) => row.playerId === playerId)).toBeUndefined();
    } finally {
      await db.delete(players).where(eq(players.id, playerId));
    }
  });

  it('flags a player whose denormalized totalPoints was corrupted', async () => {
    const db = getDb();
    const playerId = await insertPlayer('ReconcileDrifted');
    try {
      await insertConsistentGame({ playerId, points: 2, won: true, finished: true });

      // Manufacture drift: bump the denormalized column without a matching game_players row
      // (simulates the exact bug class this script exists to catch).
      await db
        .update(players)
        .set({ totalPoints: sql`${players.totalPoints} + 5` })
        .where(eq(players.id, playerId));

      const drift = await findDrift(db);
      const row = drift.find((r) => r.playerId === playerId);
      expect(row).toBeDefined();
      expect(row?.denormalized.totalPoints).toBe(7);
      expect(row?.actual.totalPoints).toBe(2);
      expect(row?.denormalized.gamesPlayed).toBe(row?.actual.gamesPlayed);
    } finally {
      await db.delete(players).where(eq(players.id, playerId));
    }
  });

  it('flags a player whose denormalized gamesPlayed was corrupted even if totalPoints matches', async () => {
    const db = getDb();
    const playerId = await insertPlayer('ReconcileDriftCount');
    try {
      await insertConsistentGame({ playerId, points: 2, won: true, finished: true });
      await db
        .update(players)
        .set({ gamesPlayed: sql`${players.gamesPlayed} + 1` })
        .where(eq(players.id, playerId));

      const drift = await findDrift(db);
      const row = drift.find((r) => r.playerId === playerId);
      expect(row).toBeDefined();
      expect(row?.denormalized.gamesPlayed).toBe(2);
      expect(row?.actual.gamesPlayed).toBe(1);
    } finally {
      await db.delete(players).where(eq(players.id, playerId));
    }
  });
});
