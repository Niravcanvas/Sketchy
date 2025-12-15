'use client';

import { useState, type FormEvent } from 'react';
import type { RedactedGamePlayer, RedactedGameState } from '@sketchy/engine/redact-for';
import { ClueBoard } from '@/components/game/clue-board';
import { HintBanner } from '@/components/hints/hint-banner';
import { PopButton } from '@/components/pop/pop-button';
import { PopDialog } from '@/components/pop/pop-dialog';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitClueSubmit, emitTurnSkip } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

/** api-contract.md §2.1 `clue:submit` — 1-40 chars after trim (mirrors
 * `@sketchy/engine/constants`' `CLUE_MAX_LEN`, restated here rather than imported since it's
 * a wire-payload bound the input itself enforces, not an engine computation). */
const CLUE_MAX_LEN = 40;

/**
 * Turn order for whichever clue-giving phase `state` is in, re-derived client-side from the
 * redacted snapshot. This deliberately duplicates (rather than imports)
 * `packages/engine/src/reducers/shared.ts`'s `currentTurnOrder`: that helper types on the
 * SERVER's `GameState`, and `RedactedGameState` doesn't structurally satisfy it (e.g.
 * `pair` is nullable here, required there) — so re-deriving the same small filter locally is
 * simpler and safer than forcing an unsound cast. `turnSeat` indexes into this exact list:
 * alive players in seat order for `clue`, or just the tied players (seat order) during
 * `tiebreak_clue` (data-model.md "Phase 2 engine extensions").
 */
function turnOrderFor(state: RedactedGameState): RedactedGamePlayer[] {
  if (state.phase === 'tiebreak_clue' && state.tiedPlayerIds) {
    const tied = new Set(state.tiedPlayerIds);
    return state.players.filter((p) => tied.has(p.id));
  }
  return state.players.filter((p) => p.alive);
}

function currentSpeaker(state: RedactedGameState): RedactedGamePlayer | null {
  if (state.turnSeat === null) {
    return null;
  }
  return turnOrderFor(state)[state.turnSeat] ?? null;
}

/**
 * The clue phase (game-design.md §6.2, reused for `tiebreak_clue`'s sudden-death round):
 * the turn-holder gets the input, everyone else sees "✏️ {name} is thinking…", and the host
 * can skip a stalled turn. `ClueBoard` (components/game/clue-board.tsx) renders the append-
 * only log underneath, unmodified — it's already shared+presentational.
 */
export function ClueScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);

  if (!snapshot || !you) {
    return null;
  }

  const speaker = currentSpeaker(snapshot);
  const isHost = snapshot.hostId === you.playerId;
  const canSkip = isHost && speaker !== null && speaker.id !== you.playerId;

  // Sudden-death tiebreak (game-design.md §6.4): the tied players each give one more clue,
  // then a re-vote among just them. This banner names them; their turns already highlight in
  // the player strip (its `currentSpeakerId` walks `tiedPlayerIds` during `tiebreak_clue`).
  const tiedNames =
    snapshot.phase === 'tiebreak_clue' && snapshot.tiedPlayerIds
      ? snapshot.players
          .filter((p) => snapshot.tiedPlayerIds?.includes(p.id))
          .map((p) => p.name)
          .join(', ')
      : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const ack = await emitClueSubmit(trimmed);
    setIsSubmitting(false);
    if (ack.ok) {
      setText('');
    } else {
      setError(copyForError(ack.error));
    }
  }

  async function handleSkip(): Promise<void> {
    setIsSkipping(true);
    const ack = await emitTurnSkip();
    setIsSkipping(false);
    setSkipConfirmOpen(false);
    if (!ack.ok) {
      setError(copyForError(ack.error));
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
      {tiedNames ? (
        <p
          data-testid="online-tiebreak-banner"
          className="max-w-md rounded-xl border-3 border-ink bg-highlight px-4 py-2 font-ui text-sm font-medium text-ink shadow-hard-sm"
        >
          {copy.phases.tiebreak(tiedNames)}
        </p>
      ) : null}
      {you.canAct.submitClue ? (
        <form
          className="flex w-full max-w-md flex-col items-center gap-3"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <HintBanner
            hintId="clueInput"
            headline={copy.hints.clueInput.headline}
            body={copy.hints.clueInput.body}
          />
          <p className="font-display text-2xl uppercase tracking-wide text-ink">
            {copy.phases.clue.yourTurn}
          </p>
          <PopInput
            label={copy.phases.clue.placeholder}
            placeholder={copy.phases.clue.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={CLUE_MAX_LEN}
            data-testid="online-clue-input"
          />
          <PopButton
            type="submit"
            variant="primary"
            size="lg"
            data-testid="online-pin-clue"
            disabled={isSubmitting || text.trim().length === 0}
          >
            {copy.phases.clue.button}
          </PopButton>
        </form>
      ) : speaker ? (
        <p
          className="font-display text-2xl uppercase tracking-wide text-ink"
          data-testid="online-thinking"
          data-player-name={speaker.name}
        >
          {copy.phases.clue.thinking(speaker.name)}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover" data-testid="online-clue-error">
          {error}
        </p>
      ) : null}

      {canSkip ? (
        <PopButton
          type="button"
          variant="secondary"
          data-testid="online-skip-turn"
          onClick={() => setSkipConfirmOpen(true)}
        >
          {copy.phases.clue.skipButton}
        </PopButton>
      ) : null}

      <PopDialog
        open={skipConfirmOpen}
        onOpenChange={setSkipConfirmOpen}
        title={speaker ? copy.phases.clue.skipConfirm(speaker.name) : copy.phases.clue.skipButton}
        closeLabel={copy.glossary.cancel}
      >
        <div className="flex justify-end gap-3">
          <PopButton
            type="button"
            variant="secondary"
            data-testid="online-skip-cancel"
            onClick={() => setSkipConfirmOpen(false)}
          >
            {copy.glossary.cancel}
          </PopButton>
          <PopButton
            type="button"
            variant="primary"
            disabled={isSkipping}
            data-testid="online-skip-confirm"
            onClick={() => {
              void handleSkip();
            }}
          >
            {copy.phases.clue.skipButton}
          </PopButton>
        </div>
      </PopDialog>

      <ClueBoard clues={snapshot.clues} players={snapshot.players} />
    </div>
  );
}
