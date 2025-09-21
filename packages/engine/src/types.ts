/**
 * The canonical `GameState` and friends — arch/data-model.md §3.
 *
 * One TypeScript shape, exported from `packages/engine`, used by: the server
 * (stored in Redis, reduced on actions), pass-and-play (stored in localStorage,
 * reduced in the browser), and — in redacted form — every client render.
 * Future work must not invent state fields ad hoc; it extends this shape via the
 * engine package with a migration note.
 */

/**
 * Turn/flow states a room moves through. See data-model.md §3 for the full
 * state machine (phase transitions are enforced by `applyAction`).
 */
export type Phase =
  | 'lobby' // players joining, host configuring
  | 'dealing' // roles assigned; players privately viewing words ("ack" gate)
  | 'clue' // turn-ordered clue giving
  | 'discussion' // free talk (timer, host-skippable)
  | 'voting' // simultaneous secret ballots
  | 'tiebreak_clue' // sudden-death: tied players give one extra clue each
  | 'judge_decision' // Judge special role resolving a tie instead of tiebreak_clue
  | 'grudge_decision' // Grudge special role picking a drag-down target
  | 'reveal' // elimination result being shown
  | 'mrwhite_guess' // eliminated Mr. White's single guess window
  | 'game_over';

/**
 * Which side wins a game. Mirrors the Postgres `faction` enum
 * (data-model.md §1) — 'infiltrators' covers Undercover + Mr. White winning
 * together in the default rules (research/01 §5 has the exact table).
 */
export type Faction = 'civilian' | 'undercover' | 'mrwhite' | 'infiltrators';

/** Word-pair difficulty tier — a PAIR property, not a pack property (data-model.md §1). */
export type Difficulty = 'easy' | 'medium' | 'hard';

/** Append-only clue log entry. */
export interface Clue {
  round: number;
  playerId: string;
  text: string;
  /**
   * `true` when `playerId` was THIS round's Mime (`GameState.mimeId`) at the moment this
   * clue was recorded — never `true` for a `SKIPPED_CLUE` entry (a skipped turn isn't a
   * gesture). PUBLIC, same as the rest of `Clue` (data-model.md §4 `clues` row) — the clue
   * board renders "🎭 (mimed)" off this flag. Set once, at recording time, so it stays
   * historically accurate even after `mimeId` moves on to a different player next round.
   */
  mimed: boolean;
}

/**
 * Open Peeps avatar composer config (conventions.md §2): modular hand-drawn
 * parts assembled by `<AvatarDoodle config>` in apps/web. Stored verbatim in
 * `players.avatar` jsonb (data-model.md §1).
 */
export interface AvatarConfig {
  head: string;
  face: string;
  accessory: string;
  inkColor: string;
}

