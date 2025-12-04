import { create } from 'zustand';
import { applyAction, type ApplyResult, type EngineErrorCode } from '@sketchy/engine/apply-action';
import type { DealtPair, GameAction } from '@sketchy/engine/actions';
import { createGame } from '@sketchy/engine/create-game';
import { currentTurnOrder } from '@sketchy/engine/reducers/shared';
import { suggestRoleCounts } from '@sketchy/engine/suggest-role-counts';
import type {
  Difficulty,
  GamePlayer,
  GameSettings,
  GameState,
  SpecialRole,
} from '@sketchy/engine/types';
import { defaultAvatar } from '@/lib/default-avatar';
import { drawPair, type PairPool } from '@/lib/pair-pool';

/**
 * Pass-and-play local game host — a zustand store that owns a `GameState` end to end on one
 * offline device (arch/game-design.md §4). The setup screen IS an engine lobby: every setup
 * edit below is dispatched as a real `GameAction` through `applyAction`, so validation (dupe
 * names, room-full, role math) is engine-owned, never re-implemented here. Screens are dumb
 * renderers over this store + its `ui` slice (`prefs`/`ritual`/`ballot`/`interlude`).
 */

/** localStorage key for the persisted mid-game checkpoint (EXACT — `/play`'s "Resume last
 * game?" prompt keys off this too). Bump the version field, not this key, on shape changes. */
const STORAGE_KEY = 'sketchy:pnp:current';

/** P&P is always untimed (game-design.md §4.6 / this phase's pinned design) — timer effects
 * from `applyAction` are intentionally never acted on, and `timeout` is never dispatched. */
const PNP_SETTINGS: GameSettings = {
  maxPlayers: 20,
  undercoverCount: 1,
  mrWhiteCount: 0,
  specialRoles: [],
  packIds: [],
  difficulties: ['easy', 'medium', 'hard'],
  clueTimerSec: null,
  discussionTimerSec: null,
  voteTimerSec: null,
  mrWhiteFirstClueBan: true,
  eliminationReveal: 'role',
};

export interface PnpPrefs {
  /** Off by default: clues are spoken aloud, the app is just the turn tracker
   * (game-design.md §4.3). On: the turn-holder also types a note onto the clue board. */
  typedClues: boolean;
  /** Off by default: secret ballots pass the device around. On: one shared screen, host
   * tallies votes as the table points fingers (game-design.md §4.4). */
  openVote: boolean;
}

/** Deal ritual pass-around state for whichever player `currentRitualPlayer` derives as
 * current (game-design.md §4.2: "Pass to {name}" → "That's me" → press-and-hold reveal). */
export interface RitualState {
  /** The current player tapped "That's me". */
  confirmed: boolean;
  /** Press-and-hold (or a11y toggle) is actively revealing their word right now. */
  peeking: boolean;
}

/** Secret-ballot pass-around state for whichever voter `currentVoter` derives as current. */
export interface BallotState {
  confirmed: boolean;
  selectedTarget: string | null;
}

/**
 * A beat the UI must interrupt normal flow for, even though the underlying `GameState` has
 * already moved on (detected inside the dispatch core, see `detectInterlude`). Dismissed
 * explicitly via `dismissInterlude()` — never auto-cleared by a later dispatch, so a
 * fast-following action can never race it off screen before the host has seen it.
 */
export type InterludeKind = 'second_tie' | 'all_abstain' | 'wrong_guess';

/** The subset of the checkpoint that isn't `prefs` (kept as its own top-level checkpoint
 * field) — ritual/ballot/interlude are the moment-to-moment "where are we in this pass"
 * state that needs to survive a tab close mid-ritual or mid-ballot. */
interface PnpUiSlice {
  ritual: RitualState;
  ballot: BallotState;
  interlude: InterludeKind | null;
}

/** Shape written to `localStorage[STORAGE_KEY]` after every mutation (checkpoint, not an
 * event log — always the latest snapshot). `pairPool` is stored pair-id/word-only (no
 * `difficulty`): once a game has started, `settings.difficulties` can't change anyway
 * (lobby-only), so difficulty has already done its filtering job before this is written. */
