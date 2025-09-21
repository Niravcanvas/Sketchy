import type { AckWordAction, DealtPair, StartAction } from '../actions.js';
import type { ApplyResult } from '../apply-action.js';
import { DEAL_TIMEOUT_SEC, MIN_PLAYERS, PAIRED_SPECIAL_ROLES } from '../constants.js';
import type { Rng } from '../rng.js';
import { createRng } from '../rng.js';
import type { GamePlayer, GameSettings, GameState, SpecialRole } from '../types.js';
import { enterNextClueRound } from './clue.js';
import {
  findPlayer,
  isHost,
  isValidRoleMath,
  isValidSpecialRoles,
  ok,
  reject,
  timerEffects,
} from './shared.js';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

/**
 * Deterministic assignment order for special roles that get one or more random holders
 * (packages/engine/ROLES.md "the assignment framework"). Room-wide settings are
 * deliberately EXCLUDED — `'ghost'` (wave 1) and `'mime'` (wave 2: a DIFFERENT random
 * alive player EACH ROUND, computed by `reducers/clue.ts` `enterNextClueRound` instead —
 * see ROLES.md's Mime section for why it doesn't fit this single-holder-at-deal model).
 * `'lovebirds'` and `'rivals'` (wave 2) draw TWO distinct holders each — see
 * `PAIRED_SPECIAL_ROLES` (constants.ts) and `assignSpecialRoles` below. Order only matters
 * for determinism given a seed.
 */
const ASSIGNABLE_SPECIAL_ROLES: SpecialRole[] = [
  'judge',
  'jester',
  'lovebirds',
  'grudge',
  'mirror',
  'rivals',
];

/**
 * Per-role eligibility filter for `assignSpecialRoles` below — wave 1's Judge and Jester,
 * and all of wave 2's assignable roles, have no eligibility constraint beyond "not already
 * holding a different special role" (enforced by the caller passing only unassigned
 * candidates). A future role with a real constraint adds its own branch here.
 */
function eligibleForSpecialRole(_role: SpecialRole, candidates: GamePlayer[]): GamePlayer[] {
  return candidates;
}

/**
 * Draws `count` DISTINCT random players from `pool` without replacement (Fisher-Yates-style
 * incremental draw, not a full shuffle — `count` is always 1 or 2 here). Returns fewer than
 * `count` if `pool` runs out (caller decides whether that's acceptable).
 */
function drawDistinct(pool: GamePlayer[], count: number, rng: Rng): GamePlayer[] {
  let remaining = pool;
  const picks: GamePlayer[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const idx = rng.int(remaining.length);
    const pick = remaining[idx] as GamePlayer;
    picks.push(pick);
    remaining = remaining.filter((p) => p.id !== pick.id);
  }
  return picks;
}

/**
 * Assigns each ENABLED role in `settings.specialRoles` (except the room-wide settings, see
 * `ASSIGNABLE_SPECIAL_ROLES` above) to one random eligible player — AT MOST one special
 * role per player (data-model.md §4). A role in `PAIRED_SPECIAL_ROLES` (Lovebirds, Rivals)
 * draws TWO distinct holders instead of one — the pair link itself is never stored (`reducers/shared.ts` `pairedPartnerId` derives "the
 * other player holding this role" on demand; at most one pair per paired role can exist per
 * game, since each is only ever assigned once here). Draws from the SAME per-deal `Rng` the
 * base role shuffle already used, so determinism only depends on `state.seed` +
 * `state.gamesPlayedInRoom`, same as every other deal-time draw. Assumes every
 * `p.specialRole` in `players` is already `null` (the caller, `dealRoles`, resets it as
 * part of its own per-deal reset) — silently skips (or under-assigns) a role if there
 * aren't enough eligible players left (shouldn't happen given `isValidSpecialRoles`'s
 * budget check, but never throws).
 */
function assignSpecialRoles(settings: GameSettings, players: GamePlayer[], rng: Rng): GamePlayer[] {
  let result = players;
  const enabled = new Set(settings.specialRoles);

  for (const role of ASSIGNABLE_SPECIAL_ROLES) {
    if (!enabled.has(role)) continue;
    const unassigned = result.filter((p) => p.specialRole === null);
    const eligible = eligibleForSpecialRole(role, unassigned);
    const count = PAIRED_SPECIAL_ROLES.has(role) ? 2 : 1;
    const picks = drawDistinct(eligible, count, rng);
    if (picks.length < count) continue; // not enough eligible players — skip this role entirely
    const pickIds = new Set(picks.map((p) => p.id));
    result = result.map((p) => (pickIds.has(p.id) ? { ...p, specialRole: role } : p));
  }
  return result;
}

/**
 * Deals roles + words onto `playersInSeatOrder` (must already be seat-sorted). Shared by
 * `start` and `rematch` — both hand the engine a freshly-drawn `pair` and expect the same
 * deal logic. Pure given `rng`: the caller derives a fresh, unstored PRNG per deal
 * (`createRng(`${seed}:deal:${gamesPlayedInRoom}`)`, game-design.md RNG decisions) so
 * determinism only depends on `state.seed` + `state.gamesPlayedInRoom`, never on any
 * stored generator state.
 */
