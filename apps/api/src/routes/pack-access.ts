/**
 * The single "can this caller see/use this pack" gate — shared by the pack
 * read routes (`routes/packs.ts`), the write routes (ownership checks), and
 * game integration (`sockets/lobby.ts` settings, `sockets/play.ts` draw-time
 * check, `routes/rooms.ts` room creation) so there is exactly one
 * interpretation of "access" across the whole app.
 *
 * Access = official pack, OR caller owns it, OR it's an APPROVED
 * `visibility:'public'` pack, OR the caller holds a `pack_access` grant (minted
 * by `POST /packs/import`, data-model.md §1). This EXTENDS the original
 * `isVisible()` interpretation (which had official/owned/public — imports and the
 * `review_status` column came later) rather than replacing it.
 *
 * The public branch requires `review_status='approved'`. Today this is a no-op filter for
 * legitimate traffic: going public is self-service and sets `'approved'` in the same step,
 * so every public pack is already approved. The check is the DORMANT half of a future
 * review gate — it only starts excluding public packs if that gate is switched on (PATCH→
 * public sets `'pending'`) or an admin manually sets a pack back to pending. Ownership is
 * checked first, so an owner always reaches their own pack regardless; official and imported
 * packs are unaffected (they never carry a non-`approved` public state).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { packAccess, wordPacks } from '../db/schema.js';

type WordPackRow = typeof wordPacks.$inferSelect;

/**
 * The one predicate for "is this pack open to strangers via its public visibility?" —
 * public AND approved. Since going public self-approves, this is `true` for every public
 * pack in normal operation; it would only return `false` for a public pack left non-approved
 * by a future review gate (or a manual admin action) — the dormant case. Callers that grant
 * the OWNER access do so via a separate `ownerId === callerId` check BEFORE this, so this
 * never gates an owner out of their own pack.
 */
function isPubliclyApproved(pack: Pick<WordPackRow, 'visibility' | 'reviewStatus'>): boolean {
  return pack.visibility === 'public' && pack.reviewStatus === 'approved';
}

/** True if `callerId` has SOME access grant recorded for `packId` (imported it). */
async function hasGrant(packId: string, callerId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ packId: packAccess.packId })
    .from(packAccess)
    .where(and(eq(packAccess.packId, packId), eq(packAccess.playerId, callerId)))
    .limit(1);
  return Boolean(row);
}

/** True if `callerId` may read `pack` at all (pack row already loaded — the by-ID routes'
 * shape, where a single row is on hand and a 404 vs. 200 decision is being made). */
export async function hasPackAccess(pack: WordPackRow, callerId: string): Promise<boolean> {
  if (pack.isOfficial || pack.ownerId === callerId || isPubliclyApproved(pack)) {
    return true;
  }
  return hasGrant(pack.id, callerId);
}

/**
 * True if `callerId` may read EVERY pack in `packIds` — the batch form used
 * wherever a settings patch/room draw references a set of packs at once
 * (`lobby:settings`, `POST /rooms`, `game:start`/`game:rematch`). A single
 * batched query for the grant lookup (not one query per pack) — bounded by
 * how many packs a room's settings can reasonably reference.
 */
export async function allPackIdsAccessible(packIds: string[], callerId: string): Promise<boolean> {
  if (packIds.length === 0) {
    return true;
  }
  const uniqueIds = [...new Set(packIds)];
  const db = getDb();
  const rows = await db.select().from(wordPacks).where(inArray(wordPacks.id, uniqueIds));
  if (rows.length !== uniqueIds.length) {
    // A referenced pack id doesn't exist at all — treat exactly like "no access"
    // (existence-hiding, same posture as the by-ID 404s in routes/packs.ts).
    return false;
  }

  const needsGrantCheck = rows.filter(
    (row) => !row.isOfficial && row.ownerId !== callerId && !isPubliclyApproved(row),
  );
  if (needsGrantCheck.length === 0) {
    return true;
  }

  const grantRows = await db
    .select({ packId: packAccess.packId })
    .from(packAccess)
    .where(
      and(
        eq(packAccess.playerId, callerId),
        inArray(
          packAccess.packId,
          needsGrantCheck.map((row) => row.id),
        ),
      ),
    );
  const grantedIds = new Set(grantRows.map((row) => row.packId));
  return needsGrantCheck.every((row) => grantedIds.has(row.id));
}

/** Every pack id `callerId` has an import grant for — used to widen `GET /packs`'s
 * default/`mine` listing beyond ownership (routes/packs.ts). */
export async function grantedPackIds(callerId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ packId: packAccess.packId })
    .from(packAccess)
    .where(eq(packAccess.playerId, callerId));
  return rows.map((row) => row.packId);
}