interface PnpCheckpoint {
  version: 1;
  game: GameState;
  pairPool: DealtPair[];
  usedPairKeys: string[];
  prefs: PnpPrefs;
  ui: PnpUiSlice;
}

function defaultPrefs(): PnpPrefs {
  return { typedClues: false, openVote: false };
}

function defaultRitual(): RitualState {
  return { confirmed: false, peeking: false };
}

function defaultBallot(): BallotState {
  return { confirmed: false, selectedTarget: null };
}

// ---------------------------------------------------------------------------------------
// Selectors — pure functions over `GameState`, exported standalone so screens (and this
// file's own actions) share one derivation instead of re-deriving "whose turn is it" logic.
// All rely on the standing engine invariant that `state.players` stays in seat order.
// ---------------------------------------------------------------------------------------

/** The player the deal ritual is currently passing to: first in seat order who hasn't yet
 * seen their word. `null` outside `dealing` (the ritual only exists there) and once
 * everyone has acked. */
export function currentRitualPlayer(game: GameState): GamePlayer | null {
  if (game.phase !== 'dealing') return null;
  return game.players.find((p) => p.alive && !p.hasSeenWord) ?? null;
}

/** The current clue turn-holder, or `null` outside `clue`/`tiebreak_clue`. */
export function currentSpeaker(game: GameState): GamePlayer | null {
  if (game.phase !== 'clue' && game.phase !== 'tiebreak_clue') return null;
  if (game.turnSeat === null) return null;
  return currentTurnOrder(game)[game.turnSeat] ?? null;
}

/**
 * The secret-ballot pass-around's current voter: first eligible voter in seat order who
 * hasn't cast a ballot yet this vote. `null` outside `voting` — the phase guard matters:
 * closing a vote clears `game.votes` to `{}`, so without it this would "restart" at the
 * first voter the instant the last ballot lands (an infinite pass-around for any UI/loop
 * driving off this selector). Ghost: eliminated players stay eligible when
 * `settings.specialRoles` includes `'ghost'` — mirrors `eligibleVoterIds`
 * (packages/engine/src/reducers/vote.ts) exactly, so the pass-around/open-vote pnp UI never
 * silently skips a Ghost's ballot.
 */
export function currentVoter(game: GameState): GamePlayer | null {
  if (game.phase !== 'voting') return null;
  const ghostActive = game.settings.specialRoles.includes('ghost');
  return (
    game.players.find(
      (p) => !p.hasLeft && (p.alive || ghostActive) && !Object.hasOwn(game.votes, p.id),
    ) ?? null
  );
}

/** Every player still eligible to cast a ballot this vote (alive, hasn't left — OR
 * eliminated with Ghost enabled) — drives "N/M voted" and the open-vote tally
 * screen. */
export function eligibleVoters(game: GameState): GamePlayer[] {
  const ghostActive = game.settings.specialRoles.includes('ghost');
  return game.players.filter((p) => !p.hasLeft && (p.alive || ghostActive));
}

/** Valid vote targets: every alive player, restricted to `tiedPlayerIds` during a re-vote
 * (`revoteCount === 1`) — mirrors `applyCastVote`'s own validation (reducers/vote.ts). */
export function aliveTargets(game: GameState): GamePlayer[] {
  const alive = game.players.filter((p) => p.alive);
  if (game.revoteCount === 1 && game.tiedPlayerIds) {
    const tied = new Set(game.tiedPlayerIds);
    return alive.filter((p) => tied.has(p.id));
  }
  return alive;
}

/**
 * Reads an interlude out of a `voting → clue` or `mrwhite_guess → *` transition the engine
 * already resolved (data-model.md's `voteHistory`/`lastGuess` extensions carry everything
 * needed — no extra engine state required). Pure: same `(prev, next)` always yields the same
 * verdict, so it can run unconditionally inside the dispatch core.
 */
