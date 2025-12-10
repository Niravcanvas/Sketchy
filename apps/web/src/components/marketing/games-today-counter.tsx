import { getGamesToday } from '@/lib/admin-stats';
import { copy } from '@/copy';

/**
 * Below this, a "tables started today" count reads worse than showing nothing: a visibly
 * tiny number (realistic on a quiet day) undercuts the very social proof it's meant to
 * provide. The gate lives here (presentation), not in `admin-stats`, so that module stays
 * purely about whether the count is AVAILABLE — an unavailable count still comes back as
 * `null` and renders nothing, and this simply extends the same "render nothing" outcome to
 * "available but too small to help."
 */
const MIN_GAMES_TO_SHOW = 10;

/**
 * Landing page social-proof stat (arch/copy.md §16.2). An async
 * Server Component — the `GET /v1/stats/games-today` fetch (`getGamesToday`) happens
 * entirely server-side and is cached via Next's `fetch` revalidation (see lib/admin-stats.ts).
 *
 * Degrades to rendering NOTHING (not a placeholder, not a zero, not an error message)
 * when the count isn't available — API down or a failed fetch both look identical from
 * here: no section at all — OR when it's below `MIN_GAMES_TO_SHOW`. `getGamesToday` only
 * ever exposes `gamesToday`; the public endpoint it calls doesn't even return the
 * admin-only operational gauges (`roomsActive`/`socketsConnected`/`actionsPerMin`).
 */
export async function GamesTodayCounter() {
  const gamesToday = await getGamesToday();
  if (gamesToday === null || gamesToday < MIN_GAMES_TO_SHOW) return null;

  return (
    <div className="inline-flex -rotate-1 items-center gap-4 rounded-2xl border-3 border-ink bg-highlight px-6 py-4 shadow-hard">
      <p className="font-display text-4xl uppercase tabular-nums text-ink">{gamesToday}</p>
      <div className="flex flex-col">
        <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink">
          {copy.marketing.landing.socialProof.caption}
        </p>
        <p className="font-ui text-sm font-medium text-ink">
          {copy.marketing.landing.socialProof.supporting}
        </p>
      </div>
    </div>
  );
}
