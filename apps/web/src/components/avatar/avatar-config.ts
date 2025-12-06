/**
 * Curated Open Peeps part ids for `<AvatarDoodle>` / `<AvatarPicker>` (arch/conventions.md
 * §2 — CREDITS.md has the full vendoring write-up). `AvatarConfig.head`/`.face`/`.accessory`
 * stay plain `string` in packages/engine (FROZEN shape — see packages/engine/src/types.ts),
 * so any string can show up in a stored config; these tuples are only "the ids we ship art
 * for today", not a closed type the engine enforces. Unknown ids just skip their layer
 * (avatar-doodle.tsx) rather than crash — future part additions never break old configs.
 */

export const AVATAR_HEAD_IDS = [
  'afro',
  'bun',
  'flat-top',
  'beanie',
  'mohawk',
  'long',
  'shaved',
  'turban',
] as const;
export type AvatarHeadId = (typeof AVATAR_HEAD_IDS)[number];

export const AVATAR_FACE_IDS = [
  'smile',
  'calm',
  'cheeky',
  'concerned',
  'suspicious',
  'awe',
  'eyes-closed',
  'explaining',
] as const;
export type AvatarFaceId = (typeof AVATAR_FACE_IDS)[number];

/**
 * `'none'` is a real, selectable value — `AvatarPicker`'s accessory row cycles through it
 * like any other id. It just means "render no accessory layer" (`<AvatarDoodle>` treats it,
 * and any id it doesn't recognize, identically — see avatar-accessories.ts).
 */
export const AVATAR_ACCESSORY_IDS = [
  'none',
  'glasses-round',
  'glasses-bold',
  'sunglasses',
  'eyepatch',
] as const;
export type AvatarAccessoryId = (typeof AVATAR_ACCESSORY_IDS)[number];

/**
 * Palette token names `AvatarConfig.inkColor` cycles through (conventions.md §2), mirroring
 * the subset already carved out in `lib/default-avatar.ts`: chrome/background tokens
 * (`paper`/`paper-2`/`ink`/`graphite`) are excluded — they're not accent colors an avatar
 * should wear.
 */
export const AVATAR_INK_COLORS = [
  'civilian',
  'undercover',
  'mrwhite',
  'success',
  'highlight',
] as const;
export type AvatarInkColor = (typeof AVATAR_INK_COLORS)[number];

/**
 * Type guard: is `id` one of the curated ids in `ids`? `AvatarConfig`'s `head`/`face`/
 * `accessory`/`inkColor` fields are frozen as plain `string` (packages/engine/src/types.ts),
 * so callers that want to cycle/index through one of the tuples above (AvatarPicker's
 * prev/next rows) need to safely narrow a stored value back to the literal id type first —
 * falling back to the list's first id, never throwing, when the stored value isn't one we
 * recognize.
 */
export function isKnownAvatarId<T extends string>(ids: readonly T[], id: string): id is T {
  return (ids as readonly string[]).includes(id);
}

/**
 * One flattened `<path>` from a vendored Open Peeps part (avatar-heads.ts / avatar-faces.ts
 * / avatar-accessories.ts — those files document the source-color → shape transform in
 * full). Plain data, not markup: `avatar-doodle.tsx` renders each entry as a real JSX
 * `<path>`, so there's no raw-HTML injection anywhere in the composer.
 */
export interface AvatarShape {
  /** SVG path `d` attribute, verbatim from the vendored source. */
  d: string;
  /** `'current'` → `fill="currentColor"` (solid ink); `'none'` → transparent, so the paper
   * background shows through instead of a second hard-edged color. */
  fill: 'current' | 'none';
  /** Only the head silhouette outline uses a stroke today. */
  stroke?: 'current';
  strokeWidth?: number;
}
