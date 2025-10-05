import { IconCrown } from '@/components/icons/icon-crown';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

export interface StandingsRow {
  id: string;
  name: string;
  points: number;
}

export interface StandingsPanelProps {
  /** Rows in any order — sorted descending by points internally, defensively, rather than
   * trusting the caller (same `state.scoreboard` the existing "Tonight's scoreboard" card
   * reads, api-contract.md / data-model.md §3 — accumulates across rematches,
   * `gamesPlayedInRoom` tracks how many). */
  rows: StandingsRow[];
}

/**
 * Between-games standings: rankings across this room's rematches +
 * a "tonight's MVP" callout for the current top scorer. Built entirely on
 * `GameState.scoreboard` — no new tracking, just a rank-ordered view of it (distinct from the
 * adjacent "Tonight's scoreboard" card, which shows this-game point deltas; this one shows
 * standing/rank and celebrates the leader).
 */
export function StandingsPanel({ rows }: StandingsPanelProps) {
  if (rows.length === 0) {
    return null;
  }
  const sortedRows = [...rows].sort((a, b) => b.points - a.points);
  const mvpId = sortedRows[0]?.id;

  return (
    <PopCard data-testid="standings-panel" className="flex w-full max-w-xl flex-col gap-3">
      <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.profile.standings.title}
      </h2>
      <ul className="flex flex-col divide-y divide-graphite/20">
        {sortedRows.map((row, index) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2">
              <span className="font-display text-sm text-graphite">{`#${index + 1}`}</span>
              <span className="font-ui text-[15px] font-bold text-ink">{row.name}</span>
              {row.id === mvpId ? (
                <span className="flex items-center gap-1 rounded-lg bg-highlight px-2 py-0.5">
                  <IconCrown className="h-3.5 w-3.5 text-ink" />
                  <span className="font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-ink">
                    {copy.profile.standings.mvpLabel}
                  </span>
                </span>
              ) : null}
            </span>
            <span className="font-display text-xl text-ink">{row.points}</span>
          </li>
        ))}
      </ul>
    </PopCard>
  );
}