function detectInterlude(prev: GameState, next: GameState): InterludeKind | null {
  if (prev.phase === 'voting' && next.phase === 'clue' && next.pendingElimination === null) {
    const record = next.voteHistory[next.voteHistory.length - 1];
    if (record && record.eliminated === null) {
      return record.revote ? 'second_tie' : 'all_abstain';
    }
  }
  if (prev.phase === 'mrwhite_guess' && next.lastGuess?.correct === false) {
    return 'wrong_guess';
  }
  return null;
}

export interface PnpState {
  game: GameState | null;
  /** Transient — the last rejected dispatch's error code, cleared at the start of every
   * dispatch (so a stale error never lingers past the action that would have fixed it). */
  error: EngineErrorCode | null;
  pairPool: DealtPair[];
  usedPairKeys: string[];
  prefs: PnpPrefs;
  ritual: RitualState;
  ballot: BallotState;
  interlude: InterludeKind | null;
  /**
   * Not part of the checkpoint (deliberately — see the module doc comment on
   * `hydrateFromCheckpoint`): once the host manually edits the role steppers, further
   * roster changes stop auto-suggesting counts (`setRoleCounts` sets this permanently for
   * the rest of setup).
   */
  rolesTouched: boolean;

  /** Creates a fresh lobby-phase `GameState` with nobody seated yet
   * (`createGame(settings, [], seed, Date.now())`) and resets every other slice to its
   * default. Call once when `/play` starts a brand-new setup (not a resume). */
  initLobby: () => void;

  /** Seats a new player via a real `join` action (dupe-name/room-full validation is
   * engine-owned). Auto-suggests role counts from the new roster unless the host has
   * already touched the steppers this setup (`rolesTouched`). */
  addPlayer: (name: string) => void;
  /** Removes a seated player via `leave` (lobby-phase `leave` deletes the seat outright)
   * and re-suggests role counts under the same `rolesTouched` gate as `addPlayer`. */
  removePlayer: (id: string) => void;
  /** Host edits undercover/Mr. White counts directly; marks `rolesTouched` regardless of
   * whether the engine accepts the patch (an invalid attempt still counts as "touched"). */
  setRoleCounts: (patch: { undercoverCount?: number; mrWhiteCount?: number }) => void;
  setPackSelection: (packIds: string[]) => void;
  setDifficulties: (difficulties: Difficulty[]) => void;
  /** Host toggles the "Spice (optional roles)" section. Same `updateSettings` path
   * as every other lobby edit; engine validation (min-player requirements,
   * `isValidSpecialRoles`) is the only gate. */
  setSpecialRoles: (specialRoles: SpecialRole[]) => void;
  /** Draws the opening pair from `pairPool` and dispatches `start`. `pairPool` is supplied
   * by the caller — the setup screen builds it via `lib/pair-pool` (bundled or fetched)
   * before calling this. */
  startGame: (pairPool: PairPool) => void;

  setTypedClues: (value: boolean) => void;
  setOpenVote: (value: boolean) => void;

  /** Deal ritual: current player taps "That's me". */
  confirmPass: () => void;
  /** Press-and-hold (or a11y toggle) reveal of the current ritual player's word. */
  setPeeking: (peeking: boolean) => void;
  /** Dispatches `ackWord` for the derived ritual player, then resets ritual state so the
   * pass-around can move to whoever `currentRitualPlayer` derives next. */
  ackCurrent: () => void;

  /** Secret ballot pass-around: current voter taps "pass to me". */
  confirmVotePass: () => void;
  selectTarget: (id: string) => void;
  /** Dispatches `castVote` for the derived current voter against `ballot.selectedTarget`,
   * then resets ballot state for the next voter in the pass-around. No-ops if no target is
   * selected or there's no eligible voter left (vote already closed). */
  castBallot: () => void;
  /** Open-vote mode: host dispatches a ballot directly on behalf of `voterId` — no
   * pass-around, no ballot-state bookkeeping. */
  castOpenVote: (voterId: string, targetId: string) => void;

