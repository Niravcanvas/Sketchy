import type {
  AvatarConfig,
  Clue,
  Faction,
  GamePlayer,
  GameSettings,
  GameState,
  Phase,
  SpecialRole,
  VoteRecord,
} from './types.js';

/**
 * `GamePlayer` as seen by a given viewer: `role` / `word` / `specialRole` are nulled out
 * per the redaction matrix (data-model.md §4) rather than always present. A REAL distinct
 * shape (not `GamePlayer` with fields re-typed loosely) so a client can never accidentally
 * read a secret field that just happens to type-check.
 */
export interface RedactedGamePlayer {
  id: string;
  name: string;
  avatar: AvatarConfig;
  seat: number;
  connected: boolean;
  isReady: boolean;
  hasSeenWord: boolean;
  alive: boolean;
  eliminatedRound: number | null;
  role: 'civilian' | 'undercover' | 'mrwhite' | null;
  word: string | null;
  specialRole: SpecialRole | null;
  usedSpecialPower: boolean;
  hasLeft: boolean;
}

/**
 * The shape sent to clients: `GameState` with `pair` / roles / words / raw `votes`
 * redacted per the matrix in data-model.md §4. A REAL distinct type (not an alias of
 * `GameState`) so the compiler itself enforces "no other code path touches the secrets".
 */
export interface RedactedGameState {
  code: string | null;
  mode: 'pass_play' | 'online_private' | 'online_public';
  phase: Phase;
  round: number;
  settings: GameSettings;
  players: RedactedGamePlayer[];
  hostId: string;
  turnSeat: number | null;
  clues: Clue[];
  /** Only the viewer's own ballot entry, if any — `{}` for a spectator or non-voter. */
  votes: Record<string, string>;
  /** Who HAS cast a ballot this vote (public — drives "6/8 voted" checkmarks); WHO they
   * targeted stays secret (data-model.md §4 `votes` row). */
  votedIds: string[];
  tiedPlayerIds: string[] | null;
  revoteCount: number;
  pendingElimination: string | null;
  /** Null until `game_over` — even to the viewer themselves (data-model.md §4: "never...
   * would leak the other word"). */
  pair: { civilianWord: string; undercoverWord: string; pairId: string | null } | null;
  winnerFaction: Faction | null;
  scoreboard: Record<string, number>;
  gamesPlayedInRoom: number;
  phaseEndsAt: number | null;
  /** Always `''` — the real seed reconstructs the entire deal (every role + word), so
   * leaking it is equivalent to leaking the game (data-model.md §4). */
  seed: string;
  createdAt: number;
  /** `[]` until `game_over` — raw ballots, same sensitivity as `votes`. */
  voteHistory: VoteRecord[];
  lastGuess: { playerId: string; text: string; correct: boolean } | null;
  timerExtended: boolean;
  /** Queue of player ids still awaiting their own reveal card in the CURRENT
   * chained-elimination sequence — PUBLIC (data-model.md §4: every id in it is already
   * `alive: false`, itself always public; the queue carries no role/word). */
  pendingCascade: string[];
  /** `true` while the current elimination sequence stems from a Mirror bounce —
   * PUBLIC, but deliberately carries no player id (the Mirror's identity must stay secret;
   * see `GameState.mirrorBounced`'s doc comment). */
  mirrorBounced: boolean;
  /** This round's Mime (room-wide setting), or `null` — PUBLIC (copy.md §3.2:
   * "public toast"). */
  mimeId: string | null;
}

/**
 * Produces the redacted view of `state` for a given viewer — either a specific player's
 * private slice, or the public `'spectator'` view broadcast to everyone (data-model.md §4).
 * No other code path may touch `pair`, `role`, `word`, or raw `votes`.
 */
export function redactFor(state: GameState, viewerId: string | 'spectator'): RedactedGameState {
  const viewer =
    viewerId === 'spectator' ? undefined : state.players.find((p) => p.id === viewerId);
  const gameOver = state.phase === 'game_over';

  const players: RedactedGamePlayer[] = state.players.map((p) =>
    redactPlayer(p, viewer, gameOver, state.settings, state.judgeRevealed),
  );

  const votes: Record<string, string> = {};
  if (viewer && Object.hasOwn(state.votes, viewer.id)) {
    votes[viewer.id] = state.votes[viewer.id] as string;
  }

  return {
    code: state.code,
    mode: state.mode,
    phase: state.phase,
    round: state.round,
    settings: state.settings,
    players,
    hostId: state.hostId,
    turnSeat: state.turnSeat,
    clues: state.clues,
    votes,
    votedIds: Object.keys(state.votes),
    tiedPlayerIds: state.tiedPlayerIds,
    revoteCount: state.revoteCount,
    pendingElimination: state.pendingElimination,
    pair: gameOver ? state.pair : null,
    winnerFaction: state.winnerFaction,
    scoreboard: state.scoreboard,
    gamesPlayedInRoom: state.gamesPlayedInRoom,
    phaseEndsAt: state.phaseEndsAt,
    seed: '',
    createdAt: state.createdAt,
    voteHistory: gameOver ? state.voteHistory : [],
    lastGuess: state.lastGuess,
    timerExtended: state.timerExtended,
    pendingCascade: state.pendingCascade,
    mirrorBounced: state.mirrorBounced,
    mimeId: state.mimeId,
  };
}

function redactPlayer(
  p: GamePlayer,
  viewer: GamePlayer | undefined,
  gameOver: boolean,
  settings: GameSettings,
  judgeRevealed: boolean,
): RedactedGamePlayer {
  const isSelf = viewer !== undefined && p.id === viewer.id;
  // role: always visible to yourself; visible to everyone once eliminated (from the
  // `reveal` phase on) or once the game ends (data-model.md §4).
  const roleVisible = isSelf || !p.alive || gameOver;
  // specialRole: same visibility as role, PLUS the Judge exception (data-model.md
  // §4: "hidden — except Judge, announced to all when a tie invokes it") — once
  // `judgeRevealed` latches true (vote.ts's `closeVote`), the Judge's identity is public
  // even while still alive, for the rest of the game. Deliberately a SEPARATE condition
  // from `roleVisible`: the Judge's base civilian/undercover/mrwhite role does not also
  // leak just because their special role did.
  const specialRoleVisible = roleVisible || (judgeRevealed && p.specialRole === 'judge');
  // word: same as role, EXCEPT elimination only reveals it when
  // `settings.eliminationReveal === 'word_and_role'` — otherwise it stays secret (even for
  // an eliminated player) until `game_over` reveals everything.
  const wordVisible =
    isSelf || gameOver || (!p.alive && settings.eliminationReveal === 'word_and_role');

  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    seat: p.seat,
    connected: p.connected,
    isReady: p.isReady,
    hasSeenWord: p.hasSeenWord,
    alive: p.alive,
    eliminatedRound: p.eliminatedRound,
    usedSpecialPower: p.usedSpecialPower,
    hasLeft: p.hasLeft,
    role: roleVisible ? p.role : null,
    word: wordVisible ? p.word : null,
    specialRole: specialRoleVisible ? p.specialRole : null,
  };
}
