import { randomInt } from 'node:crypto';
import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import {
  browsePublicPacksQuerySchema,
  bulkCreatePairsRequestSchema,
  createPackRequestSchema,
  importPackRequestSchema,
  listPacksQuerySchema,
  okResponseSchema,
  packResponseSchema,
  packsResponseSchema,
  paginationQuerySchema,
  pairResponseSchema,
  pairsPageSchema,
  pairsResponseSchema,
  patchPackRequestSchema,
  patchPairRequestSchema,
  publicPacksPageSchema,
} from '@sketchy/shared/contract/packs';
import { containsProfanity } from '@sketchy/shared/profanity';
import { PACK_SHARE_CODE_LENGTH, ROOM_CODE_ALPHABET } from '@sketchy/shared/room-code';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { getDb } from '../db/client.js';
import { packAccess, players, wordPacks, wordPairs } from '../db/schema.js';
import { getEnv } from '../env.js';
import { sendError } from '../error-envelope.js';
import { packsBrowseRateLimit } from '../rate-limit.js';
import { mapPack, mapPair } from './mappers.js';
import { grantedPackIds, hasPackAccess } from './pack-access.js';
import { isPackInPlayForPlayer } from './pack-leak-guard.js';

const packIdParamsSchema = z.object({ id: z.uuid() });
const pairIdParamsSchema = z.object({ id: z.uuid(), pairId: z.uuid() });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Content limits ("pair_limit (500/pack, 20 packs/player)"). */
const MAX_PAIRS_PER_PACK = 500;
const MAX_PACKS_PER_PLAYER = 20;

const NOT_FOUND_MESSAGE = 'Pack not found.';
const FORBIDDEN_MESSAGE = "You don't have access to that word pack.";
const PROFANITY_MESSAGE = "Let's keep it printable. Try different words.";
const VALIDATION_MESSAGE = "That didn't look right — check it and try again.";
/** copy.md §9 row — mirrors the `pairLimit` string's shape
 * ("That's the limit for X ({max}). {dry joke}.") for the sibling per-player
 * pack cap, since `pairLimit`'s own wording is specific to "this pack". */
const packLimitMessage = (max: number): string =>
  `That's the limit for packs on your account (${max} packs). Retire one to make room.`;
const pairLimitMessage = (max: number): string =>
  `That's the limit for this pack (${max} pairs). Quality over quantity.`;

