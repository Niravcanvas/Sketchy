'use client';

import { useState, type FormEvent } from 'react';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitMrWhiteGuess } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

/** `mrWhiteGuessPayloadSchema` bound (1-60 chars after trim) — the input enforces the cap the
 * wire contract will re-check server-side. */
const GUESS_MAX_LEN = 60;

/**
 * Mr. White's interception (game-design.md §6.6) — the online split of pass-and-play's single
 * screen: the just-eliminated Mr. White (`pendingElimination`) gets the one-shot guess input;
 * everyone else watches the deliberately tense "hold your breath" screen. The 30-s countdown
 * is the server's (`StatusStrip` renders `phaseEndsAt`; its timeout resolves as a wrong
 * guess). A correct guess cuts straight to the Mr. White win screen; a wrong one lets play
 * continue (the wrong-guess laugh is `GuessInterlude`). Matching is case/diacritic-insensitive
 * server-side, so the input does no normalization of its own.
 */
export function OnlineMrWhiteScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!snapshot || !you) {
    return null;
  }

  // Client gate only — the engine is the referee (it rejects any actor that isn't
  // `pendingElimination`). Mirrors clue-screen deriving `isHost` from the public snapshot.
  const isGuesser = snapshot.pendingElimination === you.playerId;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const ack = await emitMrWhiteGuess(trimmed);
    setIsSubmitting(false);
    if (ack.ok) {
      setText('');
    } else {
      setError(copyForError(ack.error));
    }
  }

  if (!isGuesser) {
    return (
      // Spotlight/held-tension ground (design-party-pop.md §7/§9) —
      // mirrors the pnp mrwhite-screen's identical treatment; the ambient
      // `bg-phase-reveal` background already comes from `GameScreen`'s phase mapping, `.dots`
      // just overlays the halftone texture on top of it.
      <div
        data-testid="online-mrwhite-waiting"
        className="dots flex flex-col items-center gap-4 py-10 text-center"
      >
        <p className="pnp-slam font-display text-2xl uppercase tracking-wide text-mrwhite">
          {copy.reveal.mrWhiteGuess.othersWaiting}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="online-mrwhite-screen"
      className="dots flex flex-col items-center gap-6 py-6 text-center"
    >
      <PopCard className="flex w-full max-w-md flex-col items-center gap-6 py-8">
        <h1 className="pnp-slam font-display text-3xl uppercase tracking-wide text-mrwhite">
          {copy.reveal.mrWhiteGuess.yours}
        </h1>
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="flex w-full flex-col items-center gap-4"
        >
          <PopInput
            label={copy.reveal.mrWhiteGuess.yours}
            placeholder={copy.reveal.mrWhiteGuess.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={GUESS_MAX_LEN}
            data-testid="online-mrwhite-input"
            className="text-center"
            autoFocus
          />
          <PopButton
            type="submit"
            variant="accent"
            size="lg"
            data-testid="online-mrwhite-submit"
            disabled={isSubmitting || text.trim().length === 0}
          >
            {copy.reveal.mrWhiteGuess.button}
          </PopButton>
        </form>
        {error ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {error}
          </p>
        ) : null}
      </PopCard>
    </div>
  );
}