export interface GameState {
  code: string | null; // null in pass-and-play
  mode: 'pass_play' | 'online_private' | 'online_public';
  phase: Phase;
  round: number; // 1-based; increments each time clue phase restarts
  settings: GameSettings;
  players: GamePlayer[]; // in seat/turn order
  hostId: string;
  turnSeat: number | null; // whose clue turn (index into alive, seat-ordered)
  clues: Clue[]; // append-only log: {round, playerId, text}
  votes: Record<string, string>; // voterId → targetId; CURRENT ballot only; SECRET (§4)
  tiedPlayerIds: string[] | null; // non-null during tiebreak_clue / re-vote
  revoteCount: number; // 0 or 1; second tie = no elimination this round
  pendingElimination: string | null; // playerId shown in 'reveal'
  pair: { civilianWord: string; undercoverWord: string; pairId: string | null }; // SECRET (§4)
  winnerFaction: Faction | null;
  scoreboard: Record<string, number>; // session points accumulated across rematches
  gamesPlayedInRoom: number;
  phaseEndsAt: number | null; // epoch ms; server-owned deadline (null = untimed)
  seed: string; // RNG seed — engine is deterministic given seed + actions
  createdAt: number;
  /**
   * Append-only log of every vote that closed this game (data-model.md §4), recorded
   * BEFORE `votes` is cleared for the next round. SECRET until `game_over` (redactFor
   * empties it earlier) — it's essentially raw ballots, same sensitivity as `votes`.
   */
  voteHistory: VoteRecord[];
  /**
   * The outcome of Mr. White's guess, if one has happened this game. PUBLIC
   * (game-design.md §6.6: "the wrong guess is shown to everyone"). Cleared back to `null`
   * on `rematch`.
   */
  lastGuess: { playerId: string; text: string; correct: boolean } | null;
  /**
   * Whether the host has already used their once-per-phase `extendTimer` (+60s,
   * game-design.md §6.3). Reset to `false` on every phase change.
   */
  timerExtended: boolean;
  /**
   * Latches `true` the first time a tie ever routes to `judge_decision` this game (never
   * reset until the next `start`/`rematch` deal). Drives the ONE redaction exception in
   * §4 (data-model.md) — the Judge's `specialRole` becomes public (to everyone, alive or
   * not) once this is true, independent of their base `role`'s own visibility.
   */
  judgeRevealed: boolean;
  /**
   * Queue of player ids still awaiting their own reveal card within the CURRENT chained
   * elimination sequence (Lovebirds partner fall / Grudge drag-down). Every id in this
   * queue is ALREADY marked `alive: false` with `eliminatedRound` set — the queue only
   * tracks the order their reveal card still needs to visually flip. Empty except mid-
   * cascade; reset to `[]` on `enterNextClueRound` and on a fresh `beginDealing`. PUBLIC
   * (data-model.md §4) — it never carries role/word information, only ids, and every id in
   * it is already `alive: false` (itself always public).
   */
  pendingCascade: string[];
  /**
   * `true` for the duration of the CURRENT elimination sequence (through its whole
   * cascade) when the primary elimination was redirected by the Mirror special role's
   * one-shot bounce (`reducers/vote.ts` `closeVote` — a clean VOTE plurality on the Mirror
   * only; a Judge decision, or that decision's own timeout/host-escape default, never sets
   * this — see ROLES.md's Mirror boundary note). Deliberately carries NO player id: the
   * Mirror survives and their identity must stay secret (unlike the Judge's
   * `judgeRevealed` exception) — this flag only lets the client render a distinct "the
   * vote bounced" reveal beat without naming who caused it. Reset to `false` on
   * `enterNextClueRound` and on a fresh `beginDealing`. PUBLIC.
   */
  mirrorBounced: boolean;
  /**
   * This ROUND's Mime, a room-wide setting (`settings.specialRoles` containing `'mime'`)
   * rather than a dealt `specialRole` holder — see ROLES.md's Mime section for why. `null`
   * when the setting is off, or before round 1 begins. Recomputed once per fresh clue
   * round (`reducers/clue.ts` `enterNextClueRound`) via a per-round seeded draw among that
   * round's ALIVE players (`${seed}:mime:${gamesPlayedInRoom}:${round}`, the same
   * per-purpose-generator convention as `assignSpecialRoles`/`resolveJudgeDecisionByDefault`)
   * — deterministic, no anti-repeat constraint against the previous round's Mime (a
   * documented simplification). PUBLIC (copy.md §3.2: "public toast").
   */
  mimeId: string | null;
}

/**
 * One closed vote (data-model.md §4). `revote` distinguishes the first vote of a round
 * from the sudden-death re-vote among tied players (research/01 §4 Phase 3). `eliminated`
 * is `null` for an all-abstain close or a second tie.
 */
export interface VoteRecord {
  round: number;
  revote: boolean;
  votes: Record<string, string>;
  eliminated: string | null;
}

export interface GamePlayer {
  id: string;
  name: string;
  avatar: AvatarConfig;
  seat: number;
  connected: boolean; // presence-driven; always true in pass_play
  isReady: boolean; // lobby only
  hasSeenWord: boolean; // dealing-phase ack
  alive: boolean;
  eliminatedRound: number | null;
  role: 'civilian' | 'undercover' | 'mrwhite' | null; // SECRET while alive (§4)
  word: string | null; // SECRET (§4); null for Mr. White
  specialRole: SpecialRole | null; // SECRET unless role rules say otherwise
  usedSpecialPower: boolean; // Mirror bounce, Grudge drag, etc. — one-shot tracking
  /**
   * Set by an explicit mid-game `leave` action (as opposed to a mere disconnect —
   * `connected: false`). A player who has left is treated as eliminated at the next phase
   * boundary (arch/game-design.md §8), not instantly, so an in-flight clue/vote round
   * doesn't need to re-shape itself mid-round.
   */
  hasLeft: boolean;
}

export interface GameSettings {
  maxPlayers: number; // default 12, hard cap 20, min 3 (UI warns <4 — see copy.md)
  undercoverCount: number; // host-set; default from suggestRoleCounts(playerCount)
  mrWhiteCount: number;
  specialRoles: SpecialRole[]; // enabled roles, e.g. ['judge','ghost']; empty at launch
  packIds: string[]; // selected word packs
  difficulties: Difficulty[]; // filter, default all three
  clueTimerSec: number | null; // default 60; null = untimed (Discord-friendly)
  discussionTimerSec: number | null; // default 120
  voteTimerSec: number | null; // default 45
  mrWhiteFirstClueBan: boolean; // default true: Mr. White never assigned seat 0
  eliminationReveal: 'role' | 'word_and_role'; // default 'role'
}

export type SpecialRole =
  | 'judge'
  | 'ghost'
  | 'jester' // wave 1
  | 'lovebirds'
  | 'grudge'
  | 'mirror'
  | 'rivals'
  | 'mime'; // wave 2
