import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Faction, GamePlayer, GameState } from '@sketchy/engine/types';
import { getDb, getRedis } from '../db/client.js';
import { gamePlayers, games, players } from '../db/schema.js';
import { gameIdKey } from './room-store.js';

/**
 * Completing the `games` row + writing `game_players` + bumping `players`
 * lifetime totals (data-model.md §1) when a game finishes — the home
 * for the engine's `persistGame` effect (effects.ts: emitted exactly once, on
 * entering `game_over`). Fired from `rooms/timer-wheel.ts` `routeEffects`, the
 * single choke point BOTH the socket-handler path (`applyBroadcastAndSchedule`)
 * and the timer path (`fireTimer`) run through — a game can reach `game_over`
 * either way (a host `phase:advance` off the reveal, or the 8-s reveal /
 * 30-s Mr.-White timer firing into a win), so anything hooked only into the
 * handlers would miss the timer-driven finishes.
 *
 * All three writes go in ONE transaction so a crash never leaves a half-scored
 * game (a completed `games` row with no `game_players`, or player totals bumped
 * twice). The `games` UPDATE is guarded `WHERE ended_at IS NULL`, making the
 * whole persist idempotent: a duplicate `persistGame` (a stray re-fire) updates
 * zero rows and the transaction returns without touching `game_players` or
 * `players` a second time.
 */

/** Which base roles belong to each winning faction — drives the per-player
 * `won` flag (a team outcome, independent of survival/points: a caught
 * Undercover still "won" if their faction did). */
const FACTION_ROLES: Record<Faction, ReadonlyArray<GamePlayer['role']>> = {
  civilian: ['civilian'],
  undercover: ['undercover'],
  mrwhite: ['mrwhite'],
  infiltrators: ['undercover', 'mrwhite'],
};

/**
 * Per-GAME points for each player — a faithful mirror of the engine's award
 * rules (`packages/engine/src/reducers/reveal.ts` `enterGameOverForWin` /
 * `enterGameOverForGuess`), NOT `state.scoreboard` (which is the SESSION total
 * accumulated across rematches). For the first game of a room the two are
 * equal; the full-loop test asserts exactly that, guarding this mirror against
 * engine drift.
 *
 * - Civilian win: +2 to every Civilian (alive or eliminated).
 * - Undercover / Infiltrators win: +10 to each ALIVE Undercover.
 * - Mr. White natural win / Infiltrators: +6 to each ALIVE Mr. White.
 * - Mr. White STEAL (a correct final guess): +6 to the guesser ONLY, even
 *   though they were just eliminated — distinguished by `lastGuess.correct`.
 */
function computeGamePoints(state: GameState): Record<string, number> {
  const points: Record<string, number> = {};
  const faction = state.winnerFaction;
  if (faction === null) {
    return points;
  }
  const steal = faction === 'mrwhite' && state.lastGuess?.correct === true;

  for (const player of state.players) {
    let earned = 0;
    if (faction === 'civilian' && player.role === 'civilian') {
      earned += 2;
    }
    if ((faction === 'undercover' || faction === 'infiltrators') && player.role === 'undercover' && player.alive) {
      earned += 10;
    }
    if (!steal && (faction === 'mrwhite' || faction === 'infiltrators') && player.role === 'mrwhite' && player.alive) {
      earned += 6;
    }
    if (earned > 0) {
      points[player.id] = earned;
    }
  }

  if (steal && state.lastGuess) {
    const guesser = state.lastGuess.playerId;
    points[guesser] = (points[guesser] ?? 0) + 6;
  }

  return points;
}

/**
 * Completes the running `games` row for room `code` from its final unredacted
 * `GameState` and writes the per-player + lifetime records. No-op (with a log)
 * if the room has no recorded `gameId` — that only happens for a room whose
 * `game:start` never wrote one, which shouldn't occur but must never throw out
 * of a fire-and-forget effect. Errors are caught by the caller.
 */
