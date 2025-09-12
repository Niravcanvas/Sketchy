import type { AvatarConfig, GameSettings, Phase } from './types.js';

/**
 * A word pair as drawn by the host environment (server or pass-and-play client) — the
 * engine cannot query word packs itself (purity rule, conventions.md §1), so `start` and
 * `rematch` carry the pair IN the action. The engine's own contribution is flipping which
 * side is the Civilian word (`rng.bool()` at deal time) — see src/reducers/deal.ts.
 */
export interface DealtPair {
  wordA: string;
  wordB: string;
  /** Null when the pair didn't come from a persisted pack (e.g. ad-hoc pass-and-play list). */
  pairId: string | null;
}

/** Every action carries the host environment's clock reading — the engine itself never
 * reads a clock (purity rule). All `phaseEndsAt` values are computed as `action.at + N*1000`. */
interface ActionBase {
  at: number;
}

/** Player-originated actions additionally carry the acting player's id. */
interface PlayerActionBase extends ActionBase {
  playerId: string;
}

/**
 * A new player joins the room. Lobby-phase only. `playerId` (the actor) is the joining
 * player's own id, duplicated onto `player.id` — the host environment mints the id before
 * dispatching. Rejected with `room_full` / `name_taken_in_room` (data-model.md §3 bounds;
 * game-design.md §5).
 */
export interface JoinAction extends PlayerActionBase {
  type: 'join';
  player: { id: string; name: string; avatar: AvatarConfig };
}

/**
 * A player leaves voluntarily (≠ disconnect — that's `presence`). In `lobby` this removes
 * their seat outright; mid-game it only sets `hasLeft`/`connected: false` — actual
 * elimination is deferred to the next phase boundary (api-contract.md §2.1 `room:leave`).
 */
export interface LeaveAction extends PlayerActionBase {
  type: 'leave';
}

/** Toggles the actor's lobby ready flag (api-contract.md §2.1 `lobby:ready`). Lobby only. */
export interface SetReadyAction extends PlayerActionBase {
  type: 'setReady';
  ready: boolean;
}

/**
 * Host edits room settings (api-contract.md §2.1 `lobby:settings`). Host + lobby only; the
 * patch is merged onto `settings` and the RESULT is validated as a whole (game-design.md
 * §7 role-math bounds) — an invalid merge leaves `settings` untouched and returns
 * `validation`.
 */
export interface UpdateSettingsAction extends PlayerActionBase {
  type: 'updateSettings';
  patch: Partial<GameSettings>;
}

/** Host removes a player from the lobby (api-contract.md §2.1 `lobby:kick`). Host + lobby
 * only; cannot target self. Seats compact to stay contiguous/ordered afterward. */
export interface KickAction extends PlayerActionBase {
  type: 'kick';
  targetId: string;
}

/**
 * Host starts the game (api-contract.md §2.1 `game:start`). Host + lobby only; re-validates
 * role math against the ACTUAL player count (not just `maxPlayers`). Carries the freshly
 * drawn `pair` — the engine deals roles/words from it (src/reducers/deal.ts) and enters
 * `dealing`.
 */
export interface StartAction extends PlayerActionBase {
  type: 'start';
  pair: DealtPair;
}

/**
 * "I've seen my word" (api-contract.md §2.1 `deal:ack`). Dealing-phase only; idempotent
 * (re-acking is a no-op, not an error). Once every alive player has acked, the engine
 * enters clue round 1 — `timeout{phase:'dealing'}` does the same via auto-ack.
 */
export interface AckWordAction extends PlayerActionBase {
  type: 'ackWord';
}

/**
 * The current turn-holder gives their clue (api-contract.md §2.1 `clue:submit`). Valid in
 * `clue` and `tiebreak_clue`. Validated: turn (`not_your_turn`), 1–40 trimmed chars
 * (`validation`), not equal to either pair word (`clue_is_secret_word`), and not a
 * case-insensitive repeat of any prior non-skipped clue this game (`clue_repeated`) —
 * game-design.md §7 "Clue uniqueness".
 */
export interface SubmitClueAction extends PlayerActionBase {
  type: 'submitClue';
  text: string;
}

/**
 * Host skips a stalled clue turn (api-contract.md §2.1 `turn:skip`). Host-only, `clue` /
 * `tiebreak_clue` only. Records `SKIPPED_CLUE` as the CURRENT turn-holder's clue (the actor
 * is the host, not the skipped player) and advances the turn exactly like `submitClue`.
 */
export interface SkipTurnAction extends PlayerActionBase {
  type: 'skipTurn';
}

/**
 * Host advances the phase early (api-contract.md §2.1 `phase:advance`). Host-only. From
 * `discussion` → `voting`. From `reveal` → identical to `continueReveal` (dismisses the
 * reveal sequence). Any other phase → `wrong_phase`.
 */
export interface AdvancePhaseAction extends PlayerActionBase {
  type: 'advancePhase';
}

/**
 * Host dismisses the reveal sequence (api-contract.md §2.1 is `phase:advance`'s reveal
 * behavior surfaced as its own intent for clarity — data-model.md §3 lists it as a
 * distinct action). Host-only, `reveal` only. Routes to Mr. White's guess window if the
 * eliminated player was Mr. White, else resolves departures/win-check/next round.
 */
export interface ContinueRevealAction extends PlayerActionBase {
  type: 'continueReveal';
}

