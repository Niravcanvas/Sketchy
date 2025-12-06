import type { ReactNode } from 'react';
import { paletteVar, type PaletteToken } from '@/lib/palette-tokens';

export interface PopTimerRingProps {
  /** Fraction of the ring already elapsed, 0–1. */
  progress: number;
  /** Palette token for the progress arc — never a raw hex. */
  color: PaletteToken;
  /** Ring diameter in px. */
  size?: number;
  /** Centered slot — e.g. the countdown number. */
  children?: ReactNode;
}

/**
 * Timer ring (design-party-pop.md §5.5): a plain 3px ink circle (the track)
 * with a 6px progress arc in the given token color, hard-shadowed white disc
 * behind, display-face digits in the middle.
 */
export function PopTimerRing({ progress, color, size = 120, children }: PopTimerRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const track = 3;
  const arc = 6;
  const radius = size / 2 - arc;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center rounded-full border-3 border-ink bg-paper-2 shadow-hard-sm"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={paletteVar('ink')}
          strokeOpacity={0.12}
          strokeWidth={track}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={paletteVar(color)}
          strokeWidth={arc}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="relative z-10 flex items-center justify-center font-display text-ink">
        {children}
      </div>
    </div>
  );
}
