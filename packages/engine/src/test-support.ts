import { applyAction } from './apply-action.js';
import { createGame } from './create-game.js';
import { suggestRoleCounts } from './suggest-role-counts.js';
import type { GameAction } from './actions.js';
import type { AvatarConfig, GamePlayer, GameSettings, GameState } from './types.js';

/**
 * Shared test fixtures/builders (excluded from coverage — see vitest.config.mts). Kept out
 * of the reducer modules themselves (conventions.md §1: no barrels) but centralized here
 * so every `*.test.ts` file builds states the same way instead of re-deriving fixtures.
 */

export function makeAvatar(): AvatarConfig {
  return { head: 'head-1', face: 'face-1', accessory: 'none', inkColor: '#2B2926' };
}

export function makePlayer(overrides: Partial<GamePlayer> & { id: string }): GamePlayer {
  return {
    name: overrides.id,
    avatar: makeAvatar(),
    seat: 0,
    connected: true,
    isReady: true,
    hasSeenWord: true,
    alive: true,
    eliminatedRound: null,
    role: null,
    word: null,
    specialRole: null,
    usedSpecialPower: false,
    hasLeft: false,
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    maxPlayers: 12,
    undercoverCount: 1,
    mrWhiteCount: 1,
    specialRoles: [],
    packIds: ['pack-1'],
    difficulties: ['easy', 'medium', 'hard'],
    clueTimerSec: 60,
    discussionTimerSec: 120,
    voteTimerSec: 45,
    mrWhiteFirstClueBan: true,
    eliminationReveal: 'role',
    ...overrides,
  };
}

/** A 4-player `clue`-phase state (civ/civ/undercover/mrwhite) — the default fixture most
 * reducer unit tests start from and tweak via `overrides`. */
export function makeState(overrides: Partial<GameState> = {}): GameState {
  const players: GamePlayer[] = overrides.players ?? [
    makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
    makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
    makePlayer({ id: 'p2', seat: 2, role: 'undercover', word: 'moon' }),
    makePlayer({ id: 'p3', seat: 3, role: 'mrwhite', word: null }),
  ];
  return {
    code: null,
    mode: 'pass_play',
    phase: 'clue',
    round: 1,
    settings: makeSettings(),
    players,
    hostId: players[0]?.id ?? '',
    turnSeat: 0,
    clues: [],
    votes: {},
    tiedPlayerIds: null,
    revoteCount: 0,
    pendingElimination: null,
    pair: { civilianWord: 'sun', undercoverWord: 'moon', pairId: 'pair-1' },
    winnerFaction: null,
    scoreboard: {},
    gamesPlayedInRoom: 0,
    phaseEndsAt: null,
    seed: 'test-seed',
    createdAt: 0,
    voteHistory: [],
    lastGuess: null,
    timerExtended: false,
    judgeRevealed: false,
    pendingCascade: [],
    mirrorBounced: false,
    mimeId: null,
    ...overrides,
  };
}

/** A readable one-line dump of the current state — satisfies full-game.test.ts's "readable
 * state dumps" requirement: e.g. `"R2 voting 6 alive | scores p0:2,p1:2"`. */
export function describeState(state: GameState): string {
  const aliveCount = state.players.filter((p) => p.alive).length;
  const scores = Object.entries(state.scoreboard)
    .map(([id, score]) => `${id}:${score}`)
    .join(',');
  return `R${state.round} ${state.phase} ${aliveCount} alive | scores ${scores || '(none)'}`;
}

/** Picks the next alive player to unanimously vote out: lowest `priority(role)` value
 * first, ties broken by seat. Voting UNANIMOUSLY for one target guarantees a clean plurality
 * every round (never a tie), so scripted sims never have to navigate tiebreak_clue/revote —
 * those paths are covered directly in vote.test.ts / clue.test.ts. */
function pickNextTarget(state: GameState, priority: (role: GamePlayer['role']) => number): string {
  const alive = [...state.players.filter((p) => p.alive)].sort((a, b) => {
    const diff = priority(a.role) - priority(b.role);
    return diff !== 0 ? diff : a.seat - b.seat;
  });
  return (alive[0] as GamePlayer).id;
}

export interface ScriptedGameOptions {
  n: number;
  seed: string;
  /** Lower = eliminated earlier. Drives which faction ends up winning. */
  priority: (role: GamePlayer['role']) => number;
  mrWhiteGuessCorrect?: boolean;
  roleCounts?: { undercoverCount: number; mrWhiteCount: number };
  pair?: { wordA: string; wordB: string; pairId: string | null };
  settingsOverrides?: Partial<GameSettings>;
}

