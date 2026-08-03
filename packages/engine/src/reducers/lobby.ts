import type {
  JoinAction,
  KickAction,
  LeaveAction,
  SetReadyAction,
  UpdateSettingsAction,
} from '../actions.js';
import type { ApplyResult } from '../apply-action.js';
import type { GamePlayer, GameState } from '../types.js';
import {
  findPlayer,
  isHost,
  isValidSettingsForLobby,
  isValidSpecialRoles,
  normalizeText,
  ok,
  reject,
  removeAndCompactSeats,
} from './shared.js';

/** `join` — lobby-phase only (game-design.md §5). Room-full and case-insensitive
 * name-collision checks happen against the CURRENT roster before the seat is granted. */
export function applyJoin(state: GameState, action: JoinAction): ApplyResult {
  if (state.phase !== 'lobby') return reject(state, 'wrong_phase');
  if (state.players.length >= state.settings.maxPlayers) return reject(state, 'room_full');

  const incomingName = normalizeText(action.player.name);
  const collides = state.players.some((p) => normalizeText(p.name) === incomingName);
  if (collides) return reject(state, 'name_taken_in_room');

  const newPlayer: GamePlayer = {
    id: action.player.id,
    name: action.player.name,
    avatar: action.player.avatar,
    seat: state.players.length,
    connected: true,
    isReady: false,
    hasSeenWord: false,
    alive: true,
    eliminatedRound: null,
    role: null,
    word: null,
    specialRole: null,
    usedSpecialPower: false,
    hasLeft: false,
  };
  return ok({ ...state, players: [...state.players, newPlayer] });
}

/**
 * `leave` — voluntary departure (game-design.md §9 / api-contract.md §2.1 `room:leave`).
 * In `lobby` the seat is removed outright (seats compact). Mid-game, elimination is
 * deferred to the next phase boundary: only `hasLeft`/`connected` flip here.
 */
export function applyLeave(state: GameState, action: LeaveAction): ApplyResult {
  const player = findPlayer(state, action.playerId);
  if (!player) return reject(state, 'validation');

  if (state.phase === 'lobby') {
    return ok(removeAndCompactSeats(state, action.playerId));
  }

  const players = state.players.map((p) =>
    p.id === action.playerId ? { ...p, hasLeft: true, connected: false } : p,
  );
  return ok({ ...state, players });
}

/** `setReady` — lobby only (api-contract.md §2.1 `lobby:ready`). */
export function applySetReady(state: GameState, action: SetReadyAction): ApplyResult {
  if (state.phase !== 'lobby') return reject(state, 'wrong_phase');
  const player = findPlayer(state, action.playerId);
  if (!player) return reject(state, 'validation');
  const players = state.players.map((p) =>
    p.id === action.playerId ? { ...p, isReady: action.ready } : p,
  );
  return ok({ ...state, players });
}

/**
 * `updateSettings` — host + lobby only (api-contract.md §2.1 `lobby:settings`). The patch
 * is merged onto the existing settings and the WHOLE RESULT is validated; an invalid merge
 * leaves `state` completely untouched (not even partially applied).
 */
export function applyUpdateSettings(state: GameState, action: UpdateSettingsAction): ApplyResult {
  if (state.phase !== 'lobby') return reject(state, 'wrong_phase');
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');

  const merged = { ...state.settings, ...action.patch };
  if (!isValidSpecialRoles(merged.specialRoles, merged.maxPlayers)) return reject(state, 'too_spicy');
  if (!isValidSettingsForLobby(merged, state.players.length)) return reject(state, 'validation');

  return ok({ ...state, settings: merged });
}

/** `kick` — host + lobby only, cannot target self (api-contract.md §2.1 `lobby:kick`). */
export function applyKick(state: GameState, action: KickAction): ApplyResult {
  if (state.phase !== 'lobby') return reject(state, 'wrong_phase');
  if (!isHost(state, action.playerId)) return reject(state, 'not_host');
  if (action.targetId === action.playerId) return reject(state, 'validation');
  const target = findPlayer(state, action.targetId);
  if (!target) return reject(state, 'validation');

  return ok(removeAndCompactSeats(state, action.targetId));
}
