import { randomUUID } from 'node:crypto';
import { createGame } from '@sketchy/engine/create-game';
import type { GamePlayer, GameSettings } from '@sketchy/engine/types';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@sketchy/shared/room-code';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/client.js';
import { moderationActions, packAccess, wordPacks, wordPairs } from '../db/schema.js';
import { getEnv } from '../env.js';
import { performModerationAction } from '../moderation/actions.js';
import { applyRoomAction, createRoom, loadRoom } from '../rooms/room-store.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp } from '../test-support.js';

describe('pack read endpoints', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  async function insertOfficialPack(name: string): Promise<string> {
    const db = getDb();
    const [pack] = await db
      .insert(wordPacks)
      .values({ name, isOfficial: true, ownerId: null, visibility: 'public' })
      .returning();
    if (!pack) throw new Error('insert failed');
    return pack.id;
  }

  async function insertCustomPack(
    name: string,
    ownerId: string,
    visibility: 'private' | 'unlisted' | 'public',
  ): Promise<string> {
    const db = getDb();
    const [pack] = await db
      .insert(wordPacks)
      .values({
        name,
        isOfficial: false,
        ownerId,
        visibility,
        // These visibility-matrix cases model an already-live public pack, so a public one is
        // inserted pre-approved (public packs default to review_status='pending' now, which
        // would hide them from non-owners). The pending → approved review gate itself is
        // exercised separately in the "public pack review gate" describe below.
        ...(visibility === 'public' ? { reviewStatus: 'approved' as const } : {}),
      })
      .returning();
    if (!pack) throw new Error('insert failed');
    return pack.id;
  }

  describe('visibility matrix', () => {
    it('official packs are visible to any authenticated caller', async () => {
      const officialId = await insertOfficialPack('Matrix Official');
      const { token } = await createGuest(server);

      const res = await server.inject({
        method: 'GET',
        url: `/v1/packs/${officialId}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().pack.id).toBe(officialId);
    });

    it('a private pack is invisible (404) to a non-owner, both pack and pairs', async () => {
      const owner = await createGuest(server);
      const stranger = await createGuest(server);
      const privateId = await insertCustomPack('Secret Stash', owner.playerId, 'private');
      await getDb()
        .insert(wordPairs)
        .values({ packId: privateId, wordA: 'Alpha', wordB: 'Beta', difficulty: 'easy' });

      const packRes = await server.inject({
        method: 'GET',
        url: `/v1/packs/${privateId}`,
        headers: { authorization: `Bearer ${stranger.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(packRes.statusCode).toBe(404);
      expect(packRes.json().error.code).toBe('not_found');

      const pairsRes = await server.inject({
        method: 'GET',
        url: `/v1/packs/${privateId}/pairs`,
        headers: { authorization: `Bearer ${stranger.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(pairsRes.statusCode).toBe(404);
    });

    it('a private pack IS visible to its owner, pack and pairs', async () => {
      const owner = await createGuest(server);
      const privateId = await insertCustomPack('Owner Only', owner.playerId, 'private');
      await getDb()
        .insert(wordPairs)
        .values({ packId: privateId, wordA: 'Gamma', wordB: 'Delta', difficulty: 'medium' });

      const packRes = await server.inject({
        method: 'GET',
        url: `/v1/packs/${privateId}`,
        headers: { authorization: `Bearer ${owner.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(packRes.statusCode).toBe(200);

      const pairsRes = await server.inject({
        method: 'GET',
        url: `/v1/packs/${privateId}/pairs`,
        headers: { authorization: `Bearer ${owner.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(pairsRes.statusCode).toBe(200);
      expect(pairsRes.json().items).toHaveLength(1);
    });

    it("a stranger's PUBLIC custom pack is visible by direct ID, but doesn't show up in the caller's own list", async () => {
      const owner = await createGuest(server);
      const caller = await createGuest(server);
      const publicId = await insertCustomPack('Shared With Everyone', owner.playerId, 'public');

      const byId = await server.inject({
        method: 'GET',
        url: `/v1/packs/${publicId}`,
        headers: { authorization: `Bearer ${caller.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(byId.statusCode).toBe(200);

      const list = await server.inject({
        method: 'GET',
        url: '/v1/packs',
        headers: { authorization: `Bearer ${caller.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(list.statusCode).toBe(200);
      const ids: string[] = list.json().items.map((p: { id: string }) => p.id);
      expect(ids).not.toContain(publicId);
    });

    it('a nonexistent pack id 404s', async () => {
      const { token } = await createGuest(server);
      const res = await server.inject({
        method: 'GET',
        url: '/v1/packs/00000000-0000-4000-8000-000000000000',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('GET /packs?mine=true returns only packs the caller owns (not official ones)', async () => {
      await insertOfficialPack('Mine Filter Official');
      const caller = await createGuest(server);
      const ownedId = await insertCustomPack('My Own Pack', caller.playerId, 'private');

      const res = await server.inject({
        method: 'GET',
        url: '/v1/packs?mine=true',
        headers: { authorization: `Bearer ${caller.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const items: { id: string; isOfficial: boolean }[] = res.json().items;
      expect(items.every((p) => p.id === ownedId)).toBe(true);
      expect(items.some((p) => p.isOfficial)).toBe(false);
    });

    it('GET /packs?official=true returns only official packs', async () => {
      const officialId = await insertOfficialPack('Official Filter Test');
      const caller = await createGuest(server);
      await insertCustomPack('My Own Pack 2', caller.playerId, 'private');

      const res = await server.inject({
        method: 'GET',
        url: '/v1/packs?official=true',
        headers: { authorization: `Bearer ${caller.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const items: { id: string; isOfficial: boolean }[] = res.json().items;
      expect(items.every((p) => p.isOfficial)).toBe(true);
      expect(items.some((p) => p.id === officialId)).toBe(true);
    });

    it('unauthenticated requests 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/v1/packs',
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('pairs pagination', () => {
    it('walks the cursor to exhaustion with no dupes and no gaps', async () => {
      const officialId = await insertOfficialPack('Pagination Pack');
      const db = getDb();
      const TOTAL_PAIRS = 70;
      await db.insert(wordPairs).values(
        Array.from({ length: TOTAL_PAIRS }, (_, i) => ({
          packId: officialId,
          wordA: `Word A ${i}`,
          wordB: `Word B ${i}`,
          difficulty: 'easy' as const,
        })),
      );

      const { token } = await createGuest(server);
      const seenIds = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;

      do {
        const url = cursor
          ? `/v1/packs/${officialId}/pairs?limit=30&cursor=${encodeURIComponent(cursor)}`
          : `/v1/packs/${officialId}/pairs?limit=30`;
        const res = await server.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${token}` },
          remoteAddress: uniqueIp(),
        });
        expect(res.statusCode).toBe(200);
        const body: { items: { id: string }[]; nextCursor: string | null } = res.json();
        expect(body.items.length).toBeLessThanOrEqual(30);
        for (const item of body.items) {
          expect(seenIds.has(item.id)).toBe(false); // no dupes
          seenIds.add(item.id);
        }
        cursor = body.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(10); // guard against an infinite loop
      } while (cursor);

      expect(seenIds.size).toBe(TOTAL_PAIRS); // no gaps
      expect(pages).toBe(3); // 30 + 30 + 10
    });

    it('excludes non-active pairs', async () => {
      const officialId = await insertOfficialPack('Status Filter Pack');
      const db = getDb();
      await db.insert(wordPairs).values([
        {
          packId: officialId,
          wordA: 'Active A',
          wordB: 'Active B',
          difficulty: 'easy',
          status: 'active',
        },
        {
          packId: officialId,
          wordA: 'Pending A',
          wordB: 'Pending B',
          difficulty: 'easy',
          status: 'pending_review',
        },
        {
          packId: officialId,
          wordA: 'Rejected A',
          wordB: 'Rejected B',
          difficulty: 'easy',
          status: 'rejected',
        },
      ]);

      const { token } = await createGuest(server);
      const res = await server.inject({
        method: 'GET',
        url: `/v1/packs/${officialId}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      const body: { items: { wordA: string }[] } = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.wordA).toBe('Active A');
    });

    it('rejects a malformed cursor with a validation error', async () => {
      const officialId = await insertOfficialPack('Bad Cursor Pack');
      const { token } = await createGuest(server);
      const res = await server.inject({
        method: 'GET',
        url: `/v1/packs/${officialId}/pairs?cursor=not-valid-base64url!!!`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

/**
 * Write endpoints — ownership guards, profanity
 * filter, `pair_limit`/`pack_forbidden` exact error paths, transactional
 * `pair_count` maintenance. Note: apps/api's global setup drops/recreates
 * the shared `sketchy_test` Postgres database on every invocation, so this
 * suite isn't safe to run concurrently with another process against the
 * same DB services.
 */
describe('pack write endpoints', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  async function createPack(token: string, name = 'My Pack', description?: string) {
    return server.inject({
      method: 'POST',
      url: '/v1/packs',
      headers: { authorization: `Bearer ${token}` },
      payload: { name, ...(description !== undefined ? { description } : {}) },
      remoteAddress: uniqueIp(),
    });
  }

  describe('POST /v1/packs', () => {
    it('creates a private, empty, owned pack', async () => {
      const { token, playerId } = await createGuest(server);
      const res = await createPack(token, 'Inside Jokes');
      expect(res.statusCode).toBe(200);
      const { pack } = res.json();
      expect(pack.name).toBe('Inside Jokes');
      expect(pack.visibility).toBe('private');
      expect(pack.isOfficial).toBe(false);
      expect(pack.ownerId).toBe(playerId);
      expect(pack.pairCount).toBe(0);
      expect(pack.shareCode).toBeNull();
    });

    it('rejects a profane name with the exact copy.md §9 string', async () => {
      const { token } = await createGuest(server);
      const res = await createPack(token, 'fuck pack');
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('profanity');
      expect(res.json().error.message).toBe("Let's keep it printable. Try different words.");
    });

    it('rejects a profane description too', async () => {
      const { token } = await createGuest(server);
      const res = await createPack(token, 'Clean Name', 'this pack is shit');
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('profanity');
    });

    it('enforces the 20-packs-per-player cap with the exact packLimit copy', async () => {
      const { token } = await createGuest(server);
      for (let i = 0; i < 20; i += 1) {
        const res = await createPack(token, `Pack ${i}`);
        expect(res.statusCode).toBe(200);
      }
      const res = await createPack(token, 'One Too Many');
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('pair_limit');
      expect(res.json().error.message).toBe(
        "That's the limit for packs on your account (20 packs). Retire one to make room.",
      );
    });

    it('rejects unauthenticated requests', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/packs',
        payload: { name: 'Nope' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(401);
    });

    // Bug found in review: count-then-insert with no lock let concurrent requests each pass
    // the count check independently and jointly exceed the cap. Fires 5 concurrent creates
    // at the 19→20 boundary (one player already owns 19 packs, exactly one more slot free)
    // and asserts EXACTLY one succeeds — the DB-level row lock (`SELECT ... FOR UPDATE` on
    // the caller's own `players` row, packs.ts `POST /packs`) serializes them instead of
    // racing.
    it('under concurrent creates at the boundary, exactly one succeeds and the rest see pair_limit', async () => {
      const { token, playerId } = await createGuest(server);
      for (let i = 0; i < 19; i += 1) {
        const res = await createPack(token, `Boundary Pack ${i}`);
        expect(res.statusCode).toBe(200);
      }

      const CONCURRENT_ATTEMPTS = 5;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_ATTEMPTS }, (_, i) => createPack(token, `Racer ${i}`)),
      );

      const succeeded = results.filter((res) => res.statusCode === 200);
      const limited = results.filter(
        (res) => res.statusCode === 400 && res.json().error.code === 'pair_limit',
      );
      expect(succeeded).toHaveLength(1);
      expect(limited).toHaveLength(CONCURRENT_ATTEMPTS - 1);

      // Direct DB confirmation, not just the HTTP response codes: exactly 20 rows exist for
      // this owner, never 21+ — the actual race the row lock is guarding against.
      const [countRow] = await getDb()
        .select({ count: sql<number>`count(*)::int` })
        .from(wordPacks)
        .where(eq(wordPacks.ownerId, playerId));
      expect(countRow?.count).toBe(20);
    });
  });

  describe('PATCH /v1/packs/:id', () => {
    it('lets the owner rename their pack', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Old Name');
      const { id } = created.json().pack;

      const res = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'New Name' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().pack.name).toBe('New Name');
    });

    it('403s pack_forbidden for a non-owner on a pack they CAN see (public)', async () => {
      const owner = await createGuest(server);
      const created = await createPack(owner.token, 'Public Pack');
      const { id } = created.json().pack;
      await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { visibility: 'unlisted' },
        remoteAddress: uniqueIp(),
      });
      // Approved so the stranger CAN see it (an unapproved public pack 404s a non-owner —
      // the review gate — which would mask the ownership 403 this test is about).
      await getDb()
        .update(wordPacks)
        .set({ visibility: 'public', reviewStatus: 'approved' })
        .where(eq(wordPacks.id, id));

      const stranger = await createGuest(server);
      const res = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${stranger.token}` },
        payload: { name: 'Hijacked' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('pack_forbidden');
      expect(res.json().error.message).toBe("You don't have access to that word pack.");
    });

    it('404s (existence-hiding) for a non-owner on a private pack', async () => {
      const owner = await createGuest(server);
      const created = await createPack(owner.token, 'Private Pack');
      const { id } = created.json().pack;

      const stranger = await createGuest(server);
      const res = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${stranger.token}` },
        payload: { name: 'Hijacked' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    });

    it('mints an 8-char shareCode on private → unlisted, reusing it on repeat transitions', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Shareable');
      const { id } = created.json().pack;

      const first = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { visibility: 'unlisted' },
        remoteAddress: uniqueIp(),
      });
      expect(first.statusCode).toBe(200);
      const shareCode: string = first.json().pack.shareCode;
      expect(shareCode).toHaveLength(8);

      await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { visibility: 'private' },
        remoteAddress: uniqueIp(),
      });
      const again = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { visibility: 'unlisted' },
        remoteAddress: uniqueIp(),
      });
      expect(again.json().pack.shareCode).toBe(shareCode);
    });

    it('rejects a coverUrl not on the configured CDN domain', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Cover Test');
      const { id } = created.json().pack;

      const res = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { coverUrl: 'https://evil.example.com/x.png' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation');
    });

    it('accepts a coverUrl on the configured CDN domain', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Cover Test 2');
      const { id } = created.json().pack;
      const coverUrl = `${getEnv().r2PublicBaseUrl}/packCover/some-player/abc123.png`;

      const res = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { coverUrl },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().pack.coverUrl).toBe(coverUrl);
    });
  });

  describe('DELETE /v1/packs/:id', () => {
    it('lets the owner delete their pack (cascades pairs)', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Doomed Pack');
      const { id } = created.json().pack;
      await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: { pairs: [{ wordA: 'Sofa', wordB: 'Armchair' }] },
        remoteAddress: uniqueIp(),
      });

      const del = await server.inject({
        method: 'DELETE',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ ok: true });

      const remainingPairs = await getDb().select().from(wordPairs).where(eq(wordPairs.packId, id));
      expect(remainingPairs).toHaveLength(0);
    });

    it('403s a non-owner, 404s a stranger to a private pack', async () => {
      const owner = await createGuest(server);
      const created = await createPack(owner.token, 'Guarded Pack');
      const { id } = created.json().pack;

      const stranger = await createGuest(server);
      const res = await server.inject({
        method: 'DELETE',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${stranger.token}` },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /v1/packs/:id/pairs (bulk)', () => {
    it('inserts pairs and maintains pairCount transactionally', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Bulk Pack');
      const { id } = created.json().pack;

      const res = await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          pairs: [
            { wordA: 'Sofa', wordB: 'Armchair', difficulty: 'easy' },
            { wordA: 'Mustache', wordB: 'Beard' },
          ],
        },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(2);
      expect(res.json().items[1].difficulty).toBe('medium');

      const packRes = await server.inject({
        method: 'GET',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(packRes.json().pack.pairCount).toBe(2);
    });

    it('rejects the whole batch on any profane word, inserting nothing', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Profane Batch');
      const { id } = created.json().pack;

      const res = await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: { pairs: [{ wordA: 'Fine', wordB: 'shit' }] },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('profanity');

      const rows = await getDb().select().from(wordPairs).where(eq(wordPairs.packId, id));
      expect(rows).toHaveLength(0);
    });

    it('rejects more than 100 pairs in one call (schema validation)', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Too Big Batch');
      const { id } = created.json().pack;

      const pairs = Array.from({ length: 101 }, (_, i) => ({ wordA: `A${i}`, wordB: `B${i}` }));
      const res = await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: { pairs },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('enforces the 500-pairs-per-pack cap with the exact copy.md §9 pairLimit string', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Near Limit Pack');
      const { id } = created.json().pack;
      // Real rows, not just a denormalized `pairCount` bump — the limit check now
      // re-COUNTs actual active `word_pairs` rows inside a row lock (TOCTOU fix, bug found
      // in review), so it must have genuine rows to count against.
      await getDb()
        .insert(wordPairs)
        .values(
          Array.from({ length: 499 }, (_, i) => ({
            packId: id,
            wordA: `Filler A ${i}`,
            wordB: `Filler B ${i}`,
            difficulty: 'easy' as const,
          })),
        );
      await getDb().update(wordPacks).set({ pairCount: 499 }).where(eq(wordPacks.id, id));

      const res = await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: { pairs: [{ wordA: 'One', wordB: 'Two' }, { wordA: 'Three', wordB: 'Four' }] },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('pair_limit');
      expect(res.json().error.message).toBe(
        "That's the limit for this pack (500 pairs). Quality over quantity.",
      );
    });

    // Bug found in review: the limit check used to read `pack.pairCount` BEFORE the
    // transaction, so concurrent bulk inserts against the SAME pack could each pass the
    // check independently and jointly exceed 500. Seeds the pack to exactly 498 real pairs
    // (2 slots free) and fires 5 concurrent single-pair inserts — the row lock (`SELECT ...
    // FOR UPDATE` on the pack row, packs.ts `POST /packs/:id/pairs`) should let exactly 2
    // through.
    it('under concurrent bulk inserts at the boundary, only the pairs that fit are accepted', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Concurrent Pairs Pack');
      const { id } = created.json().pack;
      await getDb()
        .insert(wordPairs)
        .values(
          Array.from({ length: 498 }, (_, i) => ({
            packId: id,
            wordA: `Seed A ${i}`,
            wordB: `Seed B ${i}`,
            difficulty: 'easy' as const,
          })),
        );
      await getDb().update(wordPacks).set({ pairCount: 498 }).where(eq(wordPacks.id, id));

      const CONCURRENT_ATTEMPTS = 5;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_ATTEMPTS }, (_, i) =>
          server.inject({
            method: 'POST',
            url: `/v1/packs/${id}/pairs`,
            headers: { authorization: `Bearer ${token}` },
            payload: { pairs: [{ wordA: `Racer A ${i}`, wordB: `Racer B ${i}` }] },
            remoteAddress: uniqueIp(),
          }),
        ),
      );

      const succeeded = results.filter((res) => res.statusCode === 200);
      const limited = results.filter(
        (res) => res.statusCode === 400 && res.json().error.code === 'pair_limit',
      );
      expect(succeeded).toHaveLength(2);
      expect(limited).toHaveLength(CONCURRENT_ATTEMPTS - 2);

      // Direct DB confirmation: exactly 500 active rows, never 501+.
      const [countRow] = await getDb()
        .select({ count: sql<number>`count(*)::int` })
        .from(wordPairs)
        .where(eq(wordPairs.packId, id));
      expect(countRow?.count).toBe(500);
    });

    it('rejects an exact duplicate (wordA, wordB) within the same pack', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Dupe Pack');
      const { id } = created.json().pack;
      await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: { pairs: [{ wordA: 'Sofa', wordB: 'Armchair' }] },
        remoteAddress: uniqueIp(),
      });

      const res = await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: { pairs: [{ wordA: 'Sofa', wordB: 'Armchair' }] },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation');
    });

    it('403s/404s a non-owner exactly like the other write routes', async () => {
      const owner = await createGuest(server);
      const created = await createPack(owner.token, 'Not Yours');
      const { id } = created.json().pack;
      const stranger = await createGuest(server);
      const res = await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${stranger.token}` },
        payload: { pairs: [{ wordA: 'A', wordB: 'B' }] },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH/DELETE /v1/packs/:id/pairs/:pairId', () => {
    async function seedPairs(token: string, id: string) {
      const res = await server.inject({
        method: 'POST',
        url: `/v1/packs/${id}/pairs`,
        headers: { authorization: `Bearer ${token}` },
        payload: { pairs: [{ wordA: 'Sofa', wordB: 'Armchair', difficulty: 'easy' }] },
        remoteAddress: uniqueIp(),
      });
      return res.json().items[0].id as string;
    }

    it('updates a pair’s difficulty', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Editable Pack');
      const { id } = created.json().pack;
      const pairId = await seedPairs(token, id);

      const res = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}/pairs/${pairId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { difficulty: 'hard' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().pair.difficulty).toBe('hard');
      expect(res.json().pair.wordA).toBe('Sofa');
    });

    it('rejects a profane word update', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Profane Edit Pack');
      const { id } = created.json().pack;
      const pairId = await seedPairs(token, id);

      const res = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}/pairs/${pairId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { wordA: 'shit' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('profanity');
    });

    it('deletes a pair and decrements pairCount', async () => {
      const { token } = await createGuest(server);
      const created = await createPack(token, 'Deletable Pack');
      const { id } = created.json().pack;
      const pairId = await seedPairs(token, id);

      const del = await server.inject({
        method: 'DELETE',
        url: `/v1/packs/${id}/pairs/${pairId}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(del.statusCode).toBe(200);

      const packRes = await server.inject({
        method: 'GET',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: uniqueIp(),
      });
      expect(packRes.json().pack.pairCount).toBe(0);
    });
  });

  describe('POST /v1/packs/import', () => {
    it('grants read-access by share code without copying the pack', async () => {
      const owner = await createGuest(server);
      const created = await createPack(owner.token, 'Import Me');
      const { id } = created.json().pack;
      const patched = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { visibility: 'unlisted' },
        remoteAddress: uniqueIp(),
      });
      const shareCode: string = patched.json().pack.shareCode;

      const importer = await createGuest(server);
      const res = await server.inject({
        method: 'POST',
        url: '/v1/packs/import',
        headers: { authorization: `Bearer ${importer.token}` },
        payload: { shareCode },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().pack.id).toBe(id);
      expect(res.json().pack.ownerId).toBe(owner.playerId);

      const grant = await getDb()
        .select()
        .from(packAccess)
        .where(eq(packAccess.packId, id));
      expect(grant.some((row) => row.playerId === importer.playerId)).toBe(true);

      const mine = await server.inject({
        method: 'GET',
        url: '/v1/packs?mine=true',
        headers: { authorization: `Bearer ${importer.token}` },
        remoteAddress: uniqueIp(),
      });
      const mineIds: string[] = mine.json().items.map((p: { id: string }) => p.id);
      expect(mineIds).toContain(id);
    });

    it('404s an unknown share code', async () => {
      const { token } = await createGuest(server);
      const res = await server.inject({
        method: 'POST',
        url: '/v1/packs/import',
        headers: { authorization: `Bearer ${token}` },
        payload: { shareCode: 'NOTREAL1' },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s a share code for a pack that has since gone private again', async () => {
      const owner = await createGuest(server);
      const created = await createPack(owner.token, 'Went Private');
      const { id } = created.json().pack;
      const patched = await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { visibility: 'unlisted' },
        remoteAddress: uniqueIp(),
      });
      const shareCode: string = patched.json().pack.shareCode;
      await server.inject({
        method: 'PATCH',
        url: `/v1/packs/${id}`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { visibility: 'private' },
        remoteAddress: uniqueIp(),
      });

      const importer = await createGuest(server);
      const res = await server.inject({
        method: 'POST',
        url: '/v1/packs/import',
        headers: { authorization: `Bearer ${importer.token}` },
        payload: { shareCode },
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

/**
 * Live-game leak guard (api-contract.md §1): `GET
 * /packs/:id/pairs` must 403 a non-owner seated in a room currently mid-game
 * with that pack in `settings.packIds`, and go back to 200 once the game
 * ends (`phase:'game_over'`) or before it starts (`phase:'lobby'`). Room
 * state is seeded directly via `createRoom` (same technique as
 * `routes/rooms.test.ts`'s "room already at maxPlayers" case) rather than
 * running a real game through every phase.
 */
describe('pack live-game leak guard', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const DEFAULT_AVATAR = { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' } as const;

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

  async function insertOfficialPack(name: string): Promise<string> {
    const [pack] = await getDb()
      .insert(wordPacks)
      .values({ name, isOfficial: true, ownerId: null, visibility: 'public' })
      .returning();
    if (!pack) throw new Error('insert failed');
    return pack.id;
  }

  async function insertCustomPack(name: string, ownerId: string): Promise<string> {
    const [pack] = await getDb()
      .insert(wordPacks)
      .values({ name, isOfficial: false, ownerId, visibility: 'private' })
      .returning();
    if (!pack) throw new Error('insert failed');
    return pack.id;
  }

  /** A real 5-char room code drawn from the production alphabet (31^5 ≈ 28.6M
   * combinations) — collision-free in practice, unlike the old `LEAK${digit}`
   * scheme this replaced, whose `.slice(0, 5)` accidentally truncated the
   * random suffix down to a single digit (only 10 distinct codes) and caused
   * `createRoom`'s `SET NX` to spuriously fail whenever two of the several
   * `seedMidGameRoom` calls in this file landed on the same code. */
  function uniqueRoomCode(): string {
    return Array.from(
      { length: ROOM_CODE_LENGTH },
      () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
    ).join('');
  }

  async function seedMidGameRoom(code: string, packId: string, memberId: string): Promise<void> {
    const settings: GameSettings = {
      maxPlayers: 12,
      undercoverCount: 1,
      mrWhiteCount: 0,
      specialRoles: [],
      packIds: [packId],
      difficulties: ['easy', 'medium', 'hard'],
      clueTimerSec: 60,
      discussionTimerSec: 120,
      voteTimerSec: 45,
      mrWhiteFirstClueBan: true,
      eliminationReveal: 'role',
    };
    const roomPlayers = [fakePlayer(memberId, 'Member', 0), fakePlayer(randomUUID(), 'Other', 1)];
    const state = {
      ...createGame(settings, roomPlayers, 'seed', Date.now()),
      mode: 'online_private' as const,
      code,
      phase: 'clue' as const,
    };
    const created = await createRoom(code, state);
    if (!created) throw new Error('createRoom failed');
  }

  it('403s a room member during a mid-game phase, 200s once the game ends', async () => {
    const packId = await insertOfficialPack('Leak Guard Pack');
    await getDb()
      .insert(wordPairs)
      .values({ packId, wordA: 'Sofa', wordB: 'Armchair', difficulty: 'easy' });

    const member = await createGuest(server, { displayName: 'Member' });
    const code = uniqueRoomCode();
    await seedMidGameRoom(code, packId, member.playerId);

    const midGame = await server.inject({
      method: 'GET',
      url: `/v1/packs/${packId}/pairs`,
      headers: { authorization: `Bearer ${member.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(midGame.statusCode).toBe(403);
    expect(midGame.json().error.code).toBe('pack_forbidden');

    // Flip the seeded room straight to `game_over` (the leak guard only cares about
    // phase, not how a game reaches it) and confirm access returns.
    const loaded = await loadRoom(code);
    if (!loaded) throw new Error('room missing');
    await applyRoomAction(code, (state) => ({ state: { ...state, phase: 'game_over' }, effects: [] }));

    const afterGame = await server.inject({
      method: 'GET',
      url: `/v1/packs/${packId}/pairs`,
      headers: { authorization: `Bearer ${member.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(afterGame.statusCode).toBe(200);
  });

  it('never blocks the room member from a DIFFERENT pack than the one in play', async () => {
    const inPlayPackId = await insertOfficialPack('In Play Pack');
    const otherPackId = await insertOfficialPack('Bystander Pack');
    await getDb()
      .insert(wordPairs)
      .values({ packId: otherPackId, wordA: 'Cat', wordB: 'Dog', difficulty: 'easy' });

    const member = await createGuest(server, { displayName: 'Member2' });
    const code = uniqueRoomCode();
    await seedMidGameRoom(code, inPlayPackId, member.playerId);

    const res = await server.inject({
      method: 'GET',
      url: `/v1/packs/${otherPackId}/pairs`,
      headers: { authorization: `Bearer ${member.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
  });

  it('never blocks a stranger who is not seated in the room at all', async () => {
    const packId = await insertOfficialPack('Unseated Pack');
    const seated = await createGuest(server, { displayName: 'Seated' });
    const code = uniqueRoomCode();
    await seedMidGameRoom(code, packId, seated.playerId);

    const stranger = await createGuest(server, { displayName: 'Stranger' });
    const res = await server.inject({
      method: 'GET',
      url: `/v1/packs/${packId}/pairs`,
      headers: { authorization: `Bearer ${stranger.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
  });

  // Bug found in review: the leak guard used to unconditionally exempt the pack OWNER,
  // which meant an owner playing their own pack mid-game could call this endpoint anytime,
  // diff the full pair list against their own dealt word (`YouSlice.word`, visible
  // client-side), and deduce the opposing faction's word — exactly the leak this guard
  // exists to prevent. "Owner sees all" (api-contract.md §1) is a VISIBILITY rule, not a
  // leak-guard exemption.
  it('403s the OWNER too when they are themselves seated in the mid-game room using their own pack', async () => {
    const owner = await createGuest(server, { displayName: 'OwnerPlayer' });
    const packId = await insertCustomPack('Owner Plays Own Pack', owner.playerId);
    await getDb()
      .insert(wordPairs)
      .values({ packId, wordA: 'Sofa', wordB: 'Armchair', difficulty: 'easy' });

    const code = uniqueRoomCode();
    await seedMidGameRoom(code, packId, owner.playerId);

    const res = await server.inject({
      method: 'GET',
      url: `/v1/packs/${packId}/pairs`,
      headers: { authorization: `Bearer ${owner.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('pack_forbidden');
  });

  it('still 200s the owner when they are NOT currently playing a live game with the pack', async () => {
    const owner = await createGuest(server, { displayName: 'OwnerNotPlaying' });
    const packId = await insertCustomPack('Owner Not Playing', owner.playerId);
    await getDb()
      .insert(wordPairs)
      .values({ packId, wordA: 'Cat', wordB: 'Dog', difficulty: 'easy' });

    // A DIFFERENT room draws from this pack, with the owner NOT seated in it — the owner
    // should be unaffected (mirrors the "different pack"/"unseated stranger" cases above,
    // but for the owner specifically).
    const otherPlayer = await createGuest(server, { displayName: 'SomeoneElse' });
    const code = uniqueRoomCode();
    await seedMidGameRoom(code, packId, otherPlayer.playerId);

    const res = await server.inject({
      method: 'GET',
      url: `/v1/packs/${packId}/pairs`,
      headers: { authorization: `Bearer ${owner.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });
});

/**
 * Self-service public packs (no review gate enforced at launch): patching a pack to
 * `visibility:'public'` sets `reviewStatus:'approved'` in the same step, so it's immediately
 * visible/usable to everyone. The `approve_pack` moderation action + `review_status` column
 * are dormant infrastructure for a future gate, still verified here. Mirrors the
 * visibility-matrix setup above (HTTP for create/patch, `createGuest` for identities,
 * `performModerationAction` for the admin side).
 */
describe('self-service public packs', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  async function createPack(token: string, name: string): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/packs',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
      remoteAddress: uniqueIp(),
    });
    return res.json().pack.id as string;
  }

  async function patchVisibility(
    token: string,
    id: string,
    visibility: 'private' | 'unlisted' | 'public',
  ) {
    return server.inject({
      method: 'PATCH',
      url: `/v1/packs/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { visibility },
      remoteAddress: uniqueIp(),
    });
  }

  it('flips a pack to public → approved immediately, so a non-owner can see and use it at once', async () => {
    const owner = await createGuest(server, { displayName: 'PackOwner' });
    const stranger = await createGuest(server, { displayName: 'Stranger' });
    const id = await createPack(owner.token, 'Going Public');
    await server.inject({
      method: 'POST',
      url: `/v1/packs/${id}/pairs`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { pairs: [{ wordA: 'Sofa', wordB: 'Armchair' }] },
      remoteAddress: uniqueIp(),
    });

    // Owner makes it public → the response reports public + approved (immediately live).
    const patched = await patchVisibility(owner.token, id, 'public');
    expect(patched.statusCode).toBe(200);
    expect(patched.json().pack.visibility).toBe('public');
    expect(patched.json().pack.reviewStatus).toBe('approved');

    // A non-owner can immediately reach it by direct id and read its pairs — no approval step.
    const strangerById = await server.inject({
      method: 'GET',
      url: `/v1/packs/${id}`,
      headers: { authorization: `Bearer ${stranger.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(strangerById.statusCode).toBe(200);
    expect(strangerById.json().pack.reviewStatus).toBe('approved');
    const strangerPairs = await server.inject({
      method: 'GET',
      url: `/v1/packs/${id}/pairs`,
      headers: { authorization: `Bearer ${stranger.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(strangerPairs.statusCode).toBe(200);
    expect(strangerPairs.json().items).toHaveLength(1);

    // Owner still sees their own public pack in their list (the public browse catalog that
    // would surface it to strangers' lists is a separate follow-up, not built here).
    const ownerList = await server.inject({
      method: 'GET',
      url: '/v1/packs',
      headers: { authorization: `Bearer ${owner.token}` },
      remoteAddress: uniqueIp(),
    });
    expect((ownerList.json().items as { id: string }[]).some((p) => p.id === id)).toBe(true);
  });

  it('going private again hides a public pack from non-owners; going public re-exposes it immediately', async () => {
    const owner = await createGuest(server, { displayName: 'Waffler' });
    const stranger = await createGuest(server, { displayName: 'Onlooker' });
    const id = await createPack(owner.token, 'On Again Off Again');

    await patchVisibility(owner.token, id, 'public');
    // Back to private → the non-owner loses access.
    await patchVisibility(owner.token, id, 'private');
    const whilePrivate = await server.inject({
      method: 'GET',
      url: `/v1/packs/${id}`,
      headers: { authorization: `Bearer ${stranger.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(whilePrivate.statusCode).toBe(404);

    // Public again → approved again, immediately visible (no gate to clear).
    const rePublic = await patchVisibility(owner.token, id, 'public');
    expect(rePublic.json().pack.reviewStatus).toBe('approved');
    const afterPublic = await server.inject({
      method: 'GET',
      url: `/v1/packs/${id}`,
      headers: { authorization: `Bearer ${stranger.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(afterPublic.statusCode).toBe(200);
  });

  // Dormant infrastructure for a future review gate: the `approve_pack` action still flips a
  // pack's review_status to 'approved' and logs the audit row, even though nothing sets a
  // pack to 'pending' via the API today. Exercised here against a directly-inserted pending
  // public pack (simulating what a switched-on gate would produce).
  it('approve_pack flips a pending pack to approved and logs the audit row', async () => {
    const owner = await createGuest(server, { displayName: 'FutureGate' });
    const [pack] = await getDb()
      .insert(wordPacks)
      .values({ name: 'Awaiting (dormant)', isOfficial: false, ownerId: owner.playerId, visibility: 'public' })
      .returning();
    const id = pack?.id ?? '';
    // Direct insert defaults review_status to 'pending' — the state a future gate would use.
    const [before] = await getDb().select().from(wordPacks).where(eq(wordPacks.id, id));
    expect(before?.reviewStatus).toBe('pending');

    const result = await performModerationAction({ action: 'approve_pack', packId: id });
    expect(result.ok).toBe(true);

    const [after] = await getDb().select().from(wordPacks).where(eq(wordPacks.id, id));
    expect(after?.reviewStatus).toBe('approved');
    const logs = await getDb().select().from(moderationActions).where(eq(moderationActions.packId, id));
    expect(logs.some((l) => l.action === 'approve_pack')).toBe(true);
  });

  it('approve_pack without a packId is rejected', async () => {
    const result = await performModerationAction({ action: 'approve_pack' });
    expect(result.ok).toBe(false);
  });
});

/**
 * Public catalog: `GET /packs/public` (discover addable public packs) +
 * `POST /packs/:id/import` (add one by id, minting a `pack_access` grant). Completes the
 * public-pack loop begun by WP-03a's self-service `visibility:'public'`: a browsed catalog
 * pack, once imported, joins the caller's `GET /packs` set and is thus playable. Rows
 * accumulate across tests in the shared DB, so assertions key on specific ids (and the
 * pagination walk scopes itself with a unique `q` prefix) rather than absolute counts.
 */
describe('public pack catalog', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  async function insertPack(opts: {
    name: string;
    ownerId: string | null;
    isOfficial?: boolean;
    visibility: 'private' | 'unlisted' | 'public';
    reviewStatus?: 'pending' | 'approved' | 'rejected';
  }): Promise<string> {
    const [pack] = await getDb()
      .insert(wordPacks)
      .values({
        name: opts.name,
        isOfficial: opts.isOfficial ?? false,
        ownerId: opts.ownerId,
        visibility: opts.visibility,
        ...(opts.reviewStatus ? { reviewStatus: opts.reviewStatus } : {}),
      })
      .returning();
    if (!pack) throw new Error('insert failed');
    return pack.id;
  }

  function browse(token: string, query = '') {
    return server.inject({
      method: 'GET',
      url: `/v1/packs/public${query}`,
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
  }

  function importById(token: string, id: string) {
    return server.inject({
      method: 'POST',
      url: `/v1/packs/${id}/import`,
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: uniqueIp(),
    });
  }

  describe('GET /v1/packs/public', () => {
    it('lists an approved public pack owned by another player', async () => {
      const owner = await createGuest(server);
      const caller = await createGuest(server);
      const publicId = await insertPack({
        name: 'Community Pack',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });

      const res = await browse(caller.token);
      expect(res.statusCode).toBe(200);
      const ids: string[] = res.json().items.map((p: { id: string }) => p.id);
      expect(ids).toContain(publicId);
    });

    it('excludes official, own, already-imported, pending, private and unlisted packs', async () => {
      const owner = await createGuest(server);
      const caller = await createGuest(server);

      const officialId = await insertPack({
        name: 'Catalog Official',
        ownerId: null,
        isOfficial: true,
        visibility: 'public',
        reviewStatus: 'approved',
      });
      const ownPublicId = await insertPack({
        name: 'My Own Public',
        ownerId: caller.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });
      const importedId = await insertPack({
        name: 'Already Imported',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });
      await getDb().insert(packAccess).values({ packId: importedId, playerId: caller.playerId });
      const pendingId = await insertPack({
        name: 'Pending Public',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'pending',
      });
      const privateId = await insertPack({
        name: 'Private Stash',
        ownerId: owner.playerId,
        visibility: 'private',
      });
      const unlistedId = await insertPack({
        name: 'Unlisted Pack',
        ownerId: owner.playerId,
        visibility: 'unlisted',
      });
      const addableId = await insertPack({
        name: 'Addable Pack',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });

      const res = await browse(caller.token);
      expect(res.statusCode).toBe(200);
      const ids: string[] = res.json().items.map((p: { id: string }) => p.id);
      expect(ids).toContain(addableId);
      expect(ids).not.toContain(officialId);
      expect(ids).not.toContain(ownPublicId);
      expect(ids).not.toContain(importedId);
      expect(ids).not.toContain(pendingId);
      expect(ids).not.toContain(privateId);
      expect(ids).not.toContain(unlistedId);
    });

    it('honors the q name search case-insensitively', async () => {
      const owner = await createGuest(server);
      const caller = await createGuest(server);
      const foodId = await insertPack({
        name: 'Qsearch Food & Drink',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });
      const animalsId = await insertPack({
        name: 'Qsearch Animals',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });

      const res = await browse(caller.token, '?q=qSeArCh%20food');
      expect(res.statusCode).toBe(200);
      const ids: string[] = res.json().items.map((p: { id: string }) => p.id);
      expect(ids).toContain(foodId);
      expect(ids).not.toContain(animalsId);
    });

    it('walks the cursor to exhaustion with no dupes and no gaps (scoped by q)', async () => {
      const owner = await createGuest(server);
      const caller = await createGuest(server);
      const TOTAL = 25;
      await getDb()
        .insert(wordPacks)
        .values(
          Array.from({ length: TOTAL }, (_, i) => ({
            name: `Zzcatalog ${String(i).padStart(2, '0')}`,
            isOfficial: false,
            ownerId: owner.playerId,
            visibility: 'public' as const,
            reviewStatus: 'approved' as const,
          })),
        );

      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url = cursor
          ? `?q=Zzcatalog&limit=10&cursor=${encodeURIComponent(cursor)}`
          : '?q=Zzcatalog&limit=10';
        const res = await browse(caller.token, url);
        expect(res.statusCode).toBe(200);
        const body: { items: { id: string }[]; nextCursor: string | null } = res.json();
        expect(body.items.length).toBeLessThanOrEqual(10);
        for (const item of body.items) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
        }
        cursor = body.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(6);
      } while (cursor);

      expect(seen.size).toBe(TOTAL);
      expect(pages).toBe(3); // 10 + 10 + 5
    });

    it('rejects a malformed cursor with a validation error', async () => {
      const { token } = await createGuest(server);
      const res = await browse(token, '?cursor=not-valid-base64url!!!');
      expect(res.statusCode).toBe(400);
    });

    it('requires auth', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/v1/packs/public',
        remoteAddress: uniqueIp(),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /v1/packs/:id/import', () => {
    it('adds a public pack by id: grants access, then it shows in GET /packs and drops out of the catalog', async () => {
      const owner = await createGuest(server);
      const importer = await createGuest(server);
      const publicId = await insertPack({
        name: 'Import By Id',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });
      await getDb()
        .insert(wordPairs)
        .values({ packId: publicId, wordA: 'Sofa', wordB: 'Armchair', difficulty: 'easy' });

      const res = await importById(importer.token, publicId);
      expect(res.statusCode).toBe(200);
      expect(res.json().pack.id).toBe(publicId);
      expect(res.json().pack.ownerId).toBe(owner.playerId);

      const grant = await getDb().select().from(packAccess).where(eq(packAccess.packId, publicId));
      expect(grant.some((row) => row.playerId === importer.playerId)).toBe(true);

      // Now in the importer's own set (playable in a game — same set the room picker reads).
      const mine = await server.inject({
        method: 'GET',
        url: '/v1/packs?mine=true',
        headers: { authorization: `Bearer ${importer.token}` },
        remoteAddress: uniqueIp(),
      });
      expect((mine.json().items as { id: string }[]).map((p) => p.id)).toContain(publicId);

      // And no longer offered by the catalog (already imported).
      const afterBrowse = await browse(importer.token);
      expect((afterBrowse.json().items as { id: string }[]).map((p) => p.id)).not.toContain(
        publicId,
      );
    });

    it('is idempotent — a repeat import stays 200 and leaves exactly one grant', async () => {
      const owner = await createGuest(server);
      const importer = await createGuest(server);
      const publicId = await insertPack({
        name: 'Import Twice',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });

      expect((await importById(importer.token, publicId)).statusCode).toBe(200);
      expect((await importById(importer.token, publicId)).statusCode).toBe(200);

      const grants = await getDb()
        .select()
        .from(packAccess)
        .where(eq(packAccess.packId, publicId));
      expect(grants.filter((row) => row.playerId === importer.playerId)).toHaveLength(1);
    });

    it('404s a private, unlisted, or pending public pack without minting a grant', async () => {
      const owner = await createGuest(server);
      const importer = await createGuest(server);
      const privateId = await insertPack({
        name: 'Refuse Private',
        ownerId: owner.playerId,
        visibility: 'private',
      });
      const unlistedId = await insertPack({
        name: 'Refuse Unlisted',
        ownerId: owner.playerId,
        visibility: 'unlisted',
      });
      const pendingId = await insertPack({
        name: 'Refuse Pending',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'pending',
      });

      for (const id of [privateId, unlistedId, pendingId]) {
        const res = await importById(importer.token, id);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('not_found');
        const grant = await getDb().select().from(packAccess).where(eq(packAccess.packId, id));
        expect(grant.some((row) => row.playerId === importer.playerId)).toBe(false);
      }
    });

    it('404s an unknown pack id', async () => {
      const { token } = await createGuest(server);
      const res = await importById(token, '00000000-0000-4000-8000-000000000000');
      expect(res.statusCode).toBe(404);
    });

    it("importing the caller's OWN public pack is a no-op that mints no grant row", async () => {
      const owner = await createGuest(server);
      const ownId = await insertPack({
        name: 'My Public Pack',
        ownerId: owner.playerId,
        visibility: 'public',
        reviewStatus: 'approved',
      });

      const res = await importById(owner.token, ownId);
      expect(res.statusCode).toBe(200);
      expect(res.json().pack.id).toBe(ownId);

      // Ownership already grants access, so no self-grant is written.
      const grant = await getDb().select().from(packAccess).where(eq(packAccess.packId, ownId));
      expect(grant).toHaveLength(0);
    });
  });
});
