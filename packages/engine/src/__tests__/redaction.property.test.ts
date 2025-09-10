import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { createGame } from '../create-game.js';
import { createRng } from '../rng.js';
import { redactFor } from '../redact-for.js';
import { makePlayer, makeSettings } from '../test-support.js';
import type { GameAction } from '../actions.js';
import type { GamePlayer, GameState } from '../types.js';

// Unique tokens (never substrings of any id/clue/name this driver generates) so a plain
// JSON.stringify scan for "does the other faction's word leak" is sound.
const CIV_TOKEN = 'XCIVX';
const UND_TOKEN = 'XUNDX';

/** Runs every redaction invariant against `state` for every viewer (each player + spectator). */
function checkRedactionInvariants(state: GameState): void {
  const gameOver = state.phase === 'game_over';
  const viewers: Array<string | 'spectator'> = [...state.players.map((p) => p.id), 'spectator'];

  for (const viewerId of viewers) {
    const redacted = redactFor(state, viewerId);
    const viewerRole =
      viewerId === 'spectator'
        ? null
        : (state.players.find((p) => p.id === viewerId)?.role ?? null);
    // The engine coin-flips which literal word (wordA/wordB) becomes the Civilian word
    // (data-model.md §1) — so "your own token" must be read off the ACTUAL resolved pair,
    // never assumed from which token was passed in as wordA vs wordB.
    const ownToken =
      viewerRole === 'civilian'
        ? state.pair.civilianWord
        : viewerRole === 'undercover'
          ? state.pair.undercoverWord
          : null;
    const forbidden = [CIV_TOKEN, UND_TOKEN].filter((t) => t !== ownToken);

    // Batched into as few `expect()` calls as possible (this runs after EVERY accepted
    // action, for every viewer, across 1,000 games — assertion overhead adds up fast).
    let ok = true;
    let reason = '';

    if (!gameOver) {
      // Scoped to `players` (the only place a word ever appears pre-game_over, since `pair`
      // itself is asserted null right below) — much cheaper than stringifying everything.
      const json = JSON.stringify(redacted.players);
      for (const token of forbidden) {
        if (json.includes(token)) {
          ok = false;
          reason = `other faction word "${token}" leaked to viewer ${viewerId}`;
        }
      }
      if (redacted.pair !== null) {
        ok = false;
        reason = `pair visible pre-game_over to viewer ${viewerId}`;
      }
      if (redacted.voteHistory.length !== 0) {
        ok = false;
        reason = `voteHistory visible pre-game_over to viewer ${viewerId}`;
      }
    }

    // Any living non-self player's role/specialRole must be hidden (unless game_over).
    if (
      !gameOver &&
      !redacted.players.every(
        (rp) => rp.id === viewerId || !rp.alive || (rp.role === null && rp.specialRole === null),
      )
    ) {
      ok = false;
      reason = `a living non-self role leaked to viewer ${viewerId}`;
    }

    // Only the viewer's own ballot (if any) is present; never another player's.
    if (!Object.keys(redacted.votes).every((voterId) => voterId === viewerId)) {
      ok = false;
      reason = `another player's ballot leaked to viewer ${viewerId}`;
    }

    if (redacted.seed !== '') {
      ok = false;
      reason = `seed leaked to viewer ${viewerId}`;
    }

    expect(ok, reason).toBe(true);
  }
}

/** Dry-run probe (never mutates the driver's real state): an eliminated player's action is
 * always rejected, regardless of what they attempt. */
function checkEliminatedPlayersCantAct(state: GameState): void {
  const eliminated = state.players.find((p) => !p.alive);
  if (!eliminated) return;

  if (state.phase === 'voting') {
    const anyAliveOther = state.players.find((p) => p.alive && p.id !== eliminated.id);
    if (anyAliveOther) {
      const result = applyAction(state, {
        type: 'castVote',
        at: 0,
        playerId: eliminated.id,
        targetId: anyAliveOther.id,
      });
      expect(result.error).toBeDefined();
      expect(result.state).toBe(state);
    }
  }
  if (state.phase === 'clue' || state.phase === 'tiebreak_clue') {
    const result = applyAction(state, {
      type: 'submitClue',
      at: 0,
      playerId: eliminated.id,
      text: 'probe',
    });
    expect(result.error).toBeDefined();
    expect(result.state).toBe(state);
  }
}

/** Role counts (assigned once at deal time, immutable afterward) always match settings. */
function checkRoleCountsMatchSettings(state: GameState): void {
  if (state.phase === 'lobby') return;
  const uc = state.players.filter((p) => p.role === 'undercover').length;
  const mw = state.players.filter((p) => p.role === 'mrwhite').length;
  expect(uc).toBe(state.settings.undercoverCount);
  expect(mw).toBe(state.settings.mrWhiteCount);
}

let clueCounter = 0;

/** Plays one random-but-legal game to completion (or a safety cap), running every invariant
 * check after every accepted action. `driverSeed` makes each of the 1,000 runs reproducible. */
