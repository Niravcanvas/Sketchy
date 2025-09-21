import { describe, expect, it } from 'vitest';
import { applyAction } from '../apply-action.js';
import { SKIPPED_CLUE } from '../constants.js';
import { makePlayer, makeSettings, makeState } from '../test-support.js';
import type { GamePlayer, GameState } from '../types.js';
import { enterNextClueRound } from './clue.js';

// Base fixture: p0 civilian, p1 civilian, p2 undercover, p3 mrwhite; clue phase, turnSeat 0.
function clueState() {
  return makeState({
    phase: 'clue',
    round: 1,
    turnSeat: 0,
    hostId: 'p0',
    pair: { civilianWord: 'Coffee', undercoverWord: 'Tea', pairId: 'p1' },
  });
}

describe('submitClue', () => {
  it('rejects outside clue/tiebreak_clue (wrong_phase)', () => {
    const state = { ...clueState(), phase: 'discussion' as const };
    const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p0', text: 'hot' });
    expect(result.error).toBe('wrong_phase');
    expect(result.state).toBe(state);
  });

  it('rejects when the actor is not the current turn-holder (not_your_turn)', () => {
    const state = clueState();
    const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p1', text: 'hot' });
    expect(result.error).toBe('not_your_turn');
    expect(result.state).toBe(state);
  });

  it('rejects empty (post-trim) text (validation)', () => {
    const state = clueState();
    const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p0', text: '   ' });
    expect(result.error).toBe('validation');
  });

  it('rejects text over CLUE_MAX_LEN (validation)', () => {
    const state = clueState();
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1,
      playerId: 'p0',
      text: 'x'.repeat(41),
    });
    expect(result.error).toBe('validation');
  });

  it('accepts exactly CLUE_MAX_LEN characters', () => {
    const state = clueState();
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1,
      playerId: 'p0',
      text: 'x'.repeat(40),
    });
    expect(result.error).toBeUndefined();
  });

  it('rejects a clue equal to the civilian word, case/whitespace-insensitively (clue_is_secret_word)', () => {
    const state = clueState();
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1,
      playerId: 'p0',
      text: '  COFFEE  ',
    });
    expect(result.error).toBe('clue_is_secret_word');
  });

  it('rejects a clue equal to the undercover word (clue_is_secret_word)', () => {
    const state = clueState();
    const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p0', text: 'tea' });
    expect(result.error).toBe('clue_is_secret_word');
  });

  it('rejects a case-insensitive repeat of a prior clue this game (clue_repeated)', () => {
    const state = { ...clueState(), clues: [{ round: 1, playerId: 'p3', text: 'Hot', mimed: false }] };
    const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p0', text: 'HOT' });
    expect(result.error).toBe('clue_repeated');
  });

  it('rejects a repeat across rounds (not just within the current round)', () => {
    const state = {
      ...clueState(),
      round: 3,
      clues: [{ round: 1, playerId: 'p3', text: 'brown', mimed: false }],
    };
    const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p0', text: 'Brown' });
    expect(result.error).toBe('clue_repeated');
  });

  it('does NOT treat the skip marker as a repeat', () => {
    const state = {
      ...clueState(),
      clues: [{ round: 1, playerId: 'p3', text: SKIPPED_CLUE, mimed: false }],
    };
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1,
      playerId: 'p0',
      text: SKIPPED_CLUE,
    });
    expect(result.error).toBeUndefined();
  });

  it('appends the clue and advances the turn, re-arming the per-turn timer', () => {
    const state = { ...clueState(), settings: { ...clueState().settings, clueTimerSec: 60 } };
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1000,
      playerId: 'p0',
      text: 'hot',
    });
    expect(result.error).toBeUndefined();
    expect(result.state.clues).toEqual([{ round: 1, playerId: 'p0', text: 'hot', mimed: false }]);
    expect(result.state.turnSeat).toBe(1);
    expect(result.state.phaseEndsAt).toBe(1000 + 60_000);
    expect(result.effects).toEqual([{ type: 'startTimer', endsAt: 1000 + 60_000 }]);
  });

  it('clears the timer when re-arming an untimed clue phase', () => {
    const state = { ...clueState(), settings: { ...clueState().settings, clueTimerSec: null } };
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1000,
      playerId: 'p0',
      text: 'hot',
    });
    expect(result.state.phaseEndsAt).toBeNull();
    expect(result.effects).toEqual([{ type: 'clearTimer' }]);
  });

  it('transitions clue -> discussion after the last speaker, with the discussion timer', () => {
    const state = { ...clueState(), turnSeat: 3 }; // p3 (mrwhite) is the last of 4 alive players
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1000,
      playerId: 'p3',
      text: 'bluff',
    });
    expect(result.state.phase).toBe('discussion');
    expect(result.state.turnSeat).toBeNull();
    expect(result.state.phaseEndsAt).toBe(1000 + 120_000); // default discussionTimerSec
    expect(result.effects).toEqual([{ type: 'startTimer', endsAt: 1000 + 120_000 }]);
  });

  it('transitions to an untimed discussion when discussionTimerSec is null', () => {
    const state = {
      ...clueState(),
      turnSeat: 3,
      settings: { ...clueState().settings, discussionTimerSec: null },
    };
    const result = applyAction(state, {
      type: 'submitClue',
      at: 1000,
      playerId: 'p3',
      text: 'bluff',
    });
    expect(result.state.phase).toBe('discussion');
    expect(result.state.phaseEndsAt).toBeNull();
    expect(result.effects).toEqual([{ type: 'clearTimer' }]);
  });

  it('only considers ALIVE players in turn order (a dead seat is skipped)', () => {
    const state = clueState();
    const withDead = {
      ...state,
      players: state.players.map((p) =>
        p.id === 'p1' ? { ...p, alive: false, eliminatedRound: 0 } : p,
      ),
    };
    // Alive order is now p0, p2, p3 -> after p0 speaks, turnSeat should point at p2.
    const result = applyAction(withDead, {
      type: 'submitClue',
      at: 1,
      playerId: 'p0',
      text: 'hot',
    });
    expect(result.state.turnSeat).toBe(1);
  });

  describe('tiebreak_clue turn order (tied players only, in seat order)', () => {
    function tiebreakState() {
      return {
        ...clueState(),
        phase: 'tiebreak_clue' as const,
        turnSeat: 0,
        tiedPlayerIds: ['p1', 'p3'],
        revoteCount: 0,
      };
    }

    it('rejects a tied-out player attempting to speak out of turn', () => {
      const state = tiebreakState();
      const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p3', text: 'hot' });
      expect(result.error).toBe('not_your_turn');
    });

    it('advances through just the tied players', () => {
      const state = tiebreakState();
      const result = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p1', text: 'hot' });
      expect(result.state.turnSeat).toBe(1);
      expect(result.state.phase).toBe('tiebreak_clue');
    });

    it('last tied speaker -> re-vote "voting" with revoteCount 1, using voteTimerSec', () => {
      const state = { ...tiebreakState(), turnSeat: 1 };
      const result = applyAction(state, {
        type: 'submitClue',
        at: 1000,
        playerId: 'p3',
        text: 'cold',
      });
      expect(result.state.phase).toBe('voting');
      expect(result.state.revoteCount).toBe(1);
      expect(result.state.tiedPlayerIds).toEqual(['p1', 'p3']);
      expect(result.state.phaseEndsAt).toBe(1000 + 45_000); // default voteTimerSec
    });

    it('last tied speaker -> untimed re-vote when voteTimerSec is null', () => {
      const state = {
        ...tiebreakState(),
        turnSeat: 1,
        settings: { ...clueState().settings, voteTimerSec: null },
      };
      const result = applyAction(state, {
        type: 'submitClue',
        at: 1000,
        playerId: 'p3',
        text: 'cold',
      });
      expect(result.state.phase).toBe('voting');
      expect(result.state.phaseEndsAt).toBeNull();
      expect(result.effects).toEqual([{ type: 'clearTimer' }]);
    });
  });
});

