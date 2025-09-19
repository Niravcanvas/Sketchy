/**
 * `GameEffect` — declarative instructions for the host environment (server or
 * pass-and-play client) that `applyAction` returns alongside the next
 * `GameState` (data-model.md §3). The engine never does I/O itself: it
 * describes *what* should happen (start a timer, clear a timer, persist the
 * game, reveal a role) and the host environment (Fastify + Redis, or the
 * browser) carries it out.
 *
 * Emission rules:
 * - `startTimer` is emitted whenever a reducer transitions into ANY timed phase
 *   (including re-arming the per-turn clue timer, and `extendTimer`).
 * - `clearTimer` is emitted when transitioning into an untimed phase from a
 *   timed one, or into `lobby` / `game_over`.
 * - `persistGame` is emitted exactly once, on entering `game_over`.
 * - `revealRole` is emitted with the just-eliminated player's id, on entering
 *   `reveal`.
 */
export type GameEffect =
  | { type: 'startTimer'; endsAt: number }
  | { type: 'clearTimer' }
  | { type: 'persistGame' }
  | { type: 'revealRole'; playerId: string };