export async function persistFinishedGame(code: string, state: GameState): Promise<void> {
  const gameId = await getRedis().get(gameIdKey(code));
  if (!gameId) {
    console.error(`persist-game: no gameId for room ${code} at game_over — cannot complete row`);
    return;
  }
  if (state.winnerFaction === null) {
    console.error(`persist-game: room ${code} reached persist with no winnerFaction`);
    return;
  }
  const faction = state.winnerFaction;
  const points = computeGamePoints(state);
  const wonRoles = FACTION_ROLES[faction];

  await getDb().transaction(async (tx) => {
    // Idempotency guard: only the first persist for this game finds a row with
    // a null `ended_at`. A re-fire updates zero rows → skip the rest.
    const completed = await tx
      .update(games)
      .set({
        winnerFaction: faction,
        roundsPlayed: state.round,
        summary: state as unknown as Record<string, unknown>,
        endedAt: new Date(),
      })
      .where(and(eq(games.id, gameId), isNull(games.endedAt)))
      .returning({ id: games.id });

    if (completed.length === 0) {
      return;
    }

    const rows = [];
    for (const player of state.players) {
      const role = player.role;
      if (role === null) {
        // Unreachable at game_over (roles are dealt in `dealing` and never
        // cleared) — kept as a type-honest guard rather than a non-null assert.
        console.error(`persist-game: player ${player.id} has null role at game_over in room ${code}`);
        continue;
      }
      rows.push({
        gameId,
        playerId: player.id,
        seat: player.seat,
        role,
        specialRole: player.specialRole,
        word: player.word,
        eliminatedRound: player.eliminatedRound,
        won: wonRoles.includes(role),
        points: points[player.id] ?? 0,
        wasHost: player.id === state.hostId,
      });
    }
    if (rows.length > 0) {
      await tx.insert(gamePlayers).values(rows);
    }

    // Denormalized lifetime totals (data-model.md §1) — bumped in the SAME
    // transaction so the profile header never needs an aggregate query.
    for (const row of rows) {
      await tx
        .update(players)
        .set({
          totalPoints: sql`${players.totalPoints} + ${row.points}`,
          gamesPlayed: sql`${players.gamesPlayed} + 1`,
          gamesWon: sql`${players.gamesWon} + ${row.won ? 1 : 0}`,
        })
        .where(eq(players.id, row.playerId));
    }
  });
}

/**
 * Completes an ABANDONED game's `games` row (game-design.md §8
 * "Abandoned rooms": all players disconnected >10 min mid-game). Writes
 * `winner_faction = NULL` (data-model.md §1: "NULL = abandoned before
 * finishing") + `ended_at` + the `summary` snapshot + `game_players` history
 * rows (every player who played), but awards NO points and bumps NO lifetime
 * totals — an unfinished game is not a scored game (documented decision:
 * `games_played` counts only games that reached a winner).
 *
 * Idempotency is the SAME `WHERE ended_at IS NULL` guard the finished-game path
 * uses, so a natural game-over that raced the reaper (or a double reap) can
 * never double-write: whichever completion runs first claims the row; the other
 * updates zero rows and returns. `was_host` follows the FINAL `state.hostId`
 * (post-migration), consistent with `persistFinishedGame` (data-model.md §3).
 */
export async function persistAbandonedGame(code: string, state: GameState): Promise<void> {
  const gameId = await getRedis().get(gameIdKey(code));
  if (!gameId) {
    // A room reaped without ever having started a game (shouldn't happen — the
    // sweeper only reaps mid-game rooms, which always have a gameId) — nothing
    // durable to write.
    console.error(`persist-game: no gameId for abandoned room ${code} — nothing to persist`);
    return;
  }

  await getDb().transaction(async (tx) => {
    const completed = await tx
      .update(games)
      .set({
        // winnerFaction intentionally left NULL (abandoned).
        roundsPlayed: state.round,
        summary: state as unknown as Record<string, unknown>,
        endedAt: new Date(),
      })
      .where(and(eq(games.id, gameId), isNull(games.endedAt)))
      .returning({ id: games.id });

    if (completed.length === 0) {
      return; // already finished (natural game-over) or already reaped.
    }

    const rows = state.players
      .filter((player) => player.role !== null)
      .map((player) => ({
        gameId,
        playerId: player.id,
        seat: player.seat,
        role: player.role as NonNullable<GamePlayer['role']>,
        specialRole: player.specialRole,
        word: player.word,
        eliminatedRound: player.eliminatedRound,
        won: false,
        points: 0,
        wasHost: player.id === state.hostId,
      }));
    if (rows.length > 0) {
      await tx.insert(gamePlayers).values(rows);
    }
  });
}