  dismissInterlude: () => void;

  /** Spoken-clue mode: advances the turn via `skipTurn` (host-authored). The frozen engine
   * has no "spoken clue" action, so every spoken turn is recorded as a skip — invisible to
   * players because the clue board (typed-mode only) is the sole place `(skipped)` renders. */
  nextSpeaker: () => void;
  /** Typed-clue mode: submits `text` as the derived `currentSpeaker`'s clue. No-ops outside
   * a clue-giving phase (nothing to submit as). */
  submitTypedClue: (text: string) => void;

  /** Host ends discussion early / dismisses the reveal sequence — both are `advancePhase`. */
  callVote: () => void;
  continueReveal: () => void;
  /** Dispatches `mrWhiteGuess` for `game.pendingElimination` (the only valid actor while
   * `phase === 'mrwhite_guess'`). No-ops if there's no pending elimination. */
  submitMrWhiteGuess: (text: string) => void;
  /** The Judge's tie-breaking call — dispatches `judgeDecide` for whichever
   * player holds `specialRole === 'judge'` (the only valid actor while
   * `phase === 'judge_decision'`). No-ops if nobody holds the role (shouldn't be
   * reachable — the engine only ever enters this phase when a Judge exists). */
  submitJudgeDecision: (targetId: string) => void;
  /** The Grudge's drag-down choice — dispatches `grudgeDrag` for
   * `game.pendingElimination` (the only valid actor while `phase === 'grudge_decision'`,
   * per the engine's own actor check). No-ops if there's no pending elimination. */
  submitGrudgeDrag: (targetId: string) => void;
  /** The Grudge's explicit "drag nobody" choice — the only way to reach that
   * outcome in pass-and-play (there's no timeout to fall back on). Dispatches `advancePhase`
   * as the host, resolving via the same deterministic default an online room's timeout uses. */
  dragNobody: () => void;
  /** Draws a fresh, de-duped pair from the stored pool and dispatches `rematch`; resets the
   * ritual/ballot/interlude slice for the new game (prefs carry over — they're host
   * preferences, not per-game state). */
  rematch: () => void;

  /** True while the copy.md §5 resume prompt should gate the restored game — set by a
   * successful `hydrateFromCheckpoint` of a MID-GAME checkpoint (a lobby-phase checkpoint
   * restores the setup screen silently; there's nothing to "resume"). Router state living
   * here rather than in React because the react-hooks compiler lints forbid both
   * setState-in-effect and ref-reads-in-render, and the flag is born inside a store
   * mutation anyway. */
  resumePromptPending: boolean;
  /** "Resume" choice on the prompt — just drops the gate. */
  dismissResumePrompt: () => void;

  /** Restores `game`/`pairPool`/`usedPairKeys`/`prefs`/ui-slice from the checkpoint.
   * SSR-safe (`false` when there's no `window`); `false` + removes the key on corrupt JSON
   * or an unrecognized `version`. Marks `rolesTouched: true` on a successful restore — a
   * resumed lobby's counts are whatever the host already set, never re-suggested. */
  hydrateFromCheckpoint: () => boolean;
  clearCheckpoint: () => void;
  /** Clears the checkpoint and starts over from a brand-new empty lobby ("Back to lobby"). */
  resetToSetup: () => void;
}

function readCheckpointRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function removeCheckpoint(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled — nothing to clean up.
  }
}

/** Type guard for a parsed checkpoint blob — corrupt/foreign JSON is treated as "no
 * checkpoint" rather than crashing `hydrateFromCheckpoint`. */
function isPnpCheckpoint(value: unknown): value is PnpCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PnpCheckpoint>;
  return v.version === 1 && typeof v.game === 'object' && v.game !== null && !!v.ui;
}

