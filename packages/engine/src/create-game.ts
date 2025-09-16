import type { GamePlayer, GameSettings, GameState } from './types.js';

/**
 * Normalizes one input `GamePlayer` into a fresh-lobby shape: whatever per-game fields the
 * caller passed in are reset to their lobby defaults, so `createGame` always produces a
 * valid starting point regardless of what it's handed (e.g. a player list recycled from a
 * previous session). `seat` is reassigned to the player's position in the input array —
 * `players` is the seat order (data-model.md §3).
 */
function toLobbyPlayer(player: GamePlayer, seat: number): GamePlayer {
  return {
    ...player,
    seat,
    hasSeenWord: false,
    alive: true,
    eliminatedRound: null,
    role: null,
    word: null,
    specialRole: null,
    usedSpecialPower: false,
    hasLeft: false,
  };
}

/**
 * Builds the initial `GameState` in the `lobby` phase (data-model.md §3). Deterministic
 * given the same `settings` + `players` + `seed` + `now` — `seed` becomes `GameState.seed`,
 * the root of all later RNG draws (pair side flip, role assignment; conventions.md §4).
 * `now` (default `0`) becomes `createdAt` — the engine itself never reads
 * a clock, so the host environment supplies its own timestamp.
 *
 * `mode`/`code` default to the pass-and-play shape (`'pass_play'` / `null`): this signature
 * has no room for the host environment to pass them in, so an online host environment is
 * expected to override those two fields on the returned state before persisting it.
 */
export function createGame(
  settings: GameSettings,
  players: GamePlayer[],
  seed: string,
  now = 0,
): GameState {
  const lobbyPlayers = players.map((p, seat) => toLobbyPlayer(p, seat));
  return {
    code: null,
    mode: 'pass_play',
    phase: 'lobby',
    round: 0,
    settings,
    players: lobbyPlayers,
    hostId: lobbyPlayers[0]?.id ?? '',
    turnSeat: null,
    clues: [],
    votes: {},
    tiedPlayerIds: null,
    revoteCount: 0,
    pendingElimination: null,
    pair: { civilianWord: '', undercoverWord: '', pairId: null },
    winnerFaction: null,
    scoreboard: {},
    gamesPlayedInRoom: 0,
    phaseEndsAt: null,
    seed,
    createdAt: now,
    voteHistory: [],
    lastGuess: null,
    timerExtended: false,
    judgeRevealed: false,
    pendingCascade: [],
    mirrorBounced: false,
    mimeId: null,
  };
}
