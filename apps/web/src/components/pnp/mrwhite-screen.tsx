'use client';

import { useState, type FormEvent } from 'react';
import { copy } from '@/copy';
import { usePnpStore } from '@/stores/pnp-store';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';

/**
 * game-design.md §6.6 — Mr. White's single guess window. Unlike online rooms (which split
 * this into "guesser" vs "everyone else watches" screens), pass-and-play hands the device
 * straight to the just-eliminated Mr. White the moment `phase === 'mrwhite_guess'` —
 * `game.pendingElimination` IS the only valid actor here (pnp-store.ts
 * `submitMrWhiteGuess` dispatches on their behalf, no player picker needed). The
 * `othersWaiting` line still renders as the tension beat: everyone else at the table is
 * watching this one device.
 *
 * A wrong guess doesn't route anywhere from here — the store detects it as the
 * `'wrong_guess'` interlude (pnp-store.ts `detectInterlude`) and `PnpInterludeOverlay`
 * (owned elsewhere) renders it. This screen only ever submits; it never interprets
 * `lastGuess` itself.
 */
export function PnpMrWhiteScreen() {
  const submitMrWhiteGuess = usePnpStore((s) => s.submitMrWhiteGuess);
  const [text, setText] = useState('');
  const canSubmit = text.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    submitMrWhiteGuess(trimmed);
    setText('');
  }

  return (
    <div
      data-testid="pnp-mrwhite-screen"
      // Spotlight/held-tension ground (design-party-pop.md §7/§9):
      // the halftone `.dots` texture over the reveal-phase background is the sanctioned
      // "loud moment, quiet screen" treatment — no idle-looping pulse on top of it (§1 law
      // 5: "screens calm, transitions loud"; the entrance Slam below IS the drama beat).
      className="dots flex min-h-screen flex-col items-center justify-center gap-8 bg-phase-reveal px-6 text-center transition-colors duration-300"
    >
      <PopCard className="flex w-full max-w-md flex-col items-center gap-6 py-10">
        <h1 className="pnp-slam font-display text-4xl uppercase tracking-wide text-mrwhite">
          {copy.reveal.mrWhiteGuess.yours}
        </h1>
        <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-4">
          <PopInput
            label={copy.reveal.mrWhiteGuess.yours}
            placeholder={copy.reveal.mrWhiteGuess.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            data-testid="pnp-mrwhite-input"
            className="text-center"
            autoFocus
          />
          <PopButton
            type="submit"
            variant="primary"
            size="lg"
            data-testid="pnp-mrwhite-submit"
            disabled={!canSubmit}
          >
            {copy.reveal.mrWhiteGuess.button}
          </PopButton>
        </form>
        <p className="font-ui text-sm text-graphite">{copy.reveal.mrWhiteGuess.othersWaiting}</p>
      </PopCard>
    </div>
  );
}
