import type { ApplyResult, EngineErrorCode } from '../apply-action.js';
import {
  HARD_MAX_PLAYERS,
  JESTER_FIRST_OUT_BONUS,
  MIN_PLAYERS,
  PAIRED_SPECIAL_ROLES,
  ROOM_WIDE_SPECIAL_ROLES,
  SPECIAL_ROLE_MIN_PLAYERS,
} from '../constants.js';
import type { GameEffect } from '../effects.js';
import type { GamePlayer, GameSettings, GameState, SpecialRole } from '../types.js';

/** Rejects an action: state is returned BY REFERENCE, unchanged, with no effects. Reducers
 * never throw and never mutate — this is the one shape every rejection takes. */
export function reject(state: GameState, error: EngineErrorCode): ApplyResult {
  return { state, effects: [], error };
}

/** Accepts an action, producing the next state and whatever effects fall out of it. */
export function ok(state: GameState, effects: GameEffect[] = []): ApplyResult {
  return { state, effects };
}

export function findPlayer(state: GameState, playerId: string): GamePlayer | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function isHost(state: GameState, playerId: string): boolean {
  return state.hostId === playerId;
}

/**
 * Players currently alive, in seat order. Relies on the standing invariant that
 * `state.players` is always maintained in ascending-seat order (lobby join/leave/kick all
 * preserve it, and deal/rematch rebuild it from a seat-sorted list) — so a plain filter,
 * not a re-sort, is sufficient here.
 */
export function aliveInSeatOrder(state: GameState): GamePlayer[] {
  return state.players.filter((p) => p.alive);
}

/**
 * Turn order for whichever clue-giving phase `state` is currently in: alive players in
 * seat order for `clue`, or — during `tiebreak_clue` — just the tied players, in seat
 * order (data-model.md §4: `turnSeat` indexes into THIS list).
 */
export function currentTurnOrder(state: GameState): GamePlayer[] {
  if (state.phase === 'tiebreak_clue' && state.tiedPlayerIds) {
    const tied = new Set(state.tiedPlayerIds);
    return state.players.filter((p) => tied.has(p.id));
  }
  return aliveInSeatOrder(state);
}

/**
 * Every phase transition emits exactly one timer effect: `startTimer` for a concrete
 * deadline, `clearTimer` for an untimed phase (effects.ts emission rules).
 */
export function timerEffects(phaseEndsAt: number | null): GameEffect[] {
  return phaseEndsAt === null
    ? [{ type: 'clearTimer' }]
    : [{ type: 'startTimer', endsAt: phaseEndsAt }];
}

/** Case/whitespace-insensitive comparison key, used for names, clues, and secret words. */
export function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Role-math bound shared by `start` (against the actual seated count) and `rematch`
 * (against the post-departure seated count): at least one minority-role player, and
 * strictly fewer than half the table, so Civilians always have a majority (game-design.md
 * §7 / research/01 §3).
 */
export function isValidRoleMath(
  undercoverCount: number,
  mrWhiteCount: number,
  playerCount: number,
): boolean {
  const total = undercoverCount + mrWhiteCount;
  return total >= 1 && total < Math.ceil(playerCount / 2);
}

/**
 * How many holder "slots" one enabled special role consumes toward
 * `isValidSpecialRoles`'s total-budget check below. Room-wide settings (`ghost`, `mime`)
 * never assign a holder at all (0); paired roles (`lovebirds`, `rivals`) draw TWO distinct
 * holders (2); every other single-holder role draws exactly one (1).
 */
function specialRoleSlotCount(role: SpecialRole): number {
  if (ROOM_WIDE_SPECIAL_ROLES.has(role)) return 0;
  if (PAIRED_SPECIAL_ROLES.has(role)) return 2;
  return 1;
}

/**
 * Per-role minimum table size (`SPECIAL_ROLE_MIN_PLAYERS`, constants.ts) — a
 * role absent from that map (wave 1's judge/ghost/jester; wave 2's mirror/mime) has no
 * requirement beyond the game's own `MIN_PLAYERS` floor, already checked elsewhere. PLUS a
 * total-holder-slot budget — the sum of every enabled
 * role's `specialRoleSlotCount` must not exceed `floor(playerCount / 2)`, keeping games
 * legible by capping how much of the table can be "spicy" at once. A paired role
 * (Lovebirds/Rivals) counts as TWO slots since it consumes two seats' worth of holders;
 * room-wide settings (Ghost/Mime) count as zero since they never occupy a seat. Shared by
 * `isValidSettingsForLobby` (against `maxPlayers`, lobby time) and the `start`/`rematch`
 * re-validation (against the actual seated count), mirroring `isValidRoleMath`'s own two
 * call sites.
 */
export function isValidSpecialRoles(specialRoles: SpecialRole[], playerCount: number): boolean {
  const perRoleOk = specialRoles.every((role) => {
    const min = SPECIAL_ROLE_MIN_PLAYERS[role];
    return min === undefined || playerCount >= min;
  });
  if (!perRoleOk) return false;

  const totalSlots = specialRoles.reduce((sum, role) => sum + specialRoleSlotCount(role), 0);
  return totalSlots <= Math.floor(playerCount / 2);
}

