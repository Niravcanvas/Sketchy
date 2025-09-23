import type { AvatarConfig } from '@sketchy/engine/types';

/**
 * The single canonical default doodle every player is created with (pinned
 * decision) — a valid, neutral `AvatarConfig`. Guest creation stamps this on
 * new rows (`routes/auth.ts`), and self-service account deletion resets the
 * anonymized row to it (`routes/accounts.ts`) so the scrubbed row still
 * carries a well-formed avatar that serializes cleanly against
 * `avatarConfigSchema` everywhere it's read. Home is this file (not a route
 * module) so both writers share ONE constant rather than duplicating the
 * literal.
 */
export const DEFAULT_AVATAR: AvatarConfig = {
  head: 'round',
  face: 'smile',
  accessory: 'none',
  inkColor: 'ink',
};

/**
 * Deterministic placeholder avatar for a player whose `players.avatar` row
 * isn't a well-formed `AvatarConfig` (pinned decision). In practice
 * every GUEST row gets a real `AvatarConfig` at creation (the `DEFAULT_AVATAR`
 * above), so this fallback exists for defensive robustness (a row written some
 * other way) rather than the common case.
 *
 * Part ids here are PLACEHOLDERS, not the real Open Peeps composer output —
 * `apps/web` separately owns the actual `<AvatarDoodle>` part
 * catalog, which this file must not import (apps/api never imports
 * apps/web). `apps/web/src/lib/default-avatar.ts` documents that
 * `<AvatarDoodle>` skips unknown part ids by design, so shipping these
 * names is safe even though they will not match the real catalog — folding
 * both fallbacks into one shared `packages/shared` implementation is
 * logged debt.
 */
const HEADS = ['short-flat', 'bald', 'bun', 'flat-top'] as const;
const FACES = ['smile', 'calm', 'grin'] as const;
const ACCESSORIES = ['none', 'glasses'] as const;

/** Ink color TOKEN NAMES (conventions.md §2 palette), never raw hex. */
const INK_COLORS = ['civilian', 'undercover', 'mrwhite', 'success', 'highlight'] as const;

/** Simple deterministic string hash (djb2-ish) — good enough for "spread avatars
 * across a small set of cycles", not a cryptographic property. */
function hashPlayerId(playerId: string): number {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Deterministic fallback `AvatarConfig` derived from a player id: the same
 * id always produces the same config (no reshuffling on repeated calls).
 */
export function defaultAvatarForPlayerId(playerId: string): AvatarConfig {
  const hash = hashPlayerId(playerId);
  // `noUncheckedIndexedAccess` can't prove `% length` is in-bounds on these
  // non-empty `as const` cycles — the `!` assertions can never actually fail.
  return {
    head: HEADS[hash % HEADS.length]!,
    face: FACES[Math.floor(hash / HEADS.length) % FACES.length]!,
    accessory:
      ACCESSORIES[Math.floor(hash / (HEADS.length * FACES.length)) % ACCESSORIES.length]!,
    inkColor:
      INK_COLORS[
        Math.floor(hash / (HEADS.length * FACES.length * ACCESSORIES.length)) % INK_COLORS.length
      ]!,
  };
}

/**
 * True if `avatar` is a well-formed `AvatarConfig` (every field a non-empty
 * string) — `players.avatar` is stored as untyped jsonb defaulting to `{}`
 * (data-model.md §1), so a row written before an avatar was ever set (or
 * some future path that doesn't) needs this guard rather than trusting the
 * Drizzle `$type<AvatarConfig>()` annotation, which is compile-time-only.
 */
export function isValidAvatarConfig(avatar: unknown): avatar is AvatarConfig {
  if (typeof avatar !== 'object' || avatar === null) {
    return false;
  }
  const candidate = avatar as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.head) &&
    isNonEmptyString(candidate.face) &&
    isNonEmptyString(candidate.accessory) &&
    isNonEmptyString(candidate.inkColor)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Resolves the avatar to persist a player into a `GameState` with: the
 * stored avatar if valid, else the deterministic per-id fallback. */
export function resolveAvatar(playerId: string, storedAvatar: unknown): AvatarConfig {
  return isValidAvatarConfig(storedAvatar) ? storedAvatar : defaultAvatarForPlayerId(playerId);
}
