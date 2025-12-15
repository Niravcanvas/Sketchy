'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { RedactedGamePlayer, RedactedGameState } from '@sketchy/engine/redact-for';
import { ClueBoard } from '@/components/game/clue-board';
import { HintBanner } from '@/components/hints/hint-banner';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitVoteCast } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

/** Alive players a ballot may target. During a sudden-death re-vote (`revoteCount === 1`)
 * the engine only accepts a ballot for one of the tied players (game-design.md §6.4), so the
 * grid narrows to them — the re-vote is "among tied players only". */
function suspectsFor(state: RedactedGameState): RedactedGamePlayer[] {
  const alive = state.players.filter((p) => p.alive);
  if (state.revoteCount === 1 && state.tiedPlayerIds) {
    const tied = new Set(state.tiedPlayerIds);
    return alive.filter((p) => tied.has(p.id));
  }
  return alive;
}

interface SuspectButtonProps {
  target: RedactedGamePlayer;
  isSelf: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

/** One suspect card. Self is disabled — color-independent (design-party-pop.md §2 contrast
 * note): it carries a `title` AND visible tooltip text, never a grayed-out look alone. */
function SuspectButton({ target, isSelf, isSelected, onSelect }: SuspectButtonProps) {
  return (
    <button
      type="button"
      data-testid="online-vote-target"
      data-name={target.name}
      disabled={isSelf}
      title={isSelf ? copy.phases.voting.selfVoteTooltip : undefined}
      onClick={onSelect}
      className={clsx(
        'rounded-xl border-3 border-ink px-4 py-6 font-ui text-lg font-bold text-ink shadow-hard-sm',
        'transition-[transform,box-shadow] duration-[80ms] ease-out',
        'hover:-translate-y-0.5',
        'active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
        'disabled:cursor-not-allowed disabled:border-graphite disabled:bg-paper-2 disabled:text-graphite disabled:shadow-none disabled:hover:translate-y-0',
        isSelected ? 'bg-highlight' : 'bg-paper-2',
      )}
    >
      <span className="block">{target.name}</span>
      {isSelf ? (
        <span className="mt-1 block font-ui text-xs font-medium text-graphite">
          {copy.phases.voting.selfVoteTooltip}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The online voting phase (game-design.md §6.4): a suspect grid of alive players, tap to
 * select → "Lock it in" casts the ballot (`vote:cast`), changeable until the vote closes.
 * The engine owns every tally/tie rule and closes the vote the instant the last eligible
 * ballot lands — this screen only collects the click. Others see the running "{k}/{n} voted"
 * count from the public `votedIds` (never who→whom, data-model.md §4). The countdown ring and
 * abstain-on-expiry are the server's (`StatusStrip` renders `phaseEndsAt`).
 *
 * Eliminated players (spectators, `!canAct.vote`) still watch the count and the clue board —
 * they just get no grid (game-design.md §9); their "you're out" banner lives in `GameScreen`.
 */
export function OnlineVoteScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [selected, setSelected] = useState<string | null>(you?.yourVote ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isCasting, setIsCasting] = useState(false);

  if (!snapshot || !you) {
    return null;
  }

  const heading =
    snapshot.revoteCount === 1 ? copy.phases.status.tiebreaker : copy.phases.status.theVote;
  const aliveCount = snapshot.players.filter((p) => p.alive).length;
  const progress = copy.phases.voting.progress(snapshot.votedIds.length, aliveCount);
  const canVote = you.canAct.vote;

  async function handleCast(): Promise<void> {
    if (!selected || isCasting) {
      return;
    }
    setIsCasting(true);
    setError(null);
    const ack = await emitVoteCast(selected);
    setIsCasting(false);
    if (!ack.ok) {
      setError(copyForError(ack.error));
    }
  }

  return (
    <div
      data-testid="online-vote-screen"
      className="flex w-full flex-col items-center gap-6 px-2 py-4 text-center"
    >
      <header className="flex flex-col items-center gap-2">
        <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
          {heading}
        </p>
        <p className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.phases.voting.banner}
        </p>
        <p data-testid="online-vote-progress" className="font-ui text-sm text-graphite">
          {progress}
        </p>
      </header>

      {canVote ? (
        <>
          <HintBanner
            hintId="voteGrid"
            headline={copy.hints.voteGrid.headline}
            body={copy.hints.voteGrid.body}
          />
          <div className="grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
            {suspectsFor(snapshot).map((target) => (
              <SuspectButton
                key={target.id}
                target={target}
                isSelf={target.id === you.playerId}
                isSelected={selected === target.id}
                onSelect={() => setSelected(target.id)}
              />
            ))}
          </div>
          <PopButton
            data-testid="online-vote-confirm"
            size="lg"
            className="mx-auto"
            disabled={selected === null || selected === you.yourVote || isCasting}
            onClick={() => {
              void handleCast();
            }}
          >
            {copy.phases.voting.lockItIn}
          </PopButton>
          {you.yourVote !== null ? (
            <p data-testid="online-ballot-cast" className="font-ui text-sm text-graphite">
              {copy.phases.voting.ballotCast}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="font-ui text-sm text-undercover">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      <ClueBoard clues={snapshot.clues} players={snapshot.players} />
    </div>
  );
}
