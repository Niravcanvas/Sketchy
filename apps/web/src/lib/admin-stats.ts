import { getApiUrl } from './api-url';

/**
 * Server-only social-proof counter for the landing page (arch/copy.md §16.2 "Social
 * proof counter"). Calls the PUBLIC, unauthenticated `GET /v1/stats/games-today`
 * (api-contract.md §1 "Ops"; `packages/shared/src/contract/stats.ts`), which returns ONLY
 * `gamesToday` — a DAILY-resetting gauge over `games.started_at` (arch/data-model.md §1), NOT
 * a cumulative all-time count. There is no "games played, ever" endpoint in the contract;
 * adding one would be a new contract shape, out of scope here.
 *
 * RESOLVED (post-launch-backlog.md item 4): this used to call the admin-token-gated
 * `GET /v1/admin/stats` with `Authorization: Bearer ${ADMIN_TOKEN}`, coupling the public web
 * server to an ops-only bearer token. The dedicated public endpoint removes that coupling
 * entirely — this module no longer reads `process.env.ADMIN_TOKEN` (or any env var) and sends
 * no `Authorization` header at all. It still deliberately reads and returns ONLY `gamesToday`
 * — the public endpoint doesn't even expose `roomsActive`/`socketsConnected`/`actionsPerMin`,
 * so those operational gauges can't reach the client bundle even by accident.
 *
 * Caching: relies on Next's `fetch` cache via `next.revalidate` (60–300s;
 * 120s chosen as a middle ground — frequent enough to feel "live-ish", cheap
 * enough not to hammer the stats endpoint from every landing-page render).
 */
const REVALIDATE_SECONDS = 120;

interface GamesTodayResponse {
  gamesToday: number;
}

function isGamesTodayResponse(value: unknown): value is GamesTodayResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { gamesToday?: unknown }).gamesToday === 'number'
  );
}

/**
 * Returns today's started-game count, or `null` when the counter isn't available for
 * ANY reason (network/API down, non-2xx, malformed body). Callers must
 * degrade gracefully on `null` — render nothing, never a placeholder/fake number
 * (arch/copy.md §16.2).
 */
export async function getGamesToday(): Promise<number | null> {
  try {
    const response = await fetch(`${getApiUrl()}/stats/games-today`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (!isGamesTodayResponse(body)) return null;
    return body.gamesToday;
  } catch {
    return null;
  }
}