function runRandomGame(driverSeed: string): void {
  const rng = createRng(driverSeed);
  const n = 3 + rng.int(6); // 3..8 players
  const roleCounts =
    n < 5
      ? { undercoverCount: 1, mrWhiteCount: 0 }
      : { undercoverCount: 1 + rng.int(1), mrWhiteCount: 1 };
  const settings = makeSettings({
    ...roleCounts,
    maxPlayers: n,
    // Fixed to 'role' (not randomized): with 'word_and_role' an eliminated OPPOSING-faction
    // player's word is intentionally revealed pre-game_over — a deliberate publication, not
    // a leak. Fixing the setting keeps "the other faction's word never appears" unambiguous;
    // the word_and_role branch is covered directly in redact-for.test.ts instead.
    eliminationReveal: 'role',
  });
  const players: GamePlayer[] = Array.from({ length: n }, (_, i) =>
    makePlayer({ id: `p${i}`, seat: i }),
  );

  let state = createGame(settings, players, `game-seed-${driverSeed}`, 0);
  let at = 1;

  function dispatch(action: GameAction): void {
    const result = applyAction(state, action);
    if (result.error) {
      throw new Error(
        `random game ${driverSeed}: unexpected rejection ${action.type} -> ${result.error}`,
      );
    }
    state = result.state;
    at += 1;
    checkRedactionInvariants(state);
    checkRoleCountsMatchSettings(state);
    checkEliminatedPlayersCantAct(state);
  }

  checkRedactionInvariants(state); // lobby, before anything happens
  dispatch({
    type: 'start',
    at,
    playerId: state.hostId,
    pair: { wordA: CIV_TOKEN, wordB: UND_TOKEN, pairId: null },
  });
  const dealtPair = state.pair;

  let safety = 0;
  while (state.phase !== 'game_over') {
    safety += 1;
    if (safety > 500) throw new Error(`random game ${driverSeed}: runaway simulation`);
    expect(state.pair).toEqual(dealtPair); // exactly one pair in play, for the whole game

    if (state.phase === 'dealing') {
      const notYetAcked = state.players.find((p) => p.alive && !p.hasSeenWord);
      if (notYetAcked && rng.bool()) {
        dispatch({ type: 'ackWord', at, playerId: notYetAcked.id });
      } else {
        dispatch({ type: 'timeout', at, phase: 'dealing' });
      }
    } else if (state.phase === 'clue' || state.phase === 'tiebreak_clue') {
      const order =
        state.phase === 'tiebreak_clue'
          ? state.players.filter((p) => (state.tiedPlayerIds ?? []).includes(p.id))
          : state.players.filter((p) => p.alive);
      const holder = order[state.turnSeat as number] as GamePlayer;
      if (rng.next() < 0.15) {
        dispatch({ type: 'skipTurn', at, playerId: state.hostId });
      } else if (rng.next() < 0.05) {
        dispatch({ type: 'timeout', at, phase: state.phase });
      } else {
        clueCounter += 1;
        dispatch({ type: 'submitClue', at, playerId: holder.id, text: `hint${clueCounter}` });
      }
    } else if (state.phase === 'discussion') {
      if (rng.bool()) {
        dispatch({ type: 'advancePhase', at, playerId: state.hostId });
      } else {
        dispatch({ type: 'timeout', at, phase: 'discussion' });
      }
    } else if (state.phase === 'voting') {
      const voters = state.players.filter((p) => p.alive && !p.hasLeft);
      const tied = state.tiedPlayerIds;
      let anyVoted = false;
      for (const voter of voters) {
        if (rng.next() < 0.2) continue; // simulate an abstention -> forces a timeout close
        const candidates =
          state.revoteCount === 1 && tied
            ? state.players.filter((p) => tied.includes(p.id) && p.id !== voter.id)
            : state.players.filter((p) => p.alive && p.id !== voter.id);
        if (candidates.length === 0) continue;
        const target = candidates[rng.int(candidates.length)] as GamePlayer;
        dispatch({ type: 'castVote', at, playerId: voter.id, targetId: target.id });
        anyVoted = true;
        if ((state.phase as string) !== 'voting') break; // vote closed already
      }
      if ((state.phase as string) === 'voting') {
        dispatch({ type: 'timeout', at, phase: 'voting' });
      }
      void anyVoted;
    } else if (state.phase === 'reveal') {
      if (rng.bool()) {
        dispatch({ type: 'continueReveal', at, playerId: state.hostId });
      } else {
        dispatch({ type: 'timeout', at, phase: 'reveal' });
      }
    } else if (state.phase === 'mrwhite_guess') {
      const correct = rng.bool();
      const text = correct ? state.pair.civilianWord : 'definitely-wrong';
      if (rng.next() < 0.1) {
        dispatch({ type: 'timeout', at, phase: 'mrwhite_guess' });
      } else {
        dispatch({ type: 'mrWhiteGuess', at, playerId: state.pendingElimination as string, text });
      }
    }
  }

  checkRedactionInvariants(state); // final game_over state too
}

describe('redactFor property test — 1,000 randomized games', () => {
  it('never leaks the other faction word, a living non-self role, another ballot, the seed, or the pair pre-game_over', () => {
    for (let i = 0; i < 1000; i++) {
      runRandomGame(`prop-${i}`);
    }
  }, 30_000);
});
