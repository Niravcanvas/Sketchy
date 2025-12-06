'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitSpecialGrudge } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

/**
 * The Grudge special role's drag-down decision (game-design.md §6.5) — the online
 * split mirroring the Judge's own decision screen (`judge-decision-screen.tsx`): the Grudge
 * (`you.canAct.grudge`, computed server-side) gets a grid of every currently ALIVE player to
 * pick from — a wider pool than the Judge's `tiedPlayerIds` — everyone else watches "The
 * Grudge is deciding…". The engine validates the actor actually holds the role and IS the
 * just-eliminated `pendingElimination`; this screen only collects the click. Unlike the
 * Judge, there's no self-service "drag nobody" button here — that outcome only ever comes
 * from the 30s timeout or the host's early `phase:advance` (mirrors the Judge screen's own
 * "always names someone" shape); the Grudge's identity is already public by the time this
 * phase opens (the ordinary eliminated-player reveal rule, not a special exception).
 */
export function OnlineGrudgeDecisionScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (!snapshot || !you) {
    return null;
  }

  const isGrudge = you.canAct.grudge;
  const targets = snapshot.players.filter((p) => p.alive);

  async function handleDrag(): Promise<void> {
    if (!selected || isDragging) {
      return;
    }
    setIsDragging(true);
    setError(null);
    const ack = await emitSpecialGrudge(selected);
    setIsDragging(false);
    if (!ack.ok) {
      setError(copyForError(ack.error));
    }
  }

  if (!isGrudge) {
    return (
      <div
        data-testid="online-grudge-waiting"
        className="flex flex-col items-center gap-4 py-10 text-center"
      >
        <p className="font-display text-2xl uppercase tracking-wide text-highlight">
          {copy.roles.special.grudge.waitingForDecision}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="online-grudge-decision-screen"
      className="flex w-full flex-col items-center gap-6 px-2 py-4 text-center"
    >
      <header className="flex flex-col items-center gap-2">
        <p className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.roles.special.grudge.dealCardLine}
        </p>
      </header>

      <div className="grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            data-testid="online-grudge-target"
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
        data-testid="online-grudge-confirm"
        size="lg"
        disabled={selected === null || isDragging}
        onClick={() => {
          void handleDrag();
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
