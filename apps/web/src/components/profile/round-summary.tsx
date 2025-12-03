'use client';

import { useQuery } from '@tanstack/react-query';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

function roleTitle(role: BaseRole): string {
  if (role === 'civilian') return copy.roles.civilian.cardTitle;
  if (role === 'undercover') return copy.roles.undercover.cardTitle;
  return copy.roles.mrWhite.cardTitle;
}

function LoadingSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-24 w-full animate-pulse rounded-xl border-3 border-ink bg-paper-2"
    />
  );
}

/**
 * Expandable round-by-round summary, fetched on demand from
 * `GET /players/me/games/:gameId` — clues (public) + a redacted per-target vote tally.
 * **Ballots stay aggregate**: `voteTally` is counts-per-target only; the API never sends (and
 * this component never renders) who cast which vote — conventions.md §1's redaction rule
 * applies to history exactly as much as a live game.
 */
export function RoundSummary({ gameId }: { gameId: string }) {
  const query = useQuery({
    queryKey: ['playerGameSummary', gameId],
    queryFn: () => apiClient.getPlayerGameSummary(gameId),
    staleTime: 5 * 60_000,
  });

  if (query.isPending) {
    return <LoadingSkeleton />;
  }

  if (query.isError || !query.data) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 border-t-3 border-ink pt-4">
      {query.data.rounds.map((round) => (
        <div key={round.round} className="flex flex-col gap-2">
          <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink">
            {copy.profile.history.roundHeading(round.round)}
          </p>

          {round.clues.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-graphite">
                {copy.profile.history.cluesLabel}
              </p>
              <ul className="flex flex-col gap-0.5">
                {round.clues.map((clue, index) => (
                  <li key={`${clue.playerId}-${index}`} className="font-ui text-sm text-ink">
                    <span className="font-bold">{`${clue.playerName}:`}</span>{' '}
                    <span className="font-medium italic">{clue.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {round.voteTally.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-graphite">
                {copy.profile.history.votesLabel}
              </p>
              <ul className="flex flex-col gap-0.5">
                {round.voteTally.map((tally) => (
                  <li key={tally.playerId} className="font-ui text-sm text-ink">
                    {copy.profile.history.voteTally(tally.playerName, tally.votes)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {round.eliminated ? (
            <span className="w-fit rounded-lg bg-ink px-2 py-1 font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-white">
              {copy.reveal.outTag(roleTitle(round.eliminated.role))}
            </span>
          ) : (
            <p className="font-ui text-sm text-graphite">{copy.profile.history.noElimination}</p>
          )}
        </div>
      ))}
    </div>
  );
}
