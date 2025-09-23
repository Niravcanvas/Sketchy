import type { RedactedGamePlayer, RedactedGameState } from '@sketchy/engine/redact-for';
import type { AvatarConfig } from '@sketchy/engine/types';
import type { YouSlice } from '@sketchy/shared/contract/socket';

/** Shared `RoomSnapshot`-shaped fixtures for the `components/room/game/**` test suite —
 * hand-built rather than driven through the engine (these components render off a redacted
 * snapshot, never the engine directly), covering a 4-player table in assorted turn/phase
 * states. Kept local to this directory rather than promoted to a shared test-utils module —
 * only `game/**`'s own tests need it so far. */

const DEFAULT_AVATAR: AvatarConfig = {
  head: 'head-1',
  face: 'face-1',
  accessory: 'none',
  inkColor: 'civilian',
};

export function buildPlayer(overrides: Partial<RedactedGamePlayer> = {}): RedactedGamePlayer {
  return {
    id: 'p1',
    name: 'Priya',
    avatar: DEFAULT_AVATAR,
    seat: 0,
    connected: true,
    isReady: true,
    hasSeenWord: false,
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

/** Four seated players in turn order: Priya (seat 0, host), Sam (1), Jo (2), Alex (3). */
export function buildFourPlayers(): RedactedGamePlayer[] {
  return [
    buildPlayer({ id: 'p1', name: 'Priya', seat: 0 }),
    buildPlayer({ id: 'p2', name: 'Sam', seat: 1 }),
    buildPlayer({ id: 'p3', name: 'Jo', seat: 2 }),
    buildPlayer({ id: 'p4', name: 'Alex', seat: 3 }),
  ];
}

export function buildGameState(overrides: Partial<RedactedGameState> = {}): RedactedGameState {
  return {
    code: 'ABCJK',
    mode: 'online_private',
    phase: 'dealing',
    round: 0,
    settings: {
      maxPlayers: 12,
      undercoverCount: 1,
      mrWhiteCount: 0,
      specialRoles: [],
      packIds: [],
      difficulties: ['easy', 'medium', 'hard'],
      clueTimerSec: 60,
      discussionTimerSec: 120,
      voteTimerSec: 45,
      mrWhiteFirstClueBan: true,
      eliminationReveal: 'role',
    },
    players: buildFourPlayers(),
    hostId: 'p1',
    turnSeat: null,
    clues: [],
    votes: {},
    votedIds: [],
    tiedPlayerIds: null,
    revoteCount: 0,
    pendingElimination: null,
    pair: null,
    winnerFaction: null,
    scoreboard: {},
    gamesPlayedInRoom: 0,
    phaseEndsAt: null,
    seed: '',
    createdAt: 0,
    voteHistory: [],
    lastGuess: null,
    timerExtended: false,
    pendingCascade: [],
    mirrorBounced: false,
    mimeId: null,
    ...overrides,
  };
}

export function buildYouSlice(
  overrides: Partial<Omit<YouSlice, 'canAct'>> & { canAct?: Partial<YouSlice['canAct']> } = {},
): YouSlice {
  return {
    playerId: 'p1',
    role: null,
    word: null,
    specialRole: null,
    yourVote: null,
    lovebirdsPartnerId: null,
    rivalId: null,
    ...overrides,
    // Merged (not overwritten wholesale) so a test can flip a single `canAct` flag without
    // having to restate the other seven.
    canAct: {
      submitClue: false,
      vote: false,
      judge: false,
      grudge: false,
      advancePhase: false,
      start: false,
      kick: false,
      extendTimer: false,
      ...overrides.canAct,
    },
  };
}
