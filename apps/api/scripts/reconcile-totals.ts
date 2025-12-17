/**
 * Reconciliation script: compares the denormalized `players.
 * total_points/games_played/games_won` (data-model.md §1 — bumped transactionally by
 * `rooms/persist-game.ts`'s `persistFinishedGame` at the end of every FINISHED game) against
 * an independent `SUM(game_players)` aggregate computed fresh from first principles. Zero
 * drift is the expected, healthy state; any drifted row means the denormalization got out of
 * sync with its source of truth (a bug in `persist-game.ts`, a hand-edited row, a partial
 * migration, etc.) and is worth paging someone about before it compounds.
 *
 * Intended to run as a weekly CI job (deploy/RUNBOOK.md "Weekly jobs" has the runbook entry) —
 * wiring an actual cron/CI schedule is out of scope here, the same "doc, not infra" split the
 * abandoned-game cleanup job already documents in data-model.md §1's retention note.
 *
 * IMPORTANT — what counts as "actual": only game_players rows belonging to a FINISHED game
 * (`games.winner_faction IS NOT NULL`) are summed. An abandoned game's game_players rows
 * exist (for history) but were never counted into the denormalized totals in the first place
 * (`persistAbandonedGame` awards no points and bumps nothing) — summing them in here would
 * manufacture false-positive drift on every room that ever got abandoned.
 */
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { closeConnections, getDb } from '../src/db/client.js';

export interface ReconciliationRow {
  playerId: string;
  denormalized: { totalPoints: number; gamesPlayed: number; gamesWon: number };
  actual: { totalPoints: number; gamesPlayed: number; gamesWon: number };
}

/**
 * Runs the comparison and returns every player whose denormalized totals disagree with the
 * freshly-computed aggregate. Empty array = zero drift = healthy.
 */
export async function findDrift(db: ReturnType<typeof getDb>): Promise<ReconciliationRow[]> {
  const result = await db.execute(sql`
    SELECT
      p.id AS player_id,
      p.total_points AS denorm_points,
      p.games_played AS denorm_played,
      p.games_won AS denorm_won,
      coalesce(agg.total_points, 0) AS actual_points,
      coalesce(agg.games_played, 0) AS actual_played,
      coalesce(agg.games_won, 0) AS actual_won
    FROM players p
    LEFT JOIN (
      SELECT
        gp.player_id,
        count(*) AS games_played,
        count(*) FILTER (WHERE gp.won) AS games_won,
        coalesce(sum(gp.points), 0) AS total_points
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.winner_faction IS NOT NULL
      GROUP BY gp.player_id
    ) agg ON agg.player_id = p.id
    WHERE p.total_points <> coalesce(agg.total_points, 0)
       OR p.games_played <> coalesce(agg.games_played, 0)
       OR p.games_won <> coalesce(agg.games_won, 0)
    ORDER BY p.id
  `);

  const rows = result.rows as {
    player_id: string;
    denorm_points: number;
    denorm_played: number;
    denorm_won: number;
    actual_points: number;
    actual_played: number;
    actual_won: number;
  }[];

  return rows.map((row) => ({
    playerId: row.player_id,
    denormalized: {
      totalPoints: Number(row.denorm_points),
      gamesPlayed: Number(row.denorm_played),
      gamesWon: Number(row.denorm_won),
    },
    actual: {
      totalPoints: Number(row.actual_points),
      gamesPlayed: Number(row.actual_played),
      gamesWon: Number(row.actual_won),
    },
  }));
}

/** Total player count — for the "N players checked" summary line. */
async function countPlayers(db: ReturnType<typeof getDb>): Promise<number> {
  const result = await db.execute(sql`SELECT count(*)::int AS count FROM players`);
  const rows = result.rows as { count: number }[];
  return rows[0]?.count ?? 0;
}

function formatRow(row: ReconciliationRow): string {
  return (
    `player ${row.playerId}: ` +
    `totalPoints ${row.denormalized.totalPoints} (denormalized) vs ${row.actual.totalPoints} (actual), ` +
    `gamesPlayed ${row.denormalized.gamesPlayed} vs ${row.actual.gamesPlayed}, ` +
    `gamesWon ${row.denormalized.gamesWon} vs ${row.actual.gamesWon}`
  );
}

async function main(): Promise<void> {
  const db = getDb();
  const [drift, total] = await Promise.all([findDrift(db), countPlayers(db)]);

  if (drift.length === 0) {
    console.log(`Reconciliation OK — ${total} player(s) checked, zero drift.`);
    return;
  }

  console.error(`Reconciliation FAILED — ${drift.length} of ${total} player(s) drifted:`);
  for (const row of drift) {
    console.error(`  ${formatRow(row)}`);
  }
  // Non-zero exit — this is what a weekly CI job alerts on (deploy/RUNBOOK.md).
  process.exitCode = 1;
}

// Only run as a side effect when executed directly (`tsx scripts/reconcile-totals.ts`), never
// when imported as a module — same pattern `scripts/seed.ts` uses, for the same reason
// (integration tests import `findDrift` directly without also triggering process.exit).
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main()
    .then(() => closeConnections())
    .catch(async (error: unknown) => {
      console.error(
        'Reconciliation script crashed:',
        error instanceof Error ? error.message : error,
      );
      await closeConnections();
      process.exitCode = 1;
    });
}