/**
 * Plays a full deterministic game from `lobby` to `game_over` by always dispatching the
 * "obvious next action" and steering elimination order via `priority` — the harness for
 * full-game.test.ts's scripted sims and determinism.test.ts's replay checks. Throws if the
 * engine ever rejects a scripted action (a bug) or the game runs away past a sane round cap.
 */
export function playScriptedGame(opts: ScriptedGameOptions): {
  finalState: GameState;
  log: string[];
  actions: GameAction[];
  initial: GameState;
} {
  const pair = opts.pair ?? { wordA: 'Coffee', wordB: 'Tea', pairId: null };
  const roleCounts = opts.roleCounts ?? suggestRoleCounts(opts.n);
  const players = Array.from({ length: opts.n }, (_, i) =>
    makePlayer({ id: `p${i}`, seat: i, isReady: true }),
  );
  const settings = makeSettings({ ...roleCounts, maxPlayers: opts.n, ...opts.settingsOverrides });

  const initial = createGame(settings, players, opts.seed, 0);
  let state = initial;
  let at = 1;
  const log: string[] = [];
  const actions: GameAction[] = [];

  function dispatch(action: GameAction): void {
    actions.push(action);
    const result = applyAction(state, action);
    if (result.error) {
      throw new Error(`scripted game: unexpected rejection for ${action.type} -> ${result.error}`);
    }
    state = result.state;
    at += 1;
  }

  dispatch({ type: 'start', at, playerId: state.hostId, pair });
  for (const p of [...state.players]) dispatch({ type: 'ackWord', at, playerId: p.id });

  let safety = 0;
  while (state.phase !== 'game_over') {
    safety += 1;
    if (safety > 2000) throw new Error('scripted game: runaway simulation, likely a driver bug');
    log.push(describeState(state));

    if (state.phase === 'clue' || state.phase === 'tiebreak_clue') {
      const order =
        state.phase === 'tiebreak_clue'
          ? state.players.filter((p) => (state.tiedPlayerIds ?? []).includes(p.id))
          : state.players.filter((p) => p.alive);
      const holder = order[state.turnSeat as number] as GamePlayer;
      dispatch({
        type: 'submitClue',
        at,
        playerId: holder.id,
        text: `clue-${state.round}-${holder.id}`,
      });
    } else if (state.phase === 'discussion') {
      dispatch({ type: 'advancePhase', at, playerId: state.hostId });
    } else if (state.phase === 'voting') {
      const target = pickNextTarget(state, opts.priority);
      const voters = state.players.filter((p) => p.alive && !p.hasLeft);
      // The target can't vote for themself; they cast a throwaway ballot for anyone else
      // alive instead. Every scenario this driver is used for keeps >=3 alive voters in
      // every round that actually decides the game, so this never produces a tie.
      const fallback = (voters.find((p) => p.id !== target) as GamePlayer).id;
      for (const voter of voters) {
        dispatch({
          type: 'castVote',
          at,
          playerId: voter.id,
          targetId: voter.id === target ? fallback : target,
        });
      }
    } else if (state.phase === 'reveal') {
      dispatch({ type: 'continueReveal', at, playerId: state.hostId });
    } else if (state.phase === 'mrwhite_guess') {
      const correct = opts.mrWhiteGuessCorrect ?? false;
      const text = correct ? state.pair.civilianWord : 'definitely-wrong-guess';
      dispatch({ type: 'mrWhiteGuess', at, playerId: state.pendingElimination as string, text });
    }
  }
  log.push(describeState(state));

  return { finalState: state, log, actions, initial };
}

/** Elimination priorities for each target outcome — see `playScriptedGame`. */
export const eliminationPriority = {
  civilianWin: (role: GamePlayer['role']): number => (role === 'civilian' ? 1 : 0),
  undercoverWin: (role: GamePlayer['role']): number =>
    role === 'mrwhite' ? 0 : role === 'civilian' ? 1 : 2,
  mrwhiteWin: (role: GamePlayer['role']): number =>
    role === 'undercover' ? 0 : role === 'civilian' ? 1 : 2,
  infiltratorsWin: (role: GamePlayer['role']): number => (role === 'civilian' ? 0 : 1),
  mrwhiteSteal: (role: GamePlayer['role']): number => (role === 'mrwhite' ? 0 : 1),
};
