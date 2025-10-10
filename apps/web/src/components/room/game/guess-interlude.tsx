'use client';

import { useEffect, useRef, useState } from 'react';
import { copy } from '@/copy';
import { useRoomStore } from '@/stores/room-store';

/** How long the wrong-guess laugh stays up before the game moves on visually. It's purely a
 * transient beat — the engine has already advanced the phase (next round / game over). */
const SHOW_MS = 4500;

/**
 * The wrong-guess beat (game-design.md §6.6: "the wrong guess is shown to everyone — always a
 * laugh"). Mr. White's guess resolves the phase in the same tick (a wrong guess goes straight
 * to the next clue round or game over — there's no `mrwhite_guess` phase left to render it
 * in), so this watches the PUBLIC `lastGuess` and flashes the result as a transient banner,
 * the online analog of pass-and-play's interlude overlay. A CORRECT guess is skipped — that's
 * the win screen's headline (`copy.reveal.guessRight`), not a fleeting toast.
 */
export function GuessInterlude() {
  const lastGuess = useRoomStore((state) => state.snapshot?.lastGuess ?? null);
  const [shownGuess, setShownGuess] = useState<string | null>(null);
  const handledKey = useRef<string | null>(null);

  useEffect(() => {
    if (!lastGuess || lastGuess.correct) {
      return;
    }
    // `lastGuess` arrives as a fresh object every snapshot; key by content so an unchanged
    // guess (re-broadcast on some later action) doesn't re-trigger the banner.
    const key = `${lastGuess.playerId}:${lastGuess.text}`;
    if (handledKey.current === key) {
      return;
    }
    handledKey.current = key;
    setShownGuess(lastGuess.text);
  }, [lastGuess]);

  useEffect(() => {
    if (shownGuess === null) {
      return;
    }
    const timeout = setTimeout(() => setShownGuess(null), SHOW_MS);
    return () => clearTimeout(timeout);
  }, [shownGuess]);

  if (shownGuess === null) {
    return null;
  }

  return (
    <div
      role="status"
      data-testid="online-guess-wrong"
      className="pnp-toast-slam mx-auto max-w-xl rounded-xl border-3 border-ink bg-paper-2 px-5 py-4 text-center font-ui text-base font-medium text-ink shadow-hard"
    >
      {copy.reveal.guessWrong(shownGuess)}
    </div>
  );
}
