'use client';

import { useState } from 'react';
import { ClueBoard } from '@/components/game/clue-board';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitPhaseAdvance } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

/**
 * The discussion phase (game-design.md §6.3): banner + the clue board front-and-center for
 * the call/table argument, no structured actions besides the host's early-advance. The
 * countdown itself, and the `+60s` extend chip, live in `StatusStrip` — this screen shows
 * only the "Call the vote" CTA so the two aren't duplicated.
 */
export function DiscussionScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [error, setError] = useState<string | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);

  if (!snapshot) {
    return null;
  }

  async function handleCallVote(): Promise<void> {
    setIsAdvancing(true);
    setError(null);
    const ack = await emitPhaseAdvance();
    setIsAdvancing(false);
    if (!ack.ok) {
      setError(copyForError(ack.error));
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
      <p className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.phases.discussion.banner}
      </p>

      {you?.canAct.advancePhase ? (
        <PopButton
          type="button"
          variant="primary"
          size="lg"
          data-testid="online-call-vote"
          disabled={isAdvancing}
          onClick={() => {
            void handleCallVote();
          }}
        >
          {copy.phases.discussion.callTheVote}
        </PopButton>
      ) : null}

      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}

      <ClueBoard clues={snapshot.clues} players={snapshot.players} />
    </div>
  );
}
