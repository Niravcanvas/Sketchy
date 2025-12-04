'use client';

import { useEffect, useRef } from 'react';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { usePnpStore, type InterludeKind } from '@/stores/pnp-store';

/**
 * Full-screen interrupt for a beat the engine already resolved but the host must
 * acknowledge before play continues (pnp-store.ts's `InterludeKind`: a second tie, an
 * all-abstain round, or a wrong Mr. White guess). Renders nothing when there's no
 * interlude. `interlude` is cleared only by `dismissInterlude()` — never a later dispatch
 * — so a fast-following action can never race it off screen before the host has seen it.
 */
export function PnpInterludeOverlay() {
  const game = usePnpStore((s) => s.game);
  const interlude = usePnpStore((s) => s.interlude);
  const dismissInterlude = usePnpStore((s) => s.dismissInterlude);

  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (interlude) continueRef.current?.focus();
  }, [interlude]);

  if (!interlude || !game) return null;

  const body = bodyFor(interlude, game.lastGuess?.text ?? '');

  return (
    <div
      data-testid="pnp-interlude"
      data-kind={interlude}
      role="alertdialog"
      aria-modal="true"
      aria-label={body}
      className="dots fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-paper px-6 text-center"
    >
      <PopCard className="flex w-full max-w-md flex-col items-center gap-6 py-10">
        <p className="font-display text-2xl uppercase tracking-wide text-ink">{body}</p>
        <PopButton
          ref={continueRef}
          type="button"
          variant="primary"
          size="lg"
          data-testid="pnp-interlude-continue"
          onClick={dismissInterlude}
        >
          {copy.roles.dealChrome.confirm}
        </PopButton>
      </PopCard>
    </div>
  );
}

function bodyFor(kind: InterludeKind, guessText: string): string {
  if (kind === 'second_tie') return copy.phases.secondTie;
  if (kind === 'all_abstain') return copy.phases.allAbstain;
  return copy.reveal.guessWrong(guessText);
}
