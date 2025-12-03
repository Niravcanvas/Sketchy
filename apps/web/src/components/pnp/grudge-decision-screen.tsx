'use client';

import clsx from 'clsx';
import { copy } from '@/copy';
import { usePnpStore } from '@/stores/pnp-store';

/**
 * The Grudge special role's drag-down decision (game-design.md §6.5) —
 * pass-and-play hands the device straight to the Grudge (mirrors `judge-decision-screen.tsx`:
 * no separate pass interstitial). Every currently ALIVE player is a valid target (a wider
 * pool than the Judge's `tiedPlayerIds`); `submitGrudgeDrag` dispatches `grudgeDrag` on the
 * Grudge's behalf. UNLIKE online rooms (which fall back to "drags nobody" on a 30s timeout),
 * P&P is always untimed, so this screen ALSO offers an explicit "drag nobody" button —
 * without it, that valid, ordinary outcome (copy.md §3.2) would be unreachable offline.
 */
export function PnpGrudgeDecisionScreen() {
  const game = usePnpStore((s) => s.game);
  const submitGrudgeDrag = usePnpStore((s) => s.submitGrudgeDrag);
  const dragNobody = usePnpStore((s) => s.dragNobody);

  if (!game || game.phase !== 'grudge_decision') {
    return null;
  }

  const targets = game.players.filter((p) => p.alive);

  return (
    <div
      data-testid="pnp-grudge-decision-screen"
      className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-6 bg-phase-vote px-4 py-10 text-center transition-colors duration-300"
    >
      <h1 className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.roles.special.grudge.dealCardLine}
      </h1>
      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            data-testid="pnp-grudge-target"
            data-name={target.name}
            onClick={() => submitGrudgeDrag(target.id)}
            className={clsx(
              'rounded-xl border-3 border-ink bg-paper-2 px-4 py-6 font-ui text-lg font-bold text-ink shadow-hard-sm',
              'transition-[transform,box-shadow] duration-[80ms] ease-out',
              'hover:-translate-y-0.5',
              'active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
            )}
          >
            {target.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="pnp-grudge-drag-nobody"
        onClick={dragNobody}
        className="font-ui text-sm font-bold text-graphite underline underline-offset-4"
      >
        {copy.roles.special.grudge.draggedNobody}
      </button>
    </div>
  );
}
