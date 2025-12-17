import { paletteVar } from '@/lib/palette-tokens';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

const VIEWBOX_WIDTH = 280;
const VIEWBOX_HEIGHT = 72;
const PADDING = 8;
const MIN_POINTS_TO_DRAW = 2;

export interface PointsSparklineProps {
  /** This player's per-game points, OLDEST first (chronological) — the caller reverses the
   * newest-first history page before passing it in. */
  pointsChronological: number[];
}

/**
 * Points-over-time mini sparkline: a solid ink-bordered SVG polyline
 * — no chart library, no Rough.js (design-party-pop.md). Plain `<polyline>`/`<circle>` in
 * palette-token colors via `paletteVar()`, the same primitive `PopTimerRing`'s arc uses.
 */
export function PointsSparkline({ pointsChronological }: PointsSparklineProps) {
  const hasEnoughData = pointsChronological.length >= MIN_POINTS_TO_DRAW;

  return (
    <PopCard className="flex w-full flex-col gap-2">
      <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.profile.sparkline.header}
      </h2>
      {hasEnoughData ? (
        <>
          <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
            {copy.profile.sparkline.helper(pointsChronological.length)}
          </p>
          <Sparkline points={pointsChronological} />
        </>
      ) : (
        <p className="font-ui text-sm text-graphite">{copy.profile.sparkline.tooFewGames}</p>
      )}
    </PopCard>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const innerWidth = VIEWBOX_WIDTH - PADDING * 2;
  const innerHeight = VIEWBOX_HEIGHT - PADDING * 2;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  const coords = points.map((value, index) => {
    const x = PADDING + index * stepX;
    const y = PADDING + innerHeight - ((value - min) / range) * innerHeight;
    return { x, y };
  });

  const polylinePoints = coords.map(({ x, y }) => `${x},${y}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      className="h-20 w-full rounded-lg border-3 border-ink bg-paper-2"
      role="img"
      aria-label={copy.profile.sparkline.helper(points.length)}
    >
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={paletteVar('civilian')}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map((coord, index) => (
        // Index key: this list is chronological, fixed-length, and never reordered.
        <circle key={index} cx={coord.x} cy={coord.y} r={3.5} fill={paletteVar('ink')} />
      ))}
    </svg>
  );
}
