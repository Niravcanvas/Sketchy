'use client';

import { ClueBoard } from '@/components/game/clue-board';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { usePnpStore } from '@/stores/pnp-store';

/**
 * Free-talk phase (game-design.md §4.4 / §6.3). P&P is untimed by design (pnp-store.ts's
 * pinned decision) — no timer ring, no "+60s", just the board and the host's call.
 */
export function PnpDiscussionScreen() {
  const game = usePnpStore((state) => state.game);
  const prefs = usePnpStore((state) => state.prefs);
  const callVote = usePnpStore((state) => state.callVote);

  if (!game) {
    return null;
  }

  return (
    <div
      data-testid="pnp-discussion-screen"
      className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 bg-phase-discuss px-4 py-10 transition-colors duration-300"
    >
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
          {copy.phases.status.discussion}
        </p>
        <p className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.phases.discussion.banner}
        </p>
      </header>

      {prefs.typedClues ? (
        <ClueBoard
          clues={game.clues}
          players={game.players.map((p) => ({ id: p.id, name: p.name }))}
        />
      ) : null}

      <PopButton data-testid="pnp-call-vote" size="lg" className="mx-auto" onClick={callVote}>
        {copy.phases.discussion.callTheVote}
      </PopButton>
    </div>
  );
}