describe('skipTurn', () => {
  it('rejects outside clue/tiebreak_clue (wrong_phase)', () => {
    const state = { ...clueState(), phase: 'voting' as const };
    const result = applyAction(state, { type: 'skipTurn', at: 1, playerId: 'p0' });
    expect(result.error).toBe('wrong_phase');
  });

  it('rejects a non-host actor (not_host)', () => {
    const state = clueState();
    const result = applyAction(state, { type: 'skipTurn', at: 1, playerId: 'p1' });
    expect(result.error).toBe('not_host');
  });

  it("records the skip marker as the CURRENT turn-holder's clue (not the host's)", () => {
    const state = clueState(); // turnSeat 0 -> p0 is the turn-holder; host is also p0 here
    const result = applyAction(state, { type: 'skipTurn', at: 1, playerId: 'p0' });
    expect(result.state.clues).toEqual([
      { round: 1, playerId: 'p0', text: SKIPPED_CLUE, mimed: false },
    ]);
    expect(result.state.turnSeat).toBe(1);
  });

  it("host can skip a DIFFERENT player's turn", () => {
    const state = { ...clueState(), turnSeat: 1 }; // p1's turn; p0 is host
    const result = applyAction(state, { type: 'skipTurn', at: 1, playerId: 'p0' });
    expect(result.state.clues).toEqual([
      { round: 1, playerId: 'p1', text: SKIPPED_CLUE, mimed: false },
    ]);
  });
});