export const usePnpStore = create<PnpState>((set, get) => {
  /** Writes the full checkpoint from current state (try/catch like session-store: quota
   * exceeded / private mode degrades to in-memory-only, never crashes the game). */
  function persistCheckpoint(): void {
    if (typeof window === 'undefined') return;
    const s = get();
    if (!s.game) return;
    try {
      const checkpoint: PnpCheckpoint = {
        version: 1,
        game: s.game,
        pairPool: s.pairPool,
        usedPairKeys: s.usedPairKeys,
        prefs: s.prefs,
        ui: { ritual: s.ritual, ballot: s.ballot, interlude: s.interlude },
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoint));
    } catch {
      // Quota exceeded / private mode — the game still works in-memory for this tab.
    }
  }

  /** Applies a state patch and persists a checkpoint in the same beat — every mutating
   * action in this store (engine dispatches AND pure ui-slice toggles) funnels through
   * here, so localStorage never drifts out of sync with the live store. */
  function commit(patch: Partial<PnpState>): void {
    set(patch);
    persistCheckpoint();
  }

  /**
   * The ONE place `applyAction` is called (per this phase's pinned design). Builds the
   * action's `at` timestamp, runs it, records the result, detects interludes, and commits
   * (state + checkpoint) atomically with any `onSuccess` patch the caller needs bundled
   * into the same commit (e.g. resetting ritual state alongside an `ackWord` dispatch).
   * `onSuccess` is dropped on a rejection — a rejected `rematch` must not burn a used-pair
   * key, a rejected `castVote` must not clear the voter's in-progress ballot. Timer effects
   * are never acted on (P&P is always untimed) and `persistGame`/`revealRole` need no
   * handling beyond the checkpoint write `commit` already does.
   */
  function dispatch(action: GameAction, onSuccess?: Partial<PnpState>): ApplyResult {
    const prev = get().game;
    if (!prev) {
      throw new Error(
        'pnp-store: no active game — call initLobby() or hydrateFromCheckpoint() first',
      );
    }
    const result = applyAction(prev, action);
    const interlude = detectInterlude(prev, result.state);
    commit({
      game: result.state,
      error: result.error ?? null,
      ...(interlude ? { interlude } : {}),
      ...(result.error ? {} : onSuccess),
    });
    return result;
  }

  /** Re-suggests role counts from the current roster, unless the host has manually touched
   * the steppers this setup. Shared by `addPlayer`/`removePlayer`. No-ops on an empty
   * roster (`suggestRoleCounts(0)` is never valid role math — nothing useful to suggest). */
  function maybeSuggestRoleCounts(): void {
    const s = get();
    if (s.rolesTouched || !s.game || s.game.players.length === 0) return;
    const suggestion = suggestRoleCounts(s.game.players.length);
    dispatch({
      type: 'updateSettings',
      at: Date.now(),
      playerId: s.game.hostId,
      patch: suggestion,
    });
  }

  return {
    game: null,
    error: null,
    pairPool: [],
    usedPairKeys: [],
    prefs: defaultPrefs(),
    ritual: defaultRitual(),
    ballot: defaultBallot(),
    interlude: null,
    rolesTouched: false,
    resumePromptPending: false,

    initLobby: () => {
      const seed = crypto.randomUUID();
      const game = createGame(PNP_SETTINGS, [], seed, Date.now());
      commit({
        game,
        error: null,
        pairPool: [],
        usedPairKeys: [],
        prefs: defaultPrefs(),
        ritual: defaultRitual(),
        ballot: defaultBallot(),
        interlude: null,
        rolesTouched: false,
        resumePromptPending: false,
      });
    },

    addPlayer: (name) => {
      const s = get();
      if (!s.game) return;
      const wasEmpty = s.game.players.length === 0;
      const id = crypto.randomUUID();
      const seat = s.game.players.length;

      const result = dispatch({
        type: 'join',
        at: Date.now(),
        playerId: id,
        player: { id, name: name.trim(), avatar: defaultAvatar(seat) },
      });
      if (result.error) return;

      if (wasEmpty) {
        // Engine gap this store has to bridge: `createGame(settings, [], seed)` (this
        // phase's pinned P&P init) leaves `hostId: ''`, and `applyJoin` never assigns a
        // host — every OTHER engine caller seeds the host in as `players[0]` up front
        // (create-game.test.ts), so an empty-room join is a path the engine itself never
        // exercises. The first seated player becomes host by direct patch (no action
        // exists for this — `updateSettings`/`start`/etc. all require an existing host).
        commit({ game: { ...(get().game as GameState), hostId: id } });
      }

      maybeSuggestRoleCounts();
    },

    removePlayer: (id) => {
      const s = get();
      if (!s.game) return;
      dispatch({ type: 'leave', at: Date.now(), playerId: id });
      maybeSuggestRoleCounts();
    },

    setRoleCounts: (patch) => {
      const s = get();
      if (!s.game) return;
      // Touched even when the engine rejects the patch (deliberately NOT dispatch's
      // success-only channel): a failed manual edit still signals "the host wants manual
      // control" — silently re-suggesting over them right after an error would be worse.
      set({ rolesTouched: true });
      dispatch({ type: 'updateSettings', at: Date.now(), playerId: s.game.hostId, patch });
    },

    setPackSelection: (packIds) => {
      const s = get();
      if (!s.game) return;
      dispatch({
        type: 'updateSettings',
        at: Date.now(),
        playerId: s.game.hostId,
        patch: { packIds },
      });
    },

    setDifficulties: (difficulties) => {
      const s = get();
      if (!s.game) return;
      dispatch({
        type: 'updateSettings',
        at: Date.now(),
        playerId: s.game.hostId,
        patch: { difficulties },
      });
    },

    setSpecialRoles: (specialRoles) => {
      const s = get();
      if (!s.game) return;
      dispatch({
        type: 'updateSettings',
        at: Date.now(),
        playerId: s.game.hostId,
        patch: { specialRoles },
      });
    },

    startGame: (pool) => {
      const s = get();
      if (!s.game) return;
      const { pair, key } = drawPair(pool, []);
      const storedPool: DealtPair[] = pool.map(({ wordA, wordB, pairId }) => ({
        wordA,
        wordB,
        pairId,
      }));
      dispatch(
        { type: 'start', at: Date.now(), playerId: s.game.hostId, pair },
        { pairPool: storedPool, usedPairKeys: [key] },
      );
    },

    setTypedClues: (value) => {
      commit({ prefs: { ...get().prefs, typedClues: value } });
    },
    setOpenVote: (value) => {
      commit({ prefs: { ...get().prefs, openVote: value } });
    },

    confirmPass: () => {
      commit({ ritual: { ...get().ritual, confirmed: true } });
    },
    setPeeking: (peeking) => {
      commit({ ritual: { ...get().ritual, peeking } });
    },
    ackCurrent: () => {
      const s = get();
      if (!s.game) return;
      const player = currentRitualPlayer(s.game);
      if (!player) return;
      dispatch(
        { type: 'ackWord', at: Date.now(), playerId: player.id },
        { ritual: defaultRitual() },
      );
    },

    confirmVotePass: () => {
      commit({ ballot: { ...get().ballot, confirmed: true } });
    },
    selectTarget: (id) => {
      commit({ ballot: { ...get().ballot, selectedTarget: id } });
    },
    castBallot: () => {
      const s = get();
      if (!s.game || !s.ballot.selectedTarget) return;
      const voter = currentVoter(s.game);
      if (!voter) return;
      dispatch(
        { type: 'castVote', at: Date.now(), playerId: voter.id, targetId: s.ballot.selectedTarget },
        { ballot: defaultBallot() },
      );
    },
    castOpenVote: (voterId, targetId) => {
      const s = get();
      if (!s.game) return;
      dispatch({ type: 'castVote', at: Date.now(), playerId: voterId, targetId });
    },

    dismissInterlude: () => {
      commit({ interlude: null });
    },

    nextSpeaker: () => {
      const s = get();
      if (!s.game) return;
      dispatch({ type: 'skipTurn', at: Date.now(), playerId: s.game.hostId });
    },
    submitTypedClue: (text) => {
      const s = get();
      if (!s.game) return;
      const speaker = currentSpeaker(s.game);
      if (!speaker) return;
      dispatch({ type: 'submitClue', at: Date.now(), playerId: speaker.id, text });
    },

    callVote: () => {
      const s = get();
      if (!s.game) return;
      dispatch({ type: 'advancePhase', at: Date.now(), playerId: s.game.hostId });
    },
    continueReveal: () => {
      const s = get();
      if (!s.game) return;
      dispatch({ type: 'continueReveal', at: Date.now(), playerId: s.game.hostId });
    },
    submitMrWhiteGuess: (text) => {
      const s = get();
      if (!s.game || !s.game.pendingElimination) return;
      dispatch({ type: 'mrWhiteGuess', at: Date.now(), playerId: s.game.pendingElimination, text });
    },
    submitJudgeDecision: (targetId) => {
      const s = get();
      if (!s.game) return;
      const judge = s.game.players.find((p) => p.specialRole === 'judge');
      if (!judge) return;
      dispatch({ type: 'judgeDecide', at: Date.now(), playerId: judge.id, targetId });
    },
    submitGrudgeDrag: (targetId) => {
      const s = get();
      if (!s.game || !s.game.pendingElimination) return;
      dispatch({
        type: 'grudgeDrag',
        at: Date.now(),
        playerId: s.game.pendingElimination,
        targetId,
      });
    },
    dragNobody: () => {
      // P&P is always untimed (no `timeout` is ever dispatched — see PNP_SETTINGS' doc
      // comment above), so "drags nobody" (copy.md §3.2: a valid, ordinary outcome — not
      // just a liveness fallback) can ONLY be reached via the same host-escape-hatch path
      // `advancePhase` gives online rooms (`resolveGrudgeDecisionByDefault`,
      // reducers/cascade.ts). Dispatched as the host, same convention as `callVote`/
      // `continueReveal` above — P&P has no real per-player socket auth, one device drives
      // the whole table.
      const s = get();
      if (!s.game) return;
      dispatch({ type: 'advancePhase', at: Date.now(), playerId: s.game.hostId });
    },
    rematch: () => {
      const s = get();
      if (!s.game) return;
      const { pair, key } = drawPair(s.pairPool, s.usedPairKeys);
      dispatch(
        { type: 'rematch', at: Date.now(), playerId: s.game.hostId, pair },
        {
          usedPairKeys: [...s.usedPairKeys, key],
          ritual: defaultRitual(),
          ballot: defaultBallot(),
          interlude: null,
        },
      );
    },

    hydrateFromCheckpoint: () => {
      const raw = readCheckpointRaw();
      if (!raw) return false;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        removeCheckpoint();
        return false;
      }

      if (!isPnpCheckpoint(parsed)) {
        removeCheckpoint();
        return false;
      }

      set({
        game: parsed.game,
        pairPool: parsed.pairPool,
        usedPairKeys: parsed.usedPairKeys,
        prefs: parsed.prefs,
        ritual: parsed.ui.ritual,
        ballot: parsed.ui.ballot,
        interlude: parsed.ui.interlude,
        error: null,
        // A resumed setup/game is never re-suggested over — whatever role counts made it
        // into the checkpoint are the host's, touched or not (see the field's doc comment).
        rolesTouched: true,
        resumePromptPending: parsed.game.phase !== 'lobby',
      });
      return true;
    },

    dismissResumePrompt: () => {
      set({ resumePromptPending: false });
    },

    clearCheckpoint: () => {
      removeCheckpoint();
    },

    resetToSetup: () => {
      removeCheckpoint();
      set({ game: null });
      get().initLobby();
    },
  };
});

/** Standalone existence check (e.g. `/play`'s "Resume last game?" prompt) that doesn't
 * require touching the store's live state. SSR-safe. */
export function hasCheckpoint(): boolean {
  return readCheckpointRaw() !== null;
}
