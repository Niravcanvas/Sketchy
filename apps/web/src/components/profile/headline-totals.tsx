import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

interface StatChipProps {
  label: string;
  value: number;
}

function StatChip({ label, value }: StatChipProps) {
  return (
    <PopCard className="flex flex-1 flex-col items-center gap-1 py-4 text-center">
      <span className="font-display text-3xl text-ink">{value}</span>
      <span className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
        {label}
      </span>
    </PopCard>
  );
}

export interface HeadlineTotalsProps {
  totalPoints: number;
  gamesPlayed: number;
  gamesWon: number;
}

/** Three headline stat chips — `players.total_points/games_played/
 * games_won` verbatim from `GET /players/me/stats` (no client-side math). */
export function HeadlineTotals({ totalPoints, gamesPlayed, gamesWon }: HeadlineTotalsProps) {
  return (
    <div className="flex w-full gap-3">
      <StatChip label={copy.profile.headline.scrapbookTotal} value={totalPoints} />
      <StatChip label={copy.profile.headline.gamesPlayed} value={gamesPlayed} />
      <StatChip label={copy.profile.headline.gamesWon} value={gamesWon} />
    </div>
  );
}