describe('timeout{clue|tiebreak_clue}', () => {
  it('skips the current turn-holder exactly like skipTurn', () => {
    const state = clueState();
    const result = applyAction(state, { type: 'timeout', at: 1, phase: 'clue' });
    expect(result.state.clues).toEqual([
      { round: 1, playerId: 'p0', text: SKIPPED_CLUE, mimed: false },
    ]);
    expect(result.state.turnSeat).toBe(1);
  });

  it('works during tiebreak_clue too', () => {
    const state = {
      ...clueState(),
      phase: 'tiebreak_clue' as const,
      tiedPlayerIds: ['p1', 'p3'],
      turnSeat: 0,
    };
    const result = applyAction(state, { type: 'timeout', at: 1, phase: 'tiebreak_clue' });
    expect(result.state.clues).toEqual([
      { round: 1, playerId: 'p1', text: SKIPPED_CLUE, mimed: false },
    ]);
  });
});

// --- The Mime special role (room-wide setting, re-derived every round) --------

describe('enterNextClueRound — Mime derivation (phase 13)', () => {
  function dealtState(overrides: Partial<GameState> = {}): GameState {
    const players: GamePlayer[] = [
      makePlayer({ id: 'p0', seat: 0, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p1', seat: 1, role: 'civilian', word: 'sun' }),
      makePlayer({ id: 'p2', seat: 2, role: 'undercover', word: 'moon' }),
      makePlayer({ id: 'p3', seat: 3, role: 'mrwhite', word: null }),
    ];
    return makeState({
      phase: 'dealing',
      round: 0,
      hostId: 'p0',
      players,
      settings: makeSettings({ specialRoles: ['mime'] }),
      ...overrides,
    });
  }

  it('mimeId is null when the mime setting is off', () => {
    const state = dealtState({ settings: makeSettings({ specialRoles: [] }) });
    const result = enterNextClueRound(state, 1);
    expect(result.state.mimeId).toBeNull();
  });

  it('mimeId names one of the ALIVE players when mime is enabled', () => {
    const state = dealtState();
    const result = enterNextClueRound(state, 1);
    expect(['p0', 'p1', 'p2', 'p3']).toContain(result.state.mimeId);
  });

  it('never picks an eliminated player as the Mime', () => {
    const state = dealtState({
      players: dealtState().players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const result = enterNextClueRound({ ...state, seed: `mime-alive-only:${seedIdx}` }, 1);
      expect(result.state.mimeId).not.toBe('p2');
    }
  });

  it('is deterministic: same seed + same round -> same pick every time', () => {
    const state = dealtState({ seed: 'mime-determinism' });
    const picks = Array.from({ length: 5 }, () => enterNextClueRound(state, 1).state.mimeId);
    expect(new Set(picks).size).toBe(1);
  });

  it('is re-derived per round (not sticky) — different rounds CAN draw different mimes', () => {
    // Sweep several seeds and assert at least one shows the round-1 and round-2 picks
    // differing, proving the round number genuinely participates in the draw (not just
    // gamesPlayedInRoom/seed).
    let sawADifference = false;
    for (let seedIdx = 0; seedIdx < 20; seedIdx++) {
      const state = dealtState({ seed: `mime-per-round:${seedIdx}` });
      const round1 = enterNextClueRound(state, 1).state;
      const round2 = enterNextClueRound({ ...round1, round: 1 }, 2).state;
      if (round1.mimeId !== round2.mimeId) sawADifference = true;
    }
    expect(sawADifference).toBe(true);
  });

  it('mimed clue tracking: the clue-board note is set for the current mime, cleared for everyone else', () => {
    const state = { ...dealtState(), mimeId: 'p2', phase: 'clue' as const, turnSeat: 2, round: 1 };
    const mimeClue = applyAction(state, { type: 'submitClue', at: 1, playerId: 'p2', text: 'gesture' });
    expect(mimeClue.state.clues.at(-1)).toMatchObject({ playerId: 'p2', mimed: true });

    const notMimeClue = applyAction(mimeClue.state, {
      type: 'submitClue',
      at: 2,
      playerId: 'p3',
      text: 'spoken',
    });
    expect(notMimeClue.state.clues.at(-1)).toMatchObject({ playerId: 'p3', mimed: false });
  });

  it('a skipped turn is NEVER marked mimed, even for the current Mime', () => {
    const state = {
      ...dealtState(),
      mimeId: 'p0',
      phase: 'clue' as const,
      turnSeat: 0,
      round: 1,
      hostId: 'p0',
    };
    const result = applyAction(state, { type: 'skipTurn', at: 1, playerId: 'p0' });
    expect(result.state.clues.at(-1)).toMatchObject({ playerId: 'p0', mimed: false });
  });

  it('pendingCascade and mirrorBounced are always reset to empty/false on a fresh clue round', () => {
    const state = dealtState({
      pendingCascade: ['ghost-id'],
      mirrorBounced: true,
      settings: makeSettings({ specialRoles: [] }),
    });
    const result = enterNextClueRound(state, 1);
    expect(result.state.pendingCascade).toEqual([]);
    expect(result.state.mirrorBounced).toBe(false);
  });
});
