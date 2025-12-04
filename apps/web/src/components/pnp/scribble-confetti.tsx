import clsx from 'clsx';

export interface ScribbleConfettiProps {
  /** Piece count — kept in the 20–30 hand-rolled range this component was designed for. */
  count?: number;
}

/** Flat geometric sticker pieces (24x24 viewBox, solid fill) cycled by index — a rounded
 * square, a dot, and a triangle (design-party-pop.md §8), so the burst reads as Party Pop
 * confetti rather than one repeated shape. */
type ConfettiShape = 'square' | 'circle' | 'triangle';
const SHAPES = ['square', 'circle', 'triangle'] as const satisfies readonly ConfettiShape[];

/** Faction/highlight palette tokens only (conventions.md §2 — no raw hex in components);
 * `stroke-current` + a `text-*` color class is how an SVG stroke picks up a Tailwind token. */
const COLOR_CLASSES = [
  'text-civilian',
  'text-undercover',
  'text-mrwhite',
  'text-highlight',
  'text-success',
] as const;

/** Deterministic pseudo-random in [0, 1) from an integer seed (no `Math.random` — render
 * must be stable across re-renders, per this component's spec). */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface Piece {
  id: number;
  left: number;
  top: number;
  rotation: number;
  delay: number;
  size: number;
  shape: ConfettiShape;
  colorClass: string;
}

function buildPieces(count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: 4 + seededRandom(i * 4 + 1) * 92,
    top: 4 + seededRandom(i * 4 + 2) * 70,
    rotation: Math.round(seededRandom(i * 4 + 3) * 720 - 360),
    delay: Math.round(seededRandom(i * 4 + 4) * 350),
    size: 14 + Math.round(seededRandom(i * 4 + 5) * 12),
    shape: SHAPES[i % SHAPES.length] as ConfettiShape,
    colorClass: COLOR_CLASSES[i % COLOR_CLASSES.length] as string,
  }));
}

/** One flat sticker piece — solid fill, no stroke (design-party-pop.md §8). */
function ConfettiPiece({ shape }: { shape: ConfettiShape }) {
  if (shape === 'square') {
    return <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" stroke="none" />;
  }
  if (shape === 'circle') {
    return <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />;
  }
  return <path d="M12 4 L20 20 L4 20 Z" fill="currentColor" stroke="none" />;
}

/**
 * Purely decorative win-screen confetti (game-design.md §6.7): 20–30 flat geometric sticker
 * pieces (design-party-pop.md §8) that fall + rotate into place once (~1200ms total including
 * stagger), then settle — no idle looping (conventions.md §3). `prefers-reduced-motion` swaps
 * the fall for a static, already-settled burst rather than removing it outright. Positions are
 * index-derived, so the same `count` always renders the same layout.
 */
export function ScribbleConfetti({ count = 26 }: ScribbleConfettiProps) {
  const pieces = buildPieces(count);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes pnp-confetti-fall {
          0% { transform: translateY(-48px) rotate(0deg) scale(0.5); opacity: 0; }
          55% { opacity: 1; }
          100% { transform: translateY(0) rotate(var(--pnp-confetti-rotation)) scale(1); opacity: 1; }
        }
        .pnp-confetti-piece {
          animation: pnp-confetti-fall 850ms ease-out forwards;
          animation-delay: var(--pnp-confetti-delay);
          opacity: 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .pnp-confetti-piece {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
      {pieces.map((piece) => (
        <svg
          key={piece.id}
          className={clsx('pnp-confetti-piece absolute', piece.colorClass)}
          style={{
            left: `${piece.left}%`,
            top: `${piece.top}%`,
            width: piece.size,
            height: piece.size,
            ['--pnp-confetti-rotation' as string]: `${piece.rotation}deg`,
            ['--pnp-confetti-delay' as string]: `${piece.delay}ms`,
          }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <ConfettiPiece shape={piece.shape} />
        </svg>
      ))}
    </div>
  );
}
