'use client';

import clsx from 'clsx';
import { copy } from '@/copy';
import { usePnpStore } from '@/stores/pnp-store';

/**
 * The Judge special role's tie-breaking decision (game-design.md §6.4) —
 * pass-and-play hands the device straight to the Judge (mirrors `mrwhite-screen.tsx`: no
 * separate pass interstitial). `game.tiedPlayerIds` names the valid targets;
 * `submitJudgeDecision` dispatches `judgeDecide` on the Judge's behalf — no player picker
 * needed, since the engine already knows who holds the role and rejects anyone else.
 */
export function PnpJudgeDecisionScreen() {
  const game = usePnpStore((s) => s.game);
  const submitJudgeDecision = usePnpStore((s) => s.submitJudgeDecision);

  if (!game || game.phase !== 'judge_decision') {
    return null;
  }

  const tiedIds = new Set(game.tiedPlayerIds ?? []);
  const tied = game.players.filter((p) => tiedIds.has(p.id));

  return (
    <div
      data-testid="pnp-judge-decision-screen"
      className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-6 bg-phase-vote px-4 py-10 text-center transition-colors duration-300"
    >
      <h1 className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.roles.special.judge.dealCardLine}
      </h1>
      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
        {tied.map((target) => (
          <button
            key={target.id}
            type="button"
            data-testid="pnp-judge-target"
            data-name={target.name}
            onClick={() => submitJudgeDecision(target.id)}
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
    </div>
  );
}
