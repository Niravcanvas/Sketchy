import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { moderationActions, players, reports, wordPacks, wordPairs } from '../db/schema.js';
import { suspendPlayer } from './suspension.js';

/**
 * Admin moderation actions. The DB side of
 * the token-gated reports queue (routes/admin.ts): dismiss / warn / suspend /
 * retire-pack / approve-pack. EVERY action logs a `moderation_actions` row
 * ("Log every action"). Kept out of the route so it's unit-testable without HTTP.
 *
 * `retire_pack` and `approve_pack` are the two mirror-image pack decisions:
 * retire pulls a pack's pairs from the draw pool; approve clears a public pack's
 * review gate so strangers can finally see/use it. `approve_pack` is standalone —
 * it acts on a pack directly, NOT off the back of a player report — so it needs a
 * `packId` but no `reportId`.
 */
export type ModerationActionKind = 'dismiss' | 'warn' | 'suspend' | 'retire_pack' | 'approve_pack';

export type ModerationResult = { ok: true } | { ok: false; error: string };

/** Resolves the reported player for a report id (the target of warn/suspend). */
async function reportedPlayerId(reportId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ reportedId: reports.reportedId })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  return row?.reportedId ?? null;
}

async function markReportStatus(reportId: string, status: 'actioned' | 'dismissed'): Promise<void> {
  await getDb().update(reports).set({ status }).where(eq(reports.id, reportId));
}

async function log(
  action: ModerationActionKind,
  detail: string,
  ids: { reportId?: string; targetPlayerId?: string; packId?: string },
): Promise<void> {
  await getDb().insert(moderationActions).values({
    action,
    reportId: ids.reportId ?? null,
    targetPlayerId: ids.targetPlayerId ?? null,
    packId: ids.packId ?? null,
    detail,
  });
}

export async function performModerationAction(params: {
  action: ModerationActionKind;
  reportId?: string;
  packId?: string;
}): Promise<ModerationResult> {
  const { action, reportId, packId } = params;

  switch (action) {
    case 'dismiss': {
      if (!reportId) {
        return { ok: false, error: 'dismiss needs a reportId' };
      }
      await markReportStatus(reportId, 'dismissed');
      await log('dismiss', 'report dismissed', { reportId });
      return { ok: true };
    }
    case 'warn': {
      if (!reportId) {
        return { ok: false, error: 'warn needs a reportId' };
      }
      const targetPlayerId = await reportedPlayerId(reportId);
      if (!targetPlayerId) {
        return { ok: false, error: 'report or reported player not found' };
      }
      await getDb().update(players).set({ warnedAt: new Date() }).where(eq(players.id, targetPlayerId));
      await markReportStatus(reportId, 'actioned');
      await log('warn', 'player warned', { reportId, targetPlayerId });
      return { ok: true };
    }
    case 'suspend': {
      if (!reportId) {
        return { ok: false, error: 'suspend needs a reportId' };
      }
      const targetPlayerId = await reportedPlayerId(reportId);
      if (!targetPlayerId) {
        return { ok: false, error: 'report or reported player not found' };
      }
      const suspended = await suspendPlayer(targetPlayerId);
      if (!suspended) {
        return { ok: false, error: 'player not found' };
      }
      await markReportStatus(reportId, 'actioned');
      await log('suspend', 'player suspended', { reportId, targetPlayerId });
      return { ok: true };
    }
    case 'retire_pack': {
      if (!packId) {
        return { ok: false, error: 'retire_pack needs a packId' };
      }
      // Retire = mark every pair in the pack `rejected` (pair_status enum), which
      // removes them from the draw pool (idx_pairs_pack is WHERE status='active';
      // rooms/pair-draw.ts only draws active pairs) — the pack can no longer be
      // played without touching the frozen contract or engine.
      await getDb()
        .update(wordPairs)
        .set({ status: 'rejected' })
        .where(eq(wordPairs.packId, packId));
      if (reportId) {
        await markReportStatus(reportId, 'actioned');
      }
      await log('retire_pack', 'pack retired (pairs rejected)', { reportId, packId });
      return { ok: true };
    }
    case 'approve_pack': {
      if (!packId) {
        return { ok: false, error: 'approve_pack needs a packId' };
      }
      // Clear the public-catalog review gate: `review_status='approved'` is what makes a
      // `visibility:'public'` pack visible/usable to non-owners (routes/pack-access.ts).
      // Standalone action — no `reportId` — so nothing to mark actioned here.
      await getDb()
        .update(wordPacks)
        .set({ reviewStatus: 'approved' })
        .where(eq(wordPacks.id, packId));
      await log('approve_pack', 'pack approved for public catalog', { packId });
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown action' };
  }
}