/** Opaque pagination cursor = base64url of the last row's `id` (pinned decision). */
function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return UUID_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Escape a user-supplied `ILIKE` needle so `%`/`_`/`\` are matched literally, not as
 * wildcards — the catalog name search treats the input as plain text, never a pattern
 * (Postgres `ILIKE` uses `\` as its escape char by default, so this is sufficient). */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** True if `error` (or something in its `.cause` chain) is a Postgres
 * unique-violation (`23505`) — checked structurally rather than importing
 * `pg`'s own error class (avoids a second way to construct/compare the same
 * code). Drizzle wraps the raw `pg` error in its own `DrizzleQueryError`,
 * whose `.cause` holds the actual error with `.code` — checking only the
 * top-level object misses it and lets a real conflict escape as a 500. */
function isUniqueViolation(error: unknown): boolean {
  let current = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && (current as { code?: unknown }).code === '23505') {
      return true;
    }
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/** 8-char share code drawn from the room-code alphabet (conventions.md §4 "shared
 * alphabet"; `PACK_SHARE_CODE_LENGTH`, `packages/shared/src/room-code.ts`). */
function randomShareCode(): string {
  let code = '';
  for (let i = 0; i < PACK_SHARE_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

type PackRow = typeof wordPacks.$inferSelect;

/**
 * Shared write-guard for every `:id`-scoped pack/pair write route: loads the
 * pack, 404s if it doesn't exist OR the caller can't even READ it (existence
 * hiding — same posture as the GET routes), then 403 `pack_forbidden`s if the
 * caller can read it (e.g. an official or public pack) but isn't its owner.
 * Only owners ever reach the `PackRow` this returns.
 */
async function loadOwnedPack(
  packId: string,
  callerId: string,
  reply: FastifyReply,
): Promise<PackRow | undefined> {
  const db = getDb();
  const [pack] = await db.select().from(wordPacks).where(eq(wordPacks.id, packId)).limit(1);
  if (!pack || !(await hasPackAccess(pack, callerId))) {
    sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    return undefined;
  }
  if (pack.ownerId !== callerId) {
    sendError(reply, 403, 'pack_forbidden', FORBIDDEN_MESSAGE);
    return undefined;
  }
  return pack;
}

/** Owner display name for `mapPack`'s `ownerName` — a single
 * row lookup, used by the write routes that only ever touch one pack at a time. */
async function ownerNameFor(ownerId: string | null): Promise<string | null> {
  if (!ownerId) {
    return null;
  }
  const db = getDb();
  const [row] = await db.select({ displayName: players.displayName }).from(players).where(eq(players.id, ownerId)).limit(1);
  return row?.displayName ?? null;
}

/**
 * Word pack read + write endpoints (api-contract.md §1): read routes plus
 * write routes (create/patch/delete pack, bulk pairs, pair patch/delete,
 * import-by-code) live in this same file, extending rather than forking
 * the route group.
 *
 * Visibility model (`routes/pack-access.ts` is the single source of truth
 * for "can this caller see/use this pack", covering official ∪ owned ∪
 * public ∪ imported (`pack_access` grants, minted by `POST /packs/import`)):
 *   - `GET /packs` lists the caller's OWN working set: official packs ∪
 *     packs they own ∪ packs they imported. It deliberately does NOT include
 *     other users' `visibility:'public'` packs — discovering the full public
 *     catalog is a SEPARATE surface, `GET /packs/public` below.
 *   - `GET /packs/public` browses the public catalog: `visibility:'public'` +
 *     `review_status:'approved'` packs owned by OTHER players, minus everything
 *     already in the caller's set (official / owned / imported), so every row is
 *     addable. `POST /packs/:id/import` then mints the `pack_access` grant that
 *     moves a chosen catalog pack INTO the caller's `GET /packs` set (and thus the
 *     room pack-picker) — the by-id sibling of the share-code `POST /packs/import`.
 *   - `GET /packs/:id` and `GET /packs/:id/pairs` use a WIDER gate: official
 *     ∪ owned ∪ imported ∪ `visibility:'public'` — if you have a direct link
 *     to someone else's public pack it resolves, even though it never showed
 *     up in your own list. Anything else 404s (existence-hiding).
 *   - `GET /packs/:id/pairs` additionally 403s ANY caller — owner included —
 *     who is currently seated in a mid-game room drawing from this pack
 *     (`pack-leak-guard.ts` — api-contract.md §1's
 *     "never during a live game they're in" rule). "Owner sees all" (the
 *     bullet above) is about the private/unlisted VISIBILITY gate, not this
 *     leak guard: an owner who made a pack and is playing it with friends
 *     could otherwise call this endpoint mid-game, diff the full pair list
 *     against their own dealt word (`YouSlice.word`), and deduce the
 *     opposing faction's word — exactly the leak this guard exists to stop,
 *     regardless of who owns the pack. Owners NOT currently playing a live
 *     game with the pack still see everything, unaffected.
 */
export const packRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/packs',
    {
      preHandler: requireAuth,
      schema: {
        querystring: listPacksQuerySchema,
        response: {
          200: packsResponseSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const caller = request.player;
      // requireAuth already 401'd otherwise; caller is non-null here.
      if (!caller) {
        return { items: [] };
      }

      const { official, mine, language } = request.query;
      const imported = await grantedPackIds(caller.id);
      const ownedOrOfficial = or(eq(wordPacks.isOfficial, true), eq(wordPacks.ownerId, caller.id));
      const conditions = [
        imported.length > 0 ? or(ownedOrOfficial, inArray(wordPacks.id, imported)) : ownedOrOfficial,
      ];
      if (official !== undefined) {
        conditions.push(eq(wordPacks.isOfficial, official));
      }
      if (mine !== undefined) {
        // `ownerId <> caller.id` is SQL-NULL (i.e. excluded, not included) for
        // official packs (`ownerId IS NULL`) — `mine=false` should still
        // count those as "not mine", so the NULL case is OR'd in explicitly.
        // `mine=true` also counts an IMPORTED pack as "mine" —
        // "mine" reads as "packs I have full standing use of", not strictly
        // "packs I own".
        const ownedCondition = eq(wordPacks.ownerId, caller.id);
        conditions.push(
          mine
            ? imported.length > 0
              ? or(ownedCondition, inArray(wordPacks.id, imported))
              : ownedCondition
            : or(isNull(wordPacks.ownerId), ne(wordPacks.ownerId, caller.id)),
        );
      }
      if (language !== undefined) {
        conditions.push(eq(wordPacks.language, language));
      }

      const db = getDb();
      const rows = await db
        .select({ pack: wordPacks, ownerName: players.displayName })
        .from(wordPacks)
        .leftJoin(players, eq(wordPacks.ownerId, players.id))
        .where(and(...conditions))
        .orderBy(desc(wordPacks.isOfficial), asc(wordPacks.name));

      return { items: rows.map((row) => mapPack(row.pack, row.ownerName ?? null)) };
    },
  );

  fastify.get(
    '/packs/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: packIdParamsSchema,
        response: {
          200: packResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const db = getDb();
      const [row] = await db
        .select({ pack: wordPacks, ownerName: players.displayName })
        .from(wordPacks)
        .leftJoin(players, eq(wordPacks.ownerId, players.id))
        .where(eq(wordPacks.id, request.params.id))
        .limit(1);

      if (!row || !(await hasPackAccess(row.pack, caller.id))) {
        sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
        return undefined;
      }

      return { pack: mapPack(row.pack, row.ownerName ?? null) };
    },
  );

  fastify.get(
    '/packs/:id/pairs',
    {
      preHandler: requireAuth,
      schema: {
        params: packIdParamsSchema,
        querystring: paginationQuerySchema,
        response: {
          200: pairsPageSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const db = getDb();
      const [pack] = await db
        .select()
        .from(wordPacks)
        .where(eq(wordPacks.id, request.params.id))
        .limit(1);

      if (!pack || !(await hasPackAccess(pack, caller.id))) {
        sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
        return undefined;
      }

      // Live-game leak guard (api-contract.md §1):
      // ANY caller — owner included — currently seated in a mid-game room
      // drawing from this pack is denied, full stop. Ownership is a
      // VISIBILITY concern (handled above by `hasPackAccess`), not a leak-
      // guard exemption: an owner playing their own pack could otherwise
      // diff the full pair list against their own dealt word mid-game and
      // deduce the opposing faction's word — the exact leak this guard
      // exists to prevent (bug found in review; owners are not special
      // here). Owners not currently playing a live game with the pack still
      // see everything, since `isPackInPlayForPlayer` only matches seated
      // members of an ACTIVE game.
      if (await isPackInPlayForPlayer(pack.id, caller.id)) {
        sendError(reply, 403, 'pack_forbidden', FORBIDDEN_MESSAGE);
        return undefined;
      }

      const { cursor, limit } = request.query;
      let afterId: string | undefined;
      if (cursor !== undefined) {
        const decoded = decodeCursor(cursor);
        if (!decoded) {
          sendError(reply, 400, 'validation', 'Invalid cursor.');
          return undefined;
        }
        afterId = decoded;
      }

      const conditions = [eq(wordPairs.packId, pack.id), eq(wordPairs.status, 'active')];
      if (afterId !== undefined) {
        conditions.push(gt(wordPairs.id, afterId));
      }

      const rows = await db
        .select()
        .from(wordPairs)
        .where(and(...conditions))
        .orderBy(asc(wordPairs.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const lastItem = page.at(-1);
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.id) : null;

      return { items: page.map(mapPair), nextCursor };
    },
  );

  fastify.post(
    '/packs',
    {
      preHandler: requireAuth,
      schema: {
        body: createPackRequestSchema,
        response: {
          200: packResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const { name, description } = request.body;
      if (containsProfanity(name) || (description !== undefined && containsProfanity(description))) {
        sendError(reply, 400, 'profanity', PROFANITY_MESSAGE);
        return undefined;
      }

      // TOCTOU fix (bug found in review): count-then-insert with no lock let two
      // concurrent `POST /packs` calls each pass the count check and jointly
      // exceed `MAX_PACKS_PER_PLAYER`. `SELECT ... FOR UPDATE` on the caller's
      // OWN `players` row serializes concurrent pack-creation attempts by the
      // same player (a per-player lock, not a table-wide one — unrelated
      // players' creates never block each other) without needing a dedicated
      // sentinel table; the count re-read and the insert then happen while
      // holding that lock, inside the same transaction.
      const db = getDb();
      const outcome = await db.transaction(async (tx) => {
        await tx.select({ id: players.id }).from(players).where(eq(players.id, caller.id)).for('update');

        const [ownedCountRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(wordPacks)
          .where(eq(wordPacks.ownerId, caller.id));
        const ownedCount = ownedCountRow?.count ?? 0;
        if (ownedCount >= MAX_PACKS_PER_PLAYER) {
          return { kind: 'limit' as const };
        }

        const [created] = await tx
          .insert(wordPacks)
          .values({
            name,
            description: description ?? '',
            category: 'custom',
            isOfficial: false,
            ownerId: caller.id,
            visibility: 'private',
          })
          .returning();
        return { kind: 'created' as const, pack: created };
      });

      if (outcome.kind === 'limit') {
        sendError(reply, 400, 'pair_limit', packLimitMessage(MAX_PACKS_PER_PLAYER));
        return undefined;
      }
      if (!outcome.pack) {
        sendError(reply, 500, 'internal', 'Could not create the pack. Try again.');
        return undefined;
      }

      return { pack: mapPack(outcome.pack, await ownerNameFor(caller.id)) };
    },
  );

  fastify.patch(
    '/packs/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: packIdParamsSchema,
        body: patchPackRequestSchema,
        response: {
          200: packResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const pack = await loadOwnedPack(request.params.id, caller.id, reply);
      if (!pack) {
        return undefined;
      }

      const { name, description, visibility, coverUrl } = request.body;
      if (
        (name !== undefined && containsProfanity(name)) ||
        (description !== undefined && containsProfanity(description))
      ) {
        sendError(reply, 400, 'profanity', PROFANITY_MESSAGE);
        return undefined;
      }

      if (coverUrl != null) {
        const env = getEnv();
        const cdnBase = env.r2PublicBaseUrl.replace(/\/+$/, '');
        if (!coverUrl.startsWith(`${cdnBase}/`)) {
          sendError(reply, 400, 'validation', VALIDATION_MESSAGE);
          return undefined;
        }
      }

      const db = getDb();
      let shareCode: string | null = pack.shareCode;
      if (visibility === 'unlisted' && !shareCode) {
        const minted = await mintShareCode(pack.id, reply);
        if (!minted) {
          return undefined;
        }
        shareCode = minted;
      }

      const [updated] = await db
        .update(wordPacks)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(visibility !== undefined ? { visibility } : {}),
          ...(coverUrl !== undefined ? { coverUrl } : {}),
          ...(visibility === 'unlisted' ? { shareCode } : {}),
          // The `review_status` moderation gate is now active: public packs require admin
          // approval via the moderation queue before they are visible/usable to everyone.
          ...(visibility === 'public' ? { reviewStatus: 'pending' as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(wordPacks.id, pack.id))
        .returning();
      if (!updated) {
        sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
        return undefined;
      }

      return { pack: mapPack(updated, await ownerNameFor(caller.id)) };
    },
  );

  fastify.delete(
    '/packs/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: packIdParamsSchema,
        response: {
          200: okResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const pack = await loadOwnedPack(request.params.id, caller.id, reply);
      if (!pack) {
        return undefined;
      }

      await getDb().delete(wordPacks).where(eq(wordPacks.id, pack.id));
      return { ok: true as const };
    },
  );

  fastify.post(
    '/packs/:id/pairs',
    {
      preHandler: requireAuth,
      schema: {
        params: packIdParamsSchema,
        body: bulkCreatePairsRequestSchema,
        response: {
          200: pairsResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const pack = await loadOwnedPack(request.params.id, caller.id, reply);
      if (!pack) {
        return undefined;
      }

      const { pairs } = request.body;
      if (pairs.some((pair) => containsProfanity(pair.wordA) || containsProfanity(pair.wordB))) {
        sendError(reply, 400, 'profanity', PROFANITY_MESSAGE);
        return undefined;
      }

      const db = getDb();
      try {
        // TOCTOU fix (bug found in review): the limit check used to run against
        // `pack.pairCount` read BEFORE this transaction, so two concurrent bulk
        // inserts against the same pack could each pass the check independently
        // and jointly exceed `MAX_PAIRS_PER_PACK`. `SELECT ... FOR UPDATE` on the
        // pack row serializes concurrent writers to THIS pack (other packs are
        // unaffected); the count is re-read fresh while holding that lock, so
        // the limit check and the insert are now atomic together.
        const outcome = await db.transaction(async (tx) => {
          await tx.select({ id: wordPacks.id }).from(wordPacks).where(eq(wordPacks.id, pack.id)).for('update');

          const [preCountRow] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(wordPairs)
            .where(and(eq(wordPairs.packId, pack.id), eq(wordPairs.status, 'active')));
          const currentCount = preCountRow?.count ?? 0;
          if (currentCount + pairs.length > MAX_PAIRS_PER_PACK) {
            return { kind: 'limit' as const };
          }

          const rows = await tx
            .insert(wordPairs)
            .values(pairs.map((pair) => ({ packId: pack.id, ...pair })))
            .returning();
          const [postCountRow] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(wordPairs)
            .where(and(eq(wordPairs.packId, pack.id), eq(wordPairs.status, 'active')));
          await tx
            .update(wordPacks)
            .set({ pairCount: postCountRow?.count ?? rows.length, updatedAt: new Date() })
            .where(eq(wordPacks.id, pack.id));
          return { kind: 'created' as const, rows };
        });

        if (outcome.kind === 'limit') {
          sendError(reply, 400, 'pair_limit', pairLimitMessage(MAX_PAIRS_PER_PACK));
          return undefined;
        }
        return { items: outcome.rows.map(mapPair) };
      } catch (error) {
        if (isUniqueViolation(error)) {
          sendError(reply, 400, 'validation', 'One of those pairs already exists in this pack.');
          return undefined;
        }
        throw error;
      }
    },
  );

  fastify.patch(
    '/packs/:id/pairs/:pairId',
    {
      preHandler: requireAuth,
      schema: {
        params: pairIdParamsSchema,
        body: patchPairRequestSchema,
        response: {
          200: pairResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const pack = await loadOwnedPack(request.params.id, caller.id, reply);
      if (!pack) {
        return undefined;
      }

      const db = getDb();
      const [existingPair] = await db
        .select()
        .from(wordPairs)
        .where(and(eq(wordPairs.id, request.params.pairId), eq(wordPairs.packId, pack.id)))
        .limit(1);
      if (!existingPair) {
        sendError(reply, 404, 'not_found', 'Pair not found.');
        return undefined;
      }

      const { wordA, wordB, difficulty } = request.body;
      if ((wordA !== undefined && containsProfanity(wordA)) || (wordB !== undefined && containsProfanity(wordB))) {
        sendError(reply, 400, 'profanity', PROFANITY_MESSAGE);
        return undefined;
      }

      try {
        const [updated] = await db
          .update(wordPairs)
          .set({
            ...(wordA !== undefined ? { wordA } : {}),
            ...(wordB !== undefined ? { wordB } : {}),
            ...(difficulty !== undefined ? { difficulty } : {}),
          })
          .where(eq(wordPairs.id, existingPair.id))
          .returning();
        if (!updated) {
          sendError(reply, 404, 'not_found', 'Pair not found.');
          return undefined;
        }
        return { pair: mapPair(updated) };
      } catch (error) {
        if (isUniqueViolation(error)) {
          sendError(reply, 400, 'validation', 'That pair already exists in this pack.');
          return undefined;
        }
        throw error;
      }
    },
  );

  fastify.delete(
    '/packs/:id/pairs/:pairId',
    {
      preHandler: requireAuth,
      schema: {
        params: pairIdParamsSchema,
        response: {
          200: okResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const pack = await loadOwnedPack(request.params.id, caller.id, reply);
      if (!pack) {
        return undefined;
      }

      const db = getDb();
      const deleted = await db.transaction(async (tx) => {
        const rows = await tx
          .delete(wordPairs)
          .where(and(eq(wordPairs.id, request.params.pairId), eq(wordPairs.packId, pack.id)))
          .returning({ id: wordPairs.id });
        if (rows.length === 0) {
          return false;
        }
        const [countRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(wordPairs)
          .where(and(eq(wordPairs.packId, pack.id), eq(wordPairs.status, 'active')));
        await tx
          .update(wordPacks)
          .set({ pairCount: countRow?.count ?? 0, updatedAt: new Date() })
          .where(eq(wordPacks.id, pack.id));
        return true;
      });

      if (!deleted) {
        sendError(reply, 404, 'not_found', 'Pair not found.');
        return undefined;
      }
      return { ok: true as const };
    },
  );

  fastify.post(
    '/packs/import',
    {
      preHandler: requireAuth,
      schema: {
        body: importPackRequestSchema,
        response: {
          200: packResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const normalized = request.body.shareCode.trim().toUpperCase();
      const db = getDb();
      const [pack] = await db
        .select()
        .from(wordPacks)
        .where(and(eq(wordPacks.shareCode, normalized), eq(wordPacks.visibility, 'unlisted')))
        .limit(1);
      if (!pack) {
        sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
        return undefined;
      }

      // Importing your own pack is a harmless no-op — no grant row needed,
      // ownership already grants full access. `onConflictDoNothing` makes
      // re-importing an already-imported pack idempotent (api-contract.md §1
      // "grants read-access" — granting it again is not an error).
      if (pack.ownerId !== caller.id) {
        await db
          .insert(packAccess)
          .values({ packId: pack.id, playerId: caller.id })
          .onConflictDoNothing();
      }

      return { pack: mapPack(pack, await ownerNameFor(pack.ownerId)) };
    },
  );

  fastify.get(
    '/packs/public',
    {
      preHandler: [requireAuth, packsBrowseRateLimit],
      schema: {
        querystring: browsePublicPacksQuerySchema,
        response: {
          200: publicPacksPageSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const { q, cursor, limit } = request.query;
      let afterId: string | undefined;
      if (cursor !== undefined) {
        const decoded = decodeCursor(cursor);
        if (!decoded) {
          sendError(reply, 400, 'validation', 'Invalid cursor.');
          return undefined;
        }
        afterId = decoded;
      }

      // The catalog only ever lists ADDABLE packs: `visibility='public'` AND
      // `review_status='approved'` (the same gate `pack-access.ts` admits public packs
      // through), minus everything already usable in the caller's set — official packs
      // (in everyone's set), the caller's own owned packs, and packs they already hold a
      // `pack_access` grant for. Excluding those keeps "Add to my packs" meaningful: every
      // row is something the caller doesn't already have.
      const imported = await grantedPackIds(caller.id);
      const conditions = [
        eq(wordPacks.visibility, 'public'),
        eq(wordPacks.reviewStatus, 'approved'),
        eq(wordPacks.isOfficial, false),
        // A public custom pack always has a non-null owner (the `word_packs_official_owner`
        // CHECK ties null-owner to official, already excluded above), so `<> caller` behaves.
        ne(wordPacks.ownerId, caller.id),
      ];
      if (imported.length > 0) {
        conditions.push(notInArray(wordPacks.id, imported));
      }
      if (q) {
        conditions.push(ilike(wordPacks.name, `%${escapeLike(q)}%`));
      }
      if (afterId !== undefined) {
        conditions.push(gt(wordPacks.id, afterId));
      }

      const db = getDb();
      const rows = await db
        .select({ pack: wordPacks, ownerName: players.displayName })
        .from(wordPacks)
        .leftJoin(players, eq(wordPacks.ownerId, players.id))
        .where(and(...conditions))
        .orderBy(asc(wordPacks.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const lastItem = page.at(-1);
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.pack.id) : null;

      return { items: page.map((row) => mapPack(row.pack, row.ownerName ?? null)), nextCursor };
    },
  );

  fastify.post(
    '/packs/:id/import',
    {
      preHandler: [requireAuth, packsBrowseRateLimit],
      schema: {
        params: packIdParamsSchema,
        response: {
          200: packResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', "Your session went stale. Refresh and you'll be back in.");
        return undefined;
      }

      const db = getDb();
      const [pack] = await db
        .select()
        .from(wordPacks)
        .where(eq(wordPacks.id, request.params.id))
        .limit(1);

      // Only a LIVE public-catalog pack (public + approved) is importable by id. Anything
      // else — missing, private, unlisted, or a public pack left pending by a future review
      // gate — 404s with no distinction, so this endpoint never leaks the existence of a
      // pack the caller couldn't otherwise browse to (same existence-hiding posture as the
      // by-id read routes and the share-code import).
      if (!pack || pack.visibility !== 'public' || pack.reviewStatus !== 'approved') {
        sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
        return undefined;
      }

      // Importing your own public pack is a harmless no-op — ownership already grants full
      // access, no grant row needed. `onConflictDoNothing` makes a repeat import idempotent
      // (mirrors the share-code import; granting access again is not an error).
      if (pack.ownerId !== caller.id) {
        await db
          .insert(packAccess)
          .values({ packId: pack.id, playerId: caller.id })
          .onConflictDoNothing();
      }

      return { pack: mapPack(pack, await ownerNameFor(pack.ownerId)) };
    },
  );
};

/**
 * Mints a fresh, unclaimed 8-char share code for `packId`, retrying on a
 * unique-constraint collision (mirrors `rooms/room-codes.ts`'s
 * allocate-and-retry shape, at pack-sharing's much lower volume). Sends the
 * `internal` error itself and returns `undefined` if every attempt collides.
 */
async function mintShareCode(packId: string, reply: FastifyReply): Promise<string | undefined> {
  const MAX_ATTEMPTS = 5;
  const db = getDb();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = randomShareCode();
    try {
      await db.update(wordPacks).set({ shareCode: code }).where(eq(wordPacks.id, packId));
      return code;
    } catch (error) {
      if (isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
  }
  sendError(reply, 500, 'internal', 'Could not generate a share code. Try again.');
  return undefined;
}