/**
 * Resolves the OTHER holder of a paired special role (`lovebirds`, `rivals`) for
 * a given player, or `undefined` if `playerId` doesn't hold `role`, or no partner exists
 * (shouldn't happen given the assignment framework always draws both together, but never
 * throws). At most one pair of a given paired role can exist per game (`assignSpecialRoles`
 * draws each enabled role's holders exactly once), so "the other player holding this role"
 * is an unambiguous, minimal way to derive the link — no separate partner-id field is
 * stored on `GamePlayer` (see arch/data-model.md's wave 2 special-roles notes). Used by
 * `reducers/cascade.ts` (Lovebirds chained elimination) and by the host environment
 * (`apps/api/src/rooms/snapshot.ts` `buildYouSlice`) to resolve a player's OWN partner for
 * their private `you` slice — the partner's NAME is public info (`GamePlayer.name` is never
 * redacted); only WHO is linked to whom is secret, so exposing just the id is sufficient
 * and never leaks anything `redactFor` wouldn't already allow the two of them to know.
 */
export function pairedPartnerId(
  players: GamePlayer[],
  playerId: string,
  role: SpecialRole,
): string | null {
  const self = players.find((p) => p.id === playerId);
  if (!self || self.specialRole !== role) return null;
  const partner = players.find((p) => p.id !== playerId && p.specialRole === role);
  return partner?.id ?? null;
}

/**
 * The OTHER Lovebirds holder for `playerId`, restricted to one who is still
 * ALIVE (i.e. eligible to cascade) — `undefined` if `playerId` isn't a Lovebird, has no
 * partner, or their partner already fell earlier in the same chain. This ALIVE filter is
 * what keeps the cascade bounded: a player already marked eliminated can never be queued a
 * second time (`reducers/cascade.ts`).
 */
export function aliveLovebirdsPartner(
  players: GamePlayer[],
  playerId: string,
): GamePlayer | undefined {
  const self = players.find((p) => p.id === playerId);
  if (!self || self.specialRole !== 'lovebirds') return undefined;
  return players.find((p) => p.id !== playerId && p.specialRole === 'lovebirds' && p.alive);
}

/**
 * Lobby settings validation for `updateSettings`: bounds are checked against `maxPlayers`
 * (the room's CAPACITY), not the current seated count — `start` re-validates role math
 * against the actual count separately.
 */
export function isValidSettingsForLobby(settings: GameSettings, playerCount: number): boolean {
  if (settings.maxPlayers < MIN_PLAYERS || settings.maxPlayers > HARD_MAX_PLAYERS) return false;
  if (settings.maxPlayers < playerCount) return false;
  if (settings.undercoverCount < 0 || settings.mrWhiteCount < 0) return false;
  if (settings.clueTimerSec !== null && settings.clueTimerSec <= 0) return false;
  if (settings.discussionTimerSec !== null && settings.discussionTimerSec <= 0) return false;
  if (settings.voteTimerSec !== null && settings.voteTimerSec <= 0) return false;
  if (settings.difficulties.length === 0) return false;
  if (!isValidSpecialRoles(settings.specialRoles, settings.maxPlayers)) return false;
  return isValidRoleMath(settings.undercoverCount, settings.mrWhiteCount, settings.maxPlayers);
}

/**
 * The Jester's +4 first-out consolation (copy.md §3.2), awarded IMMEDIATELY at
 * the moment of elimination — not deferred to game-over scoring, since it's independent of
 * who wins. `preEliminationPlayers` MUST be the player list from BEFORE `eliminatedId` is
 * marked `alive:false` (the "first elimination" check reads every OTHER player's
 * `eliminatedRound`, which only this ordering makes correct). No bonus for a Jester
 * eliminated later in the game. Shared by `closeVote`'s clean-plurality branch and
 * `applyJudgeDecide` — the two places a vote/tie ever resolves to an elimination.
 */
export function applyJesterFirstOutBonus(
  preEliminationPlayers: GamePlayer[],
  scoreboard: Record<string, number>,
  eliminatedId: string,
): Record<string, number> {
  const isFirstElimination = preEliminationPlayers.every(
    (p) => p.id === eliminatedId || p.eliminatedRound === null,
  );
  const eliminatedPlayer = preEliminationPlayers.find((p) => p.id === eliminatedId);
  if (!isFirstElimination || eliminatedPlayer?.specialRole !== 'jester') {
    return scoreboard;
  }
  return {
    ...scoreboard,
    [eliminatedId]: (scoreboard[eliminatedId] ?? 0) + JESTER_FIRST_OUT_BONUS,
  };
}

/**
 * Removes a player and compacts remaining seats to stay contiguous/ordered (shared by
 * lobby `leave` and `kick`). Re-derives `hostId` if the removed player was host — the
 * first remaining player (by seat) inherits it; an empty room yields `''` (the host
 * environment is expected to tear the room down at that point).
 */
export function removeAndCompactSeats(state: GameState, targetId: string): GameState {
  const remaining = state.players
    .filter((p) => p.id !== targetId)
    .map((p, seat) => ({ ...p, seat }));
  const hostId = state.hostId === targetId ? (remaining[0]?.id ?? '') : state.hostId;
  return { ...state, players: remaining, hostId };
}
