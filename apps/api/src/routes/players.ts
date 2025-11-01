import type { GameState } from '@sketchy/engine/types';
import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import { paginationQuerySchema } from '@sketchy/shared/contract/packs';
import {
  gameRoundSummaryResponseSchema,
  gamesPageSchema,
  meResponseSchema,
  patchMeRequestSchema,
  statsResponseSchema,
} from '@sketchy/shared/contract/players';
import { containsProfanity } from '@sketchy/shared/profanity';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isPastHalfLife, signPlayerToken, verifyPlayerToken } from '../auth/jwt.js';
import { extractBearerToken, requireAuth } from '../auth/plugin.js';
import { getDb } from '../db/client.js';
import { gamePlayers, games, players } from '../db/schema.js';
import { sendError } from '../error-envelope.js';
import {
  mapByRole,
  mapGameHistoryItem,
  mapGameRoundSummary,
  mapPlayer,
  type RoleStatsRow,
} from './mappers.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";
const GAME_NOT_FOUND_MESSAGE = 'Game not found.';

/**
 * Opaque `GET /players/me/games` pagination cursor (api-contract.md §0): base64url JSON of
 * the last row's `(endedAt, gameId)` — the same pair the query orders + keyset-filters by,
 * so "give me the next page" is a direct `<` continuation rather than an `OFFSET` (packs.ts's
 * `encodeCursor`/`decodeCursor` use a single-column cursor; history's sort key is a composite
 * one, since `games` has no index on `ended_at` alone — see the route doc comment for why
 * that's fine at this table's scale).
 */
interface GamesCursor {
  endedAt: number;
  gameId: string;
}

