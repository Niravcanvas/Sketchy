'use client';

import clsx from 'clsx';
import type { GamePlayer } from '@sketchy/engine/types';
import { HintBanner } from '@/components/hints/hint-banner';
import { PassInterstitial } from '@/components/pnp/pass-interstitial';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { aliveTargets, currentVoter, eligibleVoters, usePnpStore } from '@/stores/pnp-store';

interface VoteHeaderProps {
  heading: string;
  progress: string;
}

/** Shared strip atop every vote-screen state except the secret-mode pass interstitial, which
 * is its own full-screen privacy gate (game-design.md pillar 2) with nothing else on it. */
function VoteHeader({ heading, progress }: VoteHeaderProps) {
  return (
    <header className="flex flex-col items-center gap-2 text-center">
      <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
        {heading}
      </p>
      <p className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.phases.voting.banner}
      </p>
      <p data-testid="pnp-vote-progress" className="font-ui text-sm text-graphite">
        {progress}
      </p>
    </header>
  );
}

interface SuspectButtonProps {
  target: GamePlayer;
  isSelf: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

/** One suspect card in the secret-ballot grid. Self is disabled — color-independent
 * (conventions.md §2/§4: never signal state by color alone), so it carries both a `title`
 * and visible text, not just a grayed-out look. */
function SuspectButton({ target, isSelf, isSelected, onSelect }: SuspectButtonProps) {
  return (
    <button
      type="button"
      data-testid="pnp-vote-target"
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
 * Ballot UI only (game-design.md §6.4 / §4.4) — the engine owns the tally, this screen just
 * collects clicks. Secret mode reuses the deal ritual's `PassInterstitial` for the handoff;
 * open mode is one shared screen the whole table watches and points at.
 */
export function PnpVoteScreen() {
  const game = usePnpStore((state) => state.game);
  const prefs = usePnpStore((state) => state.prefs);
  const ballot = usePnpStore((state) => state.ballot);
  const confirmVotePass = usePnpStore((state) => state.confirmVotePass);
  const selectTarget = usePnpStore((state) => state.selectTarget);
  const castBallot = usePnpStore((state) => state.castBallot);
  const castOpenVote = usePnpStore((state) => state.castOpenVote);

  // The engine auto-closes the vote (and moves the phase on) the instant the last ballot
  // lands — this screen must never assume it survives that dispatch.
  if (!game || game.phase !== 'voting') {
    return null;
  }

  const heading =
    game.revoteCount === 1 ? copy.phases.status.tiebreaker : copy.phases.status.theVote;
  const voters = eligibleVoters(game);
  const progress = copy.phases.voting.progress(Object.keys(game.votes).length, voters.length);
  const targets = aliveTargets(game);

  if (!prefs.openVote) {
    const voter = currentVoter(game);
    if (!voter) {
      return null;
    }

    if (!ballot.confirmed) {
      return (
        <PassInterstitial
          title={copy.pnp.voteHandoff(voter.name)}
          confirmLabel={copy.pnp.passInterstitial.confirm}
          onConfirm={confirmVotePass}
          testId="pnp-vote-interstitial"
          playerName={voter.name}
        />
      );
    }

    return (
      <div
        data-testid="pnp-vote-screen"
        className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 bg-phase-vote px-4 py-10 transition-colors duration-300"
      >
        <VoteHeader heading={heading} progress={progress} />
        <HintBanner
          hintId="voteGrid"
          headline={copy.hints.voteGrid.headline}
          body={copy.hints.voteGrid.body}
        />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {targets.map((target) => (
            <SuspectButton
              key={target.id}
              target={target}
              isSelf={target.id === voter.id}
              isSelected={ballot.selectedTarget === target.id}
              onSelect={() => selectTarget(target.id)}
            />
          ))}
        </div>
        <PopButton
          data-testid="pnp-vote-confirm"
          size="lg"
          className="mx-auto"
          disabled={!ballot.selectedTarget}
          onClick={castBallot}
        >
          {copy.phases.voting.lockItIn}
        </PopButton>
      </div>
    );
  }

  return (
    <div
      data-testid="pnp-vote-screen"
      className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 bg-phase-vote px-4 py-10 transition-colors duration-300"
    >
      <VoteHeader heading={heading} progress={progress} />
      <HintBanner
        hintId="voteGrid"
        headline={copy.hints.voteGrid.headline}
        body={copy.hints.voteGrid.body}
      />
      <p className="text-center font-ui text-sm text-graphite">{copy.pnp.openVote.instruction}</p>
      <div className="flex flex-col gap-4">
        {voters.map((voter) => {
          const recorded = game.votes[voter.id];
          const rowTargets = targets.filter((target) => target.id !== voter.id);
          return (
            <div
              key={voter.id}
              data-testid="pnp-open-vote-row"
              data-voter={voter.name}
              className="flex flex-wrap items-center gap-3 border-b border-graphite/20 pb-3"
            >
              <span className="w-28 shrink-0 font-ui text-[15px] font-bold text-ink">{voter.name}</span>
              <div className="flex flex-wrap gap-2">
                {rowTargets.map((target) => {
                  const isSelected = recorded === target.id;
                  return (
                    <button
                      key={target.id}
                      type="button"
                      data-testid="pnp-open-vote-target"
                      data-voter={voter.name}
                      data-target={target.name}
                      onClick={() => castOpenVote(voter.id, target.id)}
                      className={clsx(
                        'rounded-lg border-3 border-ink px-3 py-1 font-ui text-sm font-bold shadow-hard-sm',
                        'transition-[transform,box-shadow] duration-[80ms] ease-out',
                        'active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
                        isSelected ? 'bg-highlight text-ink' : 'bg-paper-2 text-graphite',
                      )}
                    >
                      {target.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