/**
 * An alive, non-left voter casts (or changes) their secret ballot (api-contract.md §2.1
 * `vote:cast`). `voting` only. Target must be alive and not the voter; during a re-vote
 * (`revoteCount === 1`) the target must additionally be one of `tiedPlayerIds`. Re-casting
 * the SAME target as your current ballot is a harmless no-op (`already_voted`) rather than
 * a state change — game-design.md §8 "Simultaneity".
 */
export interface CastVoteAction extends PlayerActionBase {
  type: 'castVote';
  targetId: string;
}

/**
 * The just-eliminated Mr. White's single guess at the Civilians' word (api-contract.md
 * §2.1 `mrwhite:guess`). `mrwhite_guess` only; actor must be `pendingElimination`. Matched
 * case/diacritic-insensitive, trimmed (game-design.md §6.6). Correct → instant Mr. White
 * win; wrong → the standing elimination resolves normally.
 */
export interface MrWhiteGuessAction extends PlayerActionBase {
  type: 'mrWhiteGuess';
  text: string;
}

/**
 * Host starts another game with the same room (api-contract.md §2.1 `game:rematch`).
 * Host + `game_over` only. Players who `hasLeft` are dropped (seats compacted); everyone
 * else keeps their seat/settings/scoreboard. Carries a fresh `pair`, dealt immediately —
 * the engine goes straight back to `dealing`.
 */
export interface RematchAction extends PlayerActionBase {
  type: 'rematch';
  pair: DealtPair;
}

/**
 * Host uses their once-per-phase +60s (game-design.md §6.3 discussion timer; generalized
 * to any timed phase). Host-only. Requires an active deadline (`phaseEndsAt !== null`) not
 * already extended this phase, else `validation`.
 */
export interface ExtendTimerAction extends PlayerActionBase {
  type: 'extendTimer';
}

/**
 * Judge special-role tie-breaking decision (api-contract.md §2.1 `special:judge`).
 * `judge_decision` phase only; the actor must hold `specialRole === 'judge'` (alive OR
 * eliminated — research/03: the Judge "stays active even after she herself is eliminated");
 * `targetId` must be one of `tiedPlayerIds`. Resolves exactly like a clean-plurality vote
 * close (`reducers/vote.ts` `applyJudgeDecide`).
 */
export interface JudgeDecideAction extends PlayerActionBase {
  type: 'judgeDecide';
  targetId: string;
}

/**
 * Grudge special-role drag-down choice (api-contract.md §2.1 `special:grudge`).
 * `grudge_decision` phase only; the actor must BE the just-revealed Grudge
 * (`state.pendingElimination`) and hold `specialRole === 'grudge'`; `targetId` must name a
 * currently ALIVE player. Resolves via `reducers/cascade.ts` `applyGrudgeDrag` — chained
 * exactly like a Lovebirds fall (their own Lovebirds partner, if any, cascades too).
 */
export interface GrudgeDragAction extends PlayerActionBase {
  type: 'grudgeDrag';
  targetId: string;
}

/**
 * Server-originated phase timeout — no actor, no authority check. `phase` is the phase the
 * host environment's timer was scheduled for; if it no longer matches `state.phase` the
 * timer was stale (the phase already moved on) and is rejected `wrong_phase` — harmless,
 * since stale timers are an expected race (game-design.md §8 "Clocks").
 */
export interface TimeoutAction extends ActionBase {
  type: 'timeout';
  phase: Phase;
}

/**
 * Server-originated connection state change (api-contract.md §8 resilience). No actor
 * validation — `playerId` here names the SUBJECT of the presence change, not an acting
 * player. Unknown id → `validation`. Never touches `alive`/turn order (full disconnect
 * resilience — grace windows, auto-skip, host migration — lives in the host environment,
 * not here).
 */
export interface PresenceAction extends ActionBase {
  playerId: string;
  type: 'presence';
  connected: boolean;
}

/**
 * Host migration (game-design.md §8 "Host disconnect → migration"). Reassigns
 * `hostId` to `newHostId`. Two origins, both decided by the host environment, never the
 * engine: (1) server-originated when the disconnected host's grace window expires — the
 * server picks the longest-connected alive player; (2) the current host's explicit
 * hand-back via the player-card action (api-contract.md §2.1 `host:transfer`). Like
 * `presence`/`timeout` there is NO actor authority check here — the SERVER decides both
 * whether migration is allowed (host-only for the explicit path) and who inherits;
 * the engine only validates that `newHostId` names a real seated player (else `validation`)
 * and applies the swap. Re-assigning to the current host is a harmless no-op. Never
 * touches `alive`/turn order.
 */
export interface MigrateHostAction extends ActionBase {
  type: 'migrateHost';
  newHostId: string;
}

/**
 * `GameAction` — the discriminated union `applyAction` (data-model.md §3) accepts as its
 * single entry point. One member per client intent in api-contract.md §2.1, plus the two
 * server-originated actions (`timeout`, `presence`). `judgeDecide` exists for the Judge
 * special role; `grudgeDrag` exists for the Grudge special role.
 */
export type GameAction =
  | JoinAction
  | LeaveAction
  | SetReadyAction
  | UpdateSettingsAction
  | KickAction
  | StartAction
  | AckWordAction
  | SubmitClueAction
  | SkipTurnAction
  | AdvancePhaseAction
  | ContinueRevealAction
  | CastVoteAction
  | MrWhiteGuessAction
  | RematchAction
  | ExtendTimerAction
  | JudgeDecideAction
  | GrudgeDragAction
  | TimeoutAction
  | PresenceAction
  | MigrateHostAction;
