import clsx from 'clsx';
import type { RoleStats } from '@sketchy/shared/contract/players';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

/** Literal lookups (never template-interpolated) so Tailwind's content scan finds every
 * class — same pattern `win-screen.tsx`'s `FACTION_BG_CLASS` uses. */
const ROLE_FILL_CLASS: Record<BaseRole, string> = {
  civilian: 'bg-civilian',
  undercover: 'bg-undercover',
  mrwhite: 'bg-mrwhite',
};

function roleTitle(role: BaseRole): string {
  if (role === 'civilian') return copy.roles.civilian.cardTitle;
  if (role === 'undercover') return copy.roles.undercover.cardTitle;
  return copy.roles.mrWhite.cardTitle;
}

interface RoleBarProps {
  role: BaseRole;
  stats: RoleStats;
}

/** One win-rate bar: a solid ink-bordered track with a flat role-color fill (design-party-pop.md
 * — no chart library, no Rough.js; this is CSS, not SVG, and that's fine per the same "solid
 * ink-bordered shapes" instruction the sparkline follows in SVG). */
function RoleBar({ role, stats }: RoleBarProps) {
  const percent = stats.played > 0 ? Math.round((stats.won / stats.played) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-ui text-[15px] font-bold text-ink">{roleTitle(role)}</span>
        <span className="font-ui text-sm font-medium text-graphite">
          {stats.played > 0
            ? copy.profile.byRole.statLine(stats.won, stats.played)
            : copy.profile.byRole.neverPlayed}
        </span>
      </div>
      <div
        role="img"
        aria-label={
          stats.played > 0
            ? copy.profile.byRole.statLine(stats.won, stats.played)
            : copy.profile.byRole.neverPlayed
        }
        className="h-6 w-full overflow-hidden rounded-lg border-3 border-ink bg-paper-2"
      >
        <div
          className={clsx('h-full transition-[width] duration-300', ROLE_FILL_CLASS[role])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export interface RoleWinRateBarsProps {
  byRole: { civilian: RoleStats; undercover: RoleStats; mrwhite: RoleStats };
}

/** Per-role win-rate breakdown. */
export function RoleWinRateBars({ byRole }: RoleWinRateBarsProps) {
  return (
    <PopCard className="flex w-full flex-col gap-4">
      <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.profile.byRole.header}
      </h2>
      <RoleBar role="civilian" stats={byRole.civilian} />
      <RoleBar role="undercover" stats={byRole.undercover} />
      <RoleBar role="mrwhite" stats={byRole.mrwhite} />
    </PopCard>
  );
}
