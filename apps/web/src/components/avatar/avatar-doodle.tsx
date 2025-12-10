import type { AvatarConfig } from '@sketchy/engine/types';
import { paletteVar, PALETTE_TOKENS, type PaletteToken } from '@/lib/palette-tokens';
import type { AvatarShape } from './avatar-config';
import { AVATAR_ACCESSORIES } from './avatar-accessories';
import { AVATAR_FACES } from './avatar-faces';
import { AVATAR_HEADS } from './avatar-heads';

/**
 * Shared Open Peeps coordinate system (CREDITS.md has the full transform write-up): every
 * vendored part was authored against DiceBear's open-peeps 704×704 canvas, and head/face/
 * accessory only line up when drawn with these exact per-layer offsets — don't touch them
 * without re-checking alignment across all curated parts. `VIEW_BOX` crops that canvas down
 * to just the head; the source canvas reserves the bottom third for a torso we never vendor.
 */
const VIEW_BOX = '52 0 600 580';
const HEAD_TRANSFORM = 'matrix(0.99789 0 0 1 156 62)';
const FACE_TRANSFORM = 'translate(315 248)';
const ACCESSORY_TRANSFORM = 'translate(203 303)';

const DEFAULT_INK_TOKEN: PaletteToken = 'ink';

function isPaletteToken(value: string): value is PaletteToken {
  return (PALETTE_TOKENS as readonly string[]).includes(value);
}

/**
 * Looks up a vendored part by id without widening the data table's literal-keyed `Record<K,
 * AvatarShape[]>` to plain `string` at the call site. `AvatarConfig.head`/`.face`/
 * `.accessory` are frozen as plain `string` (packages/engine/src/types.ts), so a stored
 * config can carry an id we've never shipped art for (an older/newer part set, a
 * hand-crafted test fixture, …) — that must resolve to `undefined` here, never a thrown
 * error or a TS index error.
 */
function lookupPart<K extends string>(
  table: Record<K, AvatarShape[]>,
  id: string,
): AvatarShape[] | undefined {
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id as K] : undefined;
}

/** Renders one part's flattened shapes as real `<path>` elements — no markup strings, no
 * `dangerouslySetInnerHTML` anywhere in the composer (see avatar-config.ts's `AvatarShape`). */
function renderShapes(shapes: AvatarShape[] | undefined, keyPrefix: string) {
  if (!shapes) return null;
  return shapes.map((shape, index) => (
    <path
      key={`${keyPrefix}-${index}`}
      d={shape.d}
      fillRule="evenodd"
      clipRule="evenodd"
      fill={shape.fill === 'current' ? 'currentColor' : 'none'}
      stroke={shape.stroke === 'current' ? 'currentColor' : undefined}
      strokeWidth={shape.strokeWidth}
    />
  ));
}

export interface AvatarDoodleProps {
  config: AvatarConfig;
  /** Rendered width/height in px — the SVG is always square. Default matches a lobby-sized
   * player chip; picker previews and roster avatars pass their own. */
  size?: number;
  className?: string;
  /** Supplying a title makes the doodle an accessible image (`role="img"` + a real `<title>`
   * for its name). Omit it (the default) for decorative uses, which stay `aria-hidden`
   * (conventions.md §4 — every non-decorative element needs an accessible name, decorative
   * ones must not clutter the a11y tree). */
  title?: string;
}

/**
 * Pure presentational Open Peeps composer (conventions.md §2; `AvatarConfig` in
 * arch/data-model.md). Layers head → face → accessory into one `<svg>`, all recolored to
 * `currentColor` at vendor time (see avatar-heads.ts/avatar-faces.ts/avatar-accessories.ts)
 * so a single CSS `color` — resolved from `AvatarConfig.inkColor`'s palette token name —
 * drives every stroke and fill. Never throws on an unrecognized part id: it just skips that
 * layer, so a config saved before a part existed (or one that's since been renamed) keeps
 * rendering instead of crashing the tree it's mounted in.
 */
export function AvatarDoodle({ config, size = 96, className, title }: AvatarDoodleProps) {
  const headShapes = lookupPart(AVATAR_HEADS, config.head);
  const faceShapes = lookupPart(AVATAR_FACES, config.face);
  const accessoryShapes = lookupPart(AVATAR_ACCESSORIES, config.accessory);
  const color = paletteVar(isPaletteToken(config.inkColor) ? config.inkColor : DEFAULT_INK_TOKEN);

  return (
    <svg
      viewBox={VIEW_BOX}
      width={size}
      height={size}
      className={className}
      style={{ color }}
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      data-testid="avatar-doodle"
    >
      {title ? <title>{title}</title> : null}
      {headShapes ? (
        <g transform={HEAD_TRANSFORM}>{renderShapes(headShapes, 'head')}</g>
      ) : null}
      {faceShapes ? (
        <g transform={FACE_TRANSFORM}>{renderShapes(faceShapes, 'face')}</g>
      ) : null}
      {accessoryShapes ? (
        <g transform={ACCESSORY_TRANSFORM}>{renderShapes(accessoryShapes, 'accessory')}</g>
      ) : null}
    </svg>
  );
}