export function dealRoles(
  settings: GameSettings,
  playersInSeatOrder: GamePlayer[],
  pair: DealtPair,
  rng: Rng,
): {
  players: GamePlayer[];
  pair: { civilianWord: string; undercoverWord: string; pairId: string | null };
} {
  // The engine — not the pack/host environment — decides which side is the Civilian word,
  // so authoring order can never leak ("first word is always Civilian") — data-model.md §1.
  const civilianWord = rng.bool() ? pair.wordA : pair.wordB;
  const undercoverWord = civilianWord === pair.wordA ? pair.wordB : pair.wordA;

  const n = playersInSeatOrder.length;
  const roles: BaseRole[] = [];
  for (let i = 0; i < settings.undercoverCount; i++) roles.push('undercover');
  for (let i = 0; i < settings.mrWhiteCount; i++) roles.push('mrwhite');
  while (roles.length < n) roles.push('civilian');

  const shuffled = rng.shuffle(roles);

  // mrWhiteFirstClueBan (game-design.md §6.1): seat 0 never opens the first clue round as
  // Mr. White. A single PRNG draw picks which OTHER non-Mr.-White seat to swap with —
  // deliberately not a re-roll loop (that would bias the distribution among retries).
  if (settings.mrWhiteFirstClueBan && shuffled[0] === 'mrwhite') {
    const swappable: number[] = [];
    for (let i = 1; i < shuffled.length; i++) {
      if (shuffled[i] !== 'mrwhite') swappable.push(i);
    }
    // Guaranteed non-empty: callers only reach dealRoles with valid role math
    // (undercoverCount + mrWhiteCount < ceil(n/2)), so at least one civilian/other seat
    // exists to swap with whenever seat 0 drew Mr. White.
    const pickAt = swappable[rng.int(swappable.length)] as number;
    const seat0Role = shuffled[0] as BaseRole;
    const pickRole = shuffled[pickAt] as BaseRole;
    shuffled[0] = pickRole;
    shuffled[pickAt] = seat0Role;
  }

  const players = playersInSeatOrder.map((p, i) => {
    // shuffled.length === n === playersInSeatOrder.length by construction.
    const role = shuffled[i] as BaseRole;
    const word = role === 'civilian' ? civilianWord : role === 'undercover' ? undercoverWord : null;
    return {
      ...p,
      role,
      word,
      hasSeenWord: false,
      alive: true,
      eliminatedRound: null,
      specialRole: null,
      usedSpecialPower: false,
    };
  });

  // Layer special roles on top of the base-role deal (assignment framework,
  // packages/engine/ROLES.md). `players` above already reset every `specialRole` to
  // `null`, satisfying `assignSpecialRoles`'s precondition.
  const withSpecialRoles = assignSpecialRoles(settings, players, rng);

  return { players: withSpecialRoles, pair: { civilianWord, undercoverWord, pairId: pair.pairId } };
}

/** Builds the post-deal `GameState`: fresh roles/words, `phase: 'dealing'`, 45s timer, and
 * every per-game field reset (used by both `start` and `rematch`). */
export function beginDealing(state: GameState, pair: DealtPair, at: number): GameState {
  const rng = createRng(`${state.seed}:deal:${state.gamesPlayedInRoom}`);
  const { players, pair: resolvedPair } = dealRoles(state.settings, state.players, pair, rng);
  const endsAt = at + DEAL_TIMEOUT_SEC * 1000;
  return {
    ...state,
    players,
    pair: resolvedPair,
    phase: 'dealing',
    round: 0,
    turnSeat: null,
    clues: [],
    votes: {},
    tiedPlayerIds: null,
    revoteCount: 0,
    pendingElimination: null,
    winnerFaction: null,
    voteHistory: [],
    lastGuess: null,
    phaseEndsAt: endsAt,
    timerExtended: false,
    // A fresh deal always starts with the Judge un-revealed — the previous
    // game's reveal (if any) must not leak into a rematch.
    judgeRevealed: false,
    // No cascade/bounce/mime carries over from the previous game — `mimeId` is
    // re-derived once round 1 actually begins (`reducers/clue.ts` `enterNextClueRound`).
    pendingCascade: [],
    mirrorBounced: false,
    mimeId: null,
  };
}

/** `start` — host + lobby only (api-contract.md §2.1 `game:start`). Re-validates role math
 * against the ACTUAL seated count (not just `settings.maxPlayers`, already checked at
 * `updateSettings` time) — special-role min-player requirements the same way. */
export function applyStart(state: GameState, action: StartAction): ApplyResult {
  if (state.phase !== 'lobby') return reject(state, 'wrong_phase');
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');
  if (state.players.length < MIN_PLAYERS) return reject(state, 'validation');
  if (
    !isValidRoleMath(
      state.settings.undercoverCount,
      state.settings.mrWhiteCount,
      state.players.length,
    )
  ) {
    return reject(state, 'validation');
  }
  if (!isValidSpecialRoles(state.settings.specialRoles, state.players.length)) {
    return reject(state, 'validation');
  }
  const next = beginDealing(state, action.pair, action.at);
  return ok(next, timerEffects(next.phaseEndsAt));
}

/** `ackWord` — dealing-phase only, idempotent (api-contract.md §2.1 `deal:ack`). Once every
 * alive player has acked, enters clue round 1. */
export function applyAckWord(state: GameState, action: AckWordAction): ApplyResult {
  if (state.phase !== 'dealing') return reject(state, 'wrong_phase');
  const player = findPlayer(state, action.playerId);
  if (!player || !player.alive) return reject(state, 'validation');

  const players = state.players.map((p) =>
    p.id === action.playerId ? { ...p, hasSeenWord: true } : p,
  );
  const allAcked = players.every((p) => !p.alive || p.hasSeenWord);
  if (!allAcked) return ok({ ...state, players });

  return enterNextClueRound({ ...state, players }, action.at);
}

/** `timeout{dealing}` — auto-acks every alive player, then enters clue round 1 exactly
 * like the last manual `ackWord` would. */
export function timeoutDealing(state: GameState, at: number): ApplyResult {
  const players = state.players.map((p) => (p.alive ? { ...p, hasSeenWord: true } : p));
  return enterNextClueRound({ ...state, players }, at);
}
