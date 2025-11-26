import clsx from 'clsx';

export interface PackCoverProps {
  /** `Pack.coverUrl` — when set, renders the real image. */
  coverUrl: string | null;
  /** Seeds the deterministic placeholder shape/color so the same pack always renders the
   * same placeholder (usually `Pack.id`). */
  seed: string;
  className?: string;
}

/** Fixed rotation of `bg-*` fills — semantic role tokens doubling as decoration here, same
 * "no raw hex" rule as everywhere else (design-party-pop.md §2). */
const PLACEHOLDER_FILLS = ['bg-civilian', 'bg-undercover', 'bg-mrwhite', 'bg-success'] as const;
const PLACEHOLDER_SHAPES = ['rounded-full', 'rounded-xl', 'rounded-lg'] as const;

/** Small, stable string hash (no crypto needed — this only picks a decorative variant). */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Pack cover: the real `coverUrl` image when a pack has one, otherwise a deterministic
 * auto-generated Party Pop placeholder — a solid, ink-bordered shape, never Rough.js
 * (design-party-pop.md). The placeholder is seeded per pack so it
 * doesn't reshuffle on every render/refetch.
 */
export function PackCover({ coverUrl, seed, className }: PackCoverProps) {
  if (coverUrl) {
    // A plain <img>, not next/image: coverUrl is an arbitrary external R2/CDN URL, not a
    // build-time-known asset next/image's optimizer needs to be configured for.
    return (
      <img
        src={coverUrl}
        alt=""
        className={clsx('h-full w-full border-3 border-ink object-cover', className)}
      />
    );
  }

  const hash = hashString(seed);
  const fill = PLACEHOLDER_FILLS[hash % PLACEHOLDER_FILLS.length];
  const shapeClass = PLACEHOLDER_SHAPES[(hash >> 3) % PLACEHOLDER_SHAPES.length];

  return (
    <div
      aria-hidden="true"
      className={clsx('flex h-full w-full items-center justify-center border-3 border-ink bg-paper-2', className)}
    >
      <div className={clsx('h-2/3 w-2/3 border-3 border-ink', fill, shapeClass)} />
    </div>
  );
}
