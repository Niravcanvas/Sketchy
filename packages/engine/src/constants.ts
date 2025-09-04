import type { SpecialRole } from './types.js';

/**
 * Engine-wide tuning constants (arch/game-design.md §6).
 * Kept as named constants (rather than inline literals) so reducers and tests share
 * one source of truth for timings/limits.
 */

/** Dealing-phase auto-ack timeout (game-design.md §6.1: "Timer (45s) auto-acks laggards"). */
export const DEAL_TIMEOUT_SEC = 45;

/** Reveal phase auto-advance when the host doesn't `continueReveal` (game-design.md §6.5). */
export const REVEAL_AUTO_ADVANCE_SEC = 8;

/** Mr. White's single-guess window (game-design.md §6.6). */
export const MRWHITE_GUESS_SEC = 30;

/** The host's once-per-phase timer extension, in milliseconds (game-design.md §6.3). */
export const TIMER_EXTEND_MS = 60_000;

/** Max clue length in characters (api-contract.md §2.1 `clue:submit`). */
export const CLUE_MAX_LEN = 40;

/** Marker clue text recorded for a skipped turn (api-contract.md §2.1 `turn:skip`). */
export const SKIPPED_CLUE = '(skipped)';

/** Absolute floor on player count — below this the game cannot start (research/01 §3). */
export const MIN_PLAYERS = 3;

/** Absolute ceiling on `settings.maxPlayers` (data-model.md §3). */
export const HARD_MAX_PLAYERS = 20;

/**
 * Special roles wave 1: the Jester's one-time consolation for being the very FIRST player
 * eliminated this game (copy.md §3.2 "they score +4 points for the drama"). No bonus for a
 * Jester eliminated later (`reducers/shared.ts` `applyJesterFirstOutBonus`).
 */
export const JESTER_FIRST_OUT_BONUS = 4;

/**
 * `judge_decision`'s own deadline (game-design.md §8 "never block on a ghost" — closing the
 * gap where an unreachable Judge stalled the game indefinitely). Always-timed regardless of
 * `settings.voteTimerSec`, same convention as `MRWHITE_GUESS_SEC` — a special-power decision
 * window isn't the ordinary discussion/vote clock. See `reducers/vote.ts`
 * `resolveJudgeDecisionByDefault`.
 */
export const JUDGE_DECISION_TIMEOUT_SEC = 30;

/**
 * Per-special-role minimum table size BEYOND the game's own `MIN_PLAYERS` floor — only
 * listed for roles that need MORE than the base minimum (research/03-SPECIAL-ROLES-
 * VARIANTS.md: Lovers/Revenger/Duelists need 5+ players; Judge/Ghost/Jester/Mirror/Mime have
 * no extra requirement, so they're simply absent from this map). Wave 1 (judge/ghost/jester)
 * never actually reads a non-`undefined` entry here; wave 2 is the first to populate the
 * ones that do apply. Checked by `isValidSpecialRoles` (`reducers/shared.ts`) —
 * packages/engine/ROLES.md documents the pattern.
 */
export const SPECIAL_ROLE_MIN_PLAYERS: Partial<Record<SpecialRole, number>> = {
  lovebirds: 5,
  grudge: 5,
  rivals: 5,
};

/**
 * `grudge_decision`'s own deadline (mirrors `JUDGE_DECISION_TIMEOUT_SEC` — game-design.md §8
 * "never block on a ghost"). Unlike the Judge, an unreachable Grudge defaults to dragging
 * NOBODY down rather than a forced random pick — see `reducers/cascade.ts`
 * `resolveGrudgeDecisionByDefault`.
 */
export const GRUDGE_DECISION_TIMEOUT_SEC = 30;

/**
 * Two players' worth of paired special roles (`lovebirds`, `rivals`) — the assignment
 * framework (`reducers/deal.ts` `assignSpecialRoles`) draws TWO distinct holders for a role
 * in this set instead of one. See `packages/engine/ROLES.md`.
 */
export const PAIRED_SPECIAL_ROLES: ReadonlySet<SpecialRole> = new Set(['lovebirds', 'rivals']);

/**
 * Room-wide special-role settings that never assign a `GamePlayer.specialRole` holder at
 * all — `'ghost'` (wave 1) plus `'mime'` (wave 2: a DIFFERENT random alive player each
 * round, which doesn't fit the single-holder-at-deal model; see ROLES.md's Mime section).
 * Consumes ZERO holder "slots" toward `isValidSpecialRoles`'s `floor(playerCount / 2)`
 * budget (`reducers/shared.ts`).
 */
export const ROOM_WIDE_SPECIAL_ROLES: ReadonlySet<SpecialRole> = new Set(['ghost', 'mime']);

/**
 * The Rivals special role's game-end scoring swing (copy.md §3.2 "first one eliminated
 * loses 2 points, the survivor gains 2"). Applied once, at game-over time, in
 * `reducers/cascade.ts` `applyRivalsScoring` — never mid-game, unlike the Jester's
 * immediate first-out bonus.
 */
export const RIVALS_POINT_DELTA = 2;