function encodeGamesCursor(cursor: GamesCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeGamesCursor(raw: string): GamesCursor | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      decoded !== null &&
      typeof decoded === 'object' &&
      'endedAt' in decoded &&
      'gameId' in decoded &&
      typeof decoded.endedAt === 'number' &&
      typeof decoded.gameId === 'string' &&
      z.uuid().safeParse(decoded.gameId).success
    ) {
      return { endedAt: decoded.endedAt, gameId: decoded.gameId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * `GET/PATCH /v1/players/me` (api-contract.md §1). Both require auth
 * (`requireAuth` preHandler already sent a 401 and short-circuited if
 * `request.player` is absent) — each handler still narrows it defensively
 * since nothing in the type system enforces "this preHandler ran" across
 * files.
 */
export const playerRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/players/me',
    {
      preHandler: requireAuth,
      schema: {
        response: {
          200: meResponseSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const authedPlayer = request.player;
      if (!authedPlayer) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const db = getDb();
      const [row] = await db.select().from(players).where(eq(players.id, authedPlayer.id)).limit(1);
      if (!row) {
        // Token references a player row that no longer exists (data-model.md
        // deletion note) — treat exactly like an invalid token.
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      // Fire-and-forget: never block the response on this write.
      void db
        .update(players)
        .set({ lastSeenAt: new Date() })
        .where(eq(players.id, row.id))
        .catch((error: unknown) => {
          request.log.warn({ err: error }, 'failed to bump players.last_seen_at');
        });

      // api-contract.md §1: silent re-issue past the token's halfway point,
      // ONLY on this route. Re-verifies the raw token (rather than trusting
      // `request.player`) because `issuedAt`/`expiresAt` aren't part of the
      // minimal `{id, guest}` shape the auth plugin decorates onto requests.
      const token = extractBearerToken(request.headers.authorization);
      if (token) {
        const claims = await verifyPlayerToken(token);
        if (claims && isPastHalfLife(claims)) {
          const refreshedToken = await signPlayerToken(claims.playerId, claims.guest);
          reply.header('X-Refreshed-Token', refreshedToken);
        }
      }

      return { player: mapPlayer(row) };
    },
  );

  fastify.patch(
    '/players/me',
    {
      preHandler: requireAuth,
      schema: {
        body: patchMeRequestSchema,
        response: {
          200: meResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const authedPlayer = request.player;
      if (!authedPlayer) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const { displayName, avatar } = request.body;
      if (displayName !== undefined && containsProfanity(displayName)) {
        sendError(reply, 400, 'profanity', "Let's keep it printable. Try different words.");
        return undefined;
      }

      const updates: Partial<typeof players.$inferInsert> = {};
      if (displayName !== undefined) {
        updates.displayName = displayName;
      }
      if (avatar !== undefined) {
        updates.avatar = avatar;
      }

      const db = getDb();
      const [row] =
        Object.keys(updates).length > 0
          ? await db.update(players).set(updates).where(eq(players.id, authedPlayer.id)).returning()
          : await db.select().from(players).where(eq(players.id, authedPlayer.id)).limit(1);

      if (!row) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      return { player: mapPlayer(row) };
    },
  );

  /**
   * `GET /v1/players/me/stats` (api-contract.md §1). Header totals
   * are the denormalized `players` columns verbatim — data-model.md §1: "the profile header
   * never needs an aggregate query," bumped transactionally by `rooms/persist-game.ts` at
   * game end. `byRole` is a single `GROUP BY role` over `game_players`, scoped to FINISHED
   * games only (`games.winner_faction IS NOT NULL`) so `sum(byRole[*].played)` stays
   * reconcilable against `gamesPlayed` (an abandoned game's `game_players` rows exist for
   * history but were never counted into the denormalized totals — persist-game.ts's
   * `persistAbandonedGame` awards no points and bumps no totals). Both queries key off
   * `idx_gp_player (player_id, game_id)` (data-model.md §1) — a cheap index scan filtering
   * to just this player's rows before the tiny `GROUP BY`, verified against realistic volume
   * by `test/perf/stats-history-perf.test.ts`.
   */
  fastify.get(
    '/players/me/stats',
    {
      preHandler: requireAuth,
      schema: {
        response: {
          200: statsResponseSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const authedPlayer = request.player;
      if (!authedPlayer) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const db = getDb();
      const [headerRow] = await db
        .select({
          totalPoints: players.totalPoints,
          gamesPlayed: players.gamesPlayed,
          gamesWon: players.gamesWon,
        })
        .from(players)
        .where(eq(players.id, authedPlayer.id))
        .limit(1);

      if (!headerRow) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const roleRows: RoleStatsRow[] = await db
        .select({
          role: gamePlayers.role,
          played: sql<number>`count(*)::int`,
          won: sql<number>`count(*) filter (where ${gamePlayers.won})::int`,
          points: sql<number>`coalesce(sum(${gamePlayers.points}), 0)::int`,
        })
        .from(gamePlayers)
        .innerJoin(games, eq(games.id, gamePlayers.gameId))
        .where(and(eq(gamePlayers.playerId, authedPlayer.id), isNotNull(games.winnerFaction)))
        .groupBy(gamePlayers.role);

      return {
        totalPoints: headerRow.totalPoints,
        gamesPlayed: headerRow.gamesPlayed,
        gamesWon: headerRow.gamesWon,
        byRole: mapByRole(roleRows),
      };
    },
  );

  /**
   * `GET /v1/players/me/games` (api-contract.md §1). Cursor-paginated
   * (api-contract.md §0), newest-finished-first. Includes abandoned games (`winnerFaction:
   * null` — data-model.md §1 "NULL = abandoned before finishing"): it happened, the player
   * was there, `game_players` has a row for it either way.
   *
   * Query shape / index note: the driving filter is `game_players.player_id = me`, which
   * `idx_gp_player (player_id, game_id)` serves as a plain index scan — a single player's
   * OWN game count is small (tens to low hundreds) even against a `games` table seeded to
   * realistic system-wide volume (thousands+), so sorting/keyset-filtering that already-small,
   * already-indexed-down row set by `(ended_at, id)` needs no additional index on `games`
   * itself (there is none — `idx_games_started` only covers `started_at`). Verified against a
   * 10k-game seed by `test/perf/stats-history-perf.test.ts`.
   * `playerCount` is a second small query (one `GROUP BY` over just this page's game ids)
   * rather than a per-row correlated subquery — simpler to read, and just as cheap at this
   * page size (≤50 rows).
   */
  fastify.get(
    '/players/me/games',
    {
      preHandler: requireAuth,
      schema: {
        querystring: paginationQuerySchema,
        response: {
          200: gamesPageSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const authedPlayer = request.player;
      if (!authedPlayer) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const { cursor, limit } = request.query;
      let afterCursor: GamesCursor | undefined;
      if (cursor !== undefined) {
        const decoded = decodeGamesCursor(cursor);
        if (!decoded) {
          sendError(reply, 400, 'validation', "That didn't look right — check it and try again.");
          return undefined;
        }
        afterCursor = decoded;
      }

      const db = getDb();
      const conditions = [eq(gamePlayers.playerId, authedPlayer.id)];
      if (afterCursor) {
        const afterEndedAt = new Date(afterCursor.endedAt);
        // Composite keyset condition (Postgres row comparison) — see the route doc comment
        // for why `games` needs no dedicated `(ended_at, id)` index for this to be cheap.
        conditions.push(
          sql`(${games.endedAt}, ${games.id}) < (${afterEndedAt}, ${afterCursor.gameId})`,
        );
      }

      const rows = await db
        .select({
          gameId: games.id,
          endedAt: games.endedAt,
          mode: games.mode,
          roomCode: games.roomCode,
          winnerFaction: games.winnerFaction,
          civilianWord: games.civilianWord,
          undercoverWord: games.undercoverWord,
          roundsPlayed: games.roundsPlayed,
          myRole: gamePlayers.role,
          mySpecialRole: gamePlayers.specialRole,
          myPoints: gamePlayers.points,
          won: gamePlayers.won,
        })
        .from(gamePlayers)
        .innerJoin(games, eq(games.id, gamePlayers.gameId))
        .where(and(...conditions))
        .orderBy(desc(games.endedAt), desc(games.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      // `games.endedAt` is nullable in the column type (set once, at persist time) but every
      // row reachable through `game_players` has already been persisted (data-model.md §1:
      // both `persistFinishedGame` and `persistAbandonedGame` set it in the SAME transaction
      // as the `game_players` insert) — a null here means that invariant broke, so it's
      // logged and skipped rather than sent to the client as a bogus timestamp.
      type PageRow = (typeof page)[number];
      const withEndedAt: (Omit<PageRow, 'endedAt'> & { endedAt: Date })[] = [];
      for (const row of page) {
        if (row.endedAt === null) {
          request.log.warn({ gameId: row.gameId }, 'game_players row for a game with no ended_at');
          continue;
        }
        withEndedAt.push({ ...row, endedAt: row.endedAt });
      }

      const gameIds = withEndedAt.map((row) => row.gameId);
      const countRows =
        gameIds.length > 0
          ? await db
              .select({ gameId: gamePlayers.gameId, count: sql<number>`count(*)::int` })
              .from(gamePlayers)
              .where(inArray(gamePlayers.gameId, gameIds))
              .groupBy(gamePlayers.gameId)
          : [];
      const countByGame = new Map(countRows.map((row) => [row.gameId, row.count]));

      const items = withEndedAt.map((row) =>
        mapGameHistoryItem({
          ...row,
          // Defensive floor of 1 (the caller themselves) — `countByGame` should always have
          // an entry for every game id in `withEndedAt` since that id came FROM a
          // `game_players` row in the first place.
          playerCount: countByGame.get(row.gameId) ?? 1,
        }),
      );

      const lastItem = withEndedAt.at(-1);
      const nextCursor =
        hasMore && lastItem
          ? encodeGamesCursor({ endedAt: lastItem.endedAt.getTime(), gameId: lastItem.gameId })
          : null;

      return { items, nextCursor };
    },
  );

  /**
   * `GET /v1/players/me/games/:gameId` — additive beyond api-contract.md §1's frozen
   * `GameHistoryItem` list shape (see `packages/shared/src/contract/players.ts`'s doc comment
   * on `gameRoundSummaryResponseSchema`); backs an expandable
   * round-by-round summary. 404s (existence-hiding, same pattern as `packs.ts`'s
   * `isVisible`) for a game the caller didn't play, a game id that doesn't exist, and a game
   * whose `summary` is null — handled defensively, though nothing nulls it today: the weekly
   * abandoned-game cleanup meant to (data-model.md §1 retention note) is planned but not yet
   * scheduled (deferred to Phase 9). All three read identically from the outside.
   */
  fastify.get(
    '/players/me/games/:gameId',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ gameId: z.uuid() }),
        response: {
          200: gameRoundSummaryResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const authedPlayer = request.player;
      if (!authedPlayer) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const db = getDb();
      const [membership] = await db
        .select({ gameId: gamePlayers.gameId })
        .from(gamePlayers)
        .where(
          and(
            eq(gamePlayers.gameId, request.params.gameId),
            eq(gamePlayers.playerId, authedPlayer.id),
          ),
        )
        .limit(1);

      if (!membership) {
        sendError(reply, 404, 'not_found', GAME_NOT_FOUND_MESSAGE);
        return undefined;
      }

      const [gameRow] = await db
        .select({ summary: games.summary })
        .from(games)
        .where(eq(games.id, request.params.gameId))
        .limit(1);

      if (!gameRow || !gameRow.summary) {
        sendError(reply, 404, 'not_found', GAME_NOT_FOUND_MESSAGE);
        return undefined;
      }

      // Trusted internal data (our own `persist-game.ts` wrote it, never user input) — same
      // assertion `persist-game.ts` makes in the other direction when it writes this column.
      const state = gameRow.summary as unknown as GameState;
      return mapGameRoundSummary(request.params.gameId, state);
    },
  );
};
