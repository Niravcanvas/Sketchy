'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { EngineErrorCode } from '@sketchy/engine/apply-action';
import { CLUE_MAX_LEN } from '@sketchy/engine/constants';
import { ClueBoard } from '@/components/game/clue-board';
import { HintBanner } from '@/components/hints/hint-banner';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { currentSpeaker, usePnpStore } from '@/stores/pnp-store';

/**
 * Maps a rejected `submitClue` dispatch to its §9 line. `wrong_phase`/`not_your_turn` are
 * unreachable in practice — the derived `currentSpeaker` guard below means this screen only
 * ever dispatches as the real turn-holder — but they're mapped anyway (defensively, via the
 * `validation` fallback for `wrong_phase`) rather than rendering nothing on an unmapped code.
 */
function clueErrorCopy(code: EngineErrorCode): string {
  switch (code) {
    case 'clue_repeated':
      return copy.errors.clueRepeated;
    case 'clue_is_secret_word':
      return copy.errors.clueIsSecretWord;
    case 'not_your_turn':
      return copy.errors.notYourTurn;
    default:
      return copy.errors.validation;
  }
}

/**
 * Turn tracker for `clue` and `tiebreak_clue` (game-design.md §4.3 / §6.2). Spoken mode (the
 * P&P default) is turn-tracking only: `nextSpeaker()` records a skip marker under the hood,
 * but the clue board only ever renders in typed mode, so spoken games never surface it.
 */
export function PnpClueScreen() {
  const game = usePnpStore((state) => state.game);
  const prefs = usePnpStore((state) => state.prefs);
  const error = usePnpStore((state) => state.error);
  const nextSpeaker = usePnpStore((state) => state.nextSpeaker);
  const submitTypedClue = usePnpStore((state) => state.submitTypedClue);

  const [text, setText] = useState('');

  const speaker = game ? currentSpeaker(game) : null;

  if (!game || !speaker) {
    return null;
  }

  const isTiebreak = game.phase === 'tiebreak_clue';
  const statusHeading = isTiebreak
    ? copy.phases.status.tiebreaker
    : copy.phases.status.roundClues(game.round);
  const tiedNames = (game.tiedPlayerIds ?? [])
    .map((id) => game.players.find((p) => p.id === id)?.name ?? '')
    .join(' vs ');
  const spotlightLine = copy.pnp.clueTracker.line(speaker.name);
  // Mime special role (copy.md §3.2 "public toast"): P&P has no toast queue, so
  // this renders as a persistent inline banner for the whole round instead of a transient
  // pop — everyone's looking at the same screen anyway (game-design.md §4).
  const mime = game.mimeId ? game.players.find((p) => p.id === game.mimeId) : null;

  function handleTextChange(event: ChangeEvent<HTMLInputElement>): void {
    setText(event.target.value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    submitTypedClue(trimmed);
    // Zustand's `set` is synchronous, so the store already reflects this dispatch's outcome
    // by the time we read it back here — clearing the input only on a genuine accept.
    if (usePnpStore.getState().error === null) {
      setText('');
    }
  }

  return (
    <div
      data-testid="pnp-clue-screen"
      data-player-name={speaker.name}
      className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 bg-paper px-4 py-10 transition-colors duration-300"
    >
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
          {statusHeading}
        </p>
        {isTiebreak ? (
          <p
            data-testid="pnp-tiebreak-banner"
            className="font-display text-2xl uppercase tracking-wide text-undercover"
          >
            {copy.phases.tiebreak(tiedNames)}
          </p>
        ) : null}
        {mime ? (
          <p
            data-testid="pnp-mime-banner"
            className="rounded-lg border-3 border-ink bg-highlight px-3 py-1 font-ui text-sm font-bold text-ink shadow-hard-sm"
          >
            {copy.roles.special.mime.roundToast(mime.name)}
          </p>
        ) : null}
      </header>

      <PopCard className="mx-auto flex w-full max-w-md flex-col items-center gap-2 py-8 text-center">
        <p className="font-display text-2xl uppercase tracking-wide text-ink">{spotlightLine}</p>
      </PopCard>

      {!prefs.typedClues ? (
        <div className="mx-auto">
          <PopButton data-testid="pnp-next-player" size="lg" onClick={nextSpeaker}>
            {copy.pnp.clueTracker.next}
          </PopButton>
        </div>
      ) : (
        <>
          <HintBanner
            hintId="clueInput"
            headline={copy.hints.clueInput.headline}
            body={copy.hints.clueInput.body}
          />
          <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-md flex-col gap-3">
            <PopInput
              label={spotlightLine}
              placeholder={copy.phases.clue.placeholder}
              value={text}
              onChange={handleTextChange}
              maxLength={CLUE_MAX_LEN}
              data-testid="pnp-clue-input"
              autoComplete="off"
            />
            {error ? (
              <p
                data-testid="pnp-clue-error"
                role="alert"
                className="font-ui text-sm text-undercover"
              >
                {clueErrorCopy(error)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <PopButton type="submit" data-testid="pnp-pin-clue" disabled={!text.trim()}>
                {copy.phases.clue.button}
              </PopButton>
              <PopButton
                type="button"
                variant="secondary"
                data-testid="pnp-next-player"
                onClick={nextSpeaker}
              >
                {copy.pnp.clueTracker.next}
              </PopButton>
            </div>
          </form>
          <ClueBoard
            clues={game.clues}
            players={game.players.map((p) => ({ id: p.id, name: p.name }))}
          />
        </>
      )}
    </div>
  );
}
