'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitSpecialJudge } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

/**
 * The Judge special role's tie-breaking decision (game-design.md §6.4) — the
 * online split mirroring Mr. White's guess screen (`mrwhite-screen.tsx`): the Judge
 * (`you.canAct.judge`, computed server-side) gets a grid of the tied players to pick from;
 * everyone else watches "The Judge is deciding…" The engine restricts the eventual target
 * to `tiedPlayerIds` and validates the actor actually holds the role — this screen only
 * collects the click. The Judge's identity is public to everyone the instant this phase is
 * ever entered (data-model.md §4) — `PlayerStrip` renders that reveal, not this screen.
 */
export function OnlineJudgeDecisionScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeciding, setIsDeciding] = useState(false);

  if (!snapshot || !you) {
    return null;
  }

  const isJudge = you.canAct.judge;
  const tiedIds = new Set(snapshot.tiedPlayerIds ?? []);
  const tied = snapshot.players.filter((p) => tiedIds.has(p.id));

  async function handleDecide(): Promise<void> {
    if (!selected || isDeciding) {
      return;
    }
    setIsDeciding(true);
    setError(null);
    const ack = await emitSpecialJudge(selected);
    setIsDeciding(false);
    if (!ack.ok) {
      setError(copyForError(ack.error));
    }
  }

  if (!isJudge) {
    return (
      <div
        data-testid="online-judge-waiting"
        className="flex flex-col items-center gap-4 py-10 text-center"
      >
        <p className="font-display text-2xl uppercase tracking-wide text-highlight">
          {copy.roles.special.judge.waitingForDecision}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="online-judge-decision-screen"
      className="flex w-full flex-col items-center gap-6 px-2 py-4 text-center"
    >
      <header className="flex flex-col items-center gap-2">
        <p className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.roles.special.judge.dealCardLine}
        </p>
      </header>

      <div className="grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
        {tied.map((target) => (
          <button
            key={target.id}
            type="button"
            data-testid="online-judge-target"
            data-name={target.name}
            onClick={() => setSelected(target.id)}
            className={clsx(
              'rounded-xl border-3 border-ink px-4 py-6 font-ui text-lg font-bold text-ink shadow-hard-sm',
              'transition-[transform,box-shadow] duration-[80ms] ease-out',
              'hover:-translate-y-0.5',
              'active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
              selected === target.id ? 'bg-highlight' : 'bg-paper-2',
            )}
          >
            {target.name}
          </button>
        ))}
      </div>

      <PopButton
        data-testid="online-judge-confirm"
        size="lg"
        disabled={selected === null || isDeciding}
        onClick={() => {
          void handleDecide();
        }}
      >
        {copy.phases.voting.lockItIn}
      </PopButton>

      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
    </div>
  );
}
