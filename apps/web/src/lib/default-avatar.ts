import type { AvatarConfig } from '@sketchy/engine/types';
import {
  AVATAR_ACCESSORY_IDS,
  AVATAR_FACE_IDS,
  AVATAR_HEAD_IDS,
  AVATAR_INK_COLORS,
} from '@/components/avatar/avatar-config';

/**
 * Deterministic per-seat avatar config: same seat index always produces the same config, so
 * a checkpoint round-trip (or replaying the same seed) never reshuffles anyone's look.
 * `seat` is expected to be the player's seat index (0-based, `>= 0`); a negative input is
 * clamped defensively rather than throwing (callers never need to special-case this file).
 *
 * Ids come from the curated Open Peeps set `<AvatarDoodle>`/`<AvatarPicker>` ship real art
 * for (avatar-config.ts). The curated lists aren't coprime-length by construction (heads/faces are both 8;
 * accessories/ink colors are both 5), so each field cycles with its own small offset — without
 * that, two same-length lists always pair the same element together at a given seat (index 0
 * mod 8 forever matching head[0] with face[0]), which defeats the "don't repeat the exact
 * same look too soon" property this function has always aimed for.
 */
export function defaultAvatar(seat: number): AvatarConfig {
  const index = Math.max(0, Math.trunc(seat));
  // `% length` on a non-negative index (optionally offset by a small constant, still
  // non-negative) is always a valid array index, but `noUncheckedIndexedAccess` can't prove
  // that — the `as const` id lists are non-empty and fixed-length, so the non-null assertions
  // here can never actually fail.
  return {
    head: AVATAR_HEAD_IDS[index % AVATAR_HEAD_IDS.length]!,
    face: AVATAR_FACE_IDS[(index + 3) % AVATAR_FACE_IDS.length]!,
    accessory: AVATAR_ACCESSORY_IDS[(index + 1) % AVATAR_ACCESSORY_IDS.length]!,
    inkColor: AVATAR_INK_COLORS[(index + 2) % AVATAR_INK_COLORS.length]!,
  };
}
