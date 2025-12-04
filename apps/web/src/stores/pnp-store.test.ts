import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePlayer } from '@sketchy/engine/types';
import { bundledPairPool } from '@/lib/pair-pool';
import {
  currentRitualPlayer,
  currentSpeaker,
  currentVoter,
  hasCheckpoint,
  usePnpStore,
} from './pnp-store';

const STORAGE_KEY = 'sketchy:pnp:current';

function playerNames(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Player${i}`);
}

/** Fresh empty lobby + `n` seated players (auto-suggested role counts, untouched). */
function newLobbyWithPlayers(n: number): void {
  usePnpStore.getState().initLobby();
  for (const name of playerNames(n)) usePnpStore.getState().addPlayer(name);
}

/** Drives the deal ritual pass-around to completion via the real UI-facing actions. */
function ackAllRitual(): void {
  let player = currentRitualPlayer(usePnpStore.getState().game!);
  while (player) {
    usePnpStore.getState().confirmPass();
    usePnpStore.getState().setPeeking(true);
    usePnpStore.getState().ackCurrent();
    player = currentRitualPlayer(usePnpStore.getState().game!);
  }
}

/** Spoken-mode: skips every clue turn (`(skipped)` notes) until the clue-giving phase(s)
 * end — used whenever a test doesn't care about clue content, only phase progression. */
function skipAllClues(): void {
  while (['clue', 'tiebreak_clue'].includes(usePnpStore.getState().game!.phase)) {
    usePnpStore.getState().nextSpeaker();
  }
}

/** Casts a secret ballot for every eligible voter via the actual pass-around API
 * (confirmVotePass -> selectTarget -> castBallot), not the open-vote shortcut. */
function passAroundBallots(targetFor: (voter: GamePlayer) => string): void {
  let voter = currentVoter(usePnpStore.getState().game!);
  while (voter) {
    usePnpStore.getState().confirmVotePass();
    usePnpStore.getState().selectTarget(targetFor(voter));
    usePnpStore.getState().castBallot();
    voter = currentVoter(usePnpStore.getState().game!);
  }
}

/**
 * Runs one full `clue -> discussion -> voting -> reveal` cycle, eliminating whichever alive
 * player `pickTarget` names (mirrors packages/engine/src/test-support.ts's
 * `playScriptedGame` unanimous-vote technique: everyone but the target votes for the
 * target, the target casts a harmless throwaway vote — guarantees a clean plurality, never
 * a tie). Resolves the Mr. White guess window if it opens (with a wrong guess by default),
 * unless `stopAtMrWhiteGuess` — the guess-window tests assert on that phase themselves.
 */
function runRoundEliminating(
  pickTarget: (alive: GamePlayer[]) => GamePlayer,
  opts: { guess?: string; usePassAround?: boolean; stopAtMrWhiteGuess?: boolean } = {},
): void {
  skipAllClues();
  usePnpStore.getState().callVote();

  const game = usePnpStore.getState().game!;
  const alive = game.players.filter((p) => p.alive);
  const target = pickTarget(alive);
  const fallback = alive.find((p) => p.id !== target.id) as GamePlayer;
  const targetFor = (voter: GamePlayer): string =>
    voter.id === target.id ? fallback.id : target.id;

  if (opts.usePassAround) {
    passAroundBallots(targetFor);
  } else {
    for (const voter of alive) {
      usePnpStore.getState().castOpenVote(voter.id, targetFor(voter));
    }
  }

  expect(usePnpStore.getState().game!.phase).toBe('reveal');
  expect(usePnpStore.getState().game!.pendingElimination).toBe(target.id);
  usePnpStore.getState().continueReveal();

  if (!opts.stopAtMrWhiteGuess && usePnpStore.getState().game!.phase === 'mrwhite_guess') {
    usePnpStore.getState().submitMrWhiteGuess(opts.guess ?? 'definitely-wrong-zzz');
  }
}

const isInfiltrator = (p: GamePlayer): boolean => p.role === 'undercover' || p.role === 'mrwhite';

beforeEach(() => {
  window.localStorage.clear();
});

describe('lobby setup', () => {
  it('adds players and auto-suggests role counts from the roster', () => {
    newLobbyWithPlayers(5);
    const game = usePnpStore.getState().game!;
    expect(game.players.map((p) => p.name)).toEqual(playerNames(5));
    expect(game.settings.undercoverCount).toBe(1);
    expect(game.settings.mrWhiteCount).toBe(1); // suggestRoleCounts(5)
    expect(usePnpStore.getState().error).toBeNull();
  });

  it('the first seated player becomes host (createGame([]) leaves hostId "")', () => {
    usePnpStore.getState().initLobby();
    expect(usePnpStore.getState().game!.hostId).toBe('');
    usePnpStore.getState().addPlayer('Ann');
    const game = usePnpStore.getState().game!;
    expect(game.hostId).toBe(game.players[0]!.id);
  });

  it('rejects a case-insensitive duplicate name with name_taken_in_room', () => {
    usePnpStore.getState().initLobby();
    usePnpStore.getState().addPlayer('Ann');
    usePnpStore.getState().addPlayer('  ann ');
    expect(usePnpStore.getState().error).toBe('name_taken_in_room');
    expect(usePnpStore.getState().game!.players).toHaveLength(1);
  });

  it('re-suggests role counts when a player is removed', () => {
    newLobbyWithPlayers(5);
    const toRemove = usePnpStore.getState().game!.players[4]!.id;
    usePnpStore.getState().removePlayer(toRemove);
    const game = usePnpStore.getState().game!;
    expect(game.players).toHaveLength(4);
    expect(game.settings.undercoverCount).toBe(1);
    expect(game.settings.mrWhiteCount).toBe(0); // suggestRoleCounts(4)
  });

  it('keeps manually-set role counts across later roster changes', () => {
    newLobbyWithPlayers(4);
    // Auto-suggested for 4 players is {undercoverCount:1, mrWhiteCount:0}; deliberately set
    // a DIFFERENT valid combo so a later re-suggestion would be observable if it happened.
    usePnpStore.getState().setRoleCounts({ undercoverCount: 0, mrWhiteCount: 1 });
    expect(usePnpStore.getState().error).toBeNull();

    usePnpStore.getState().addPlayer('Player4');
    const game = usePnpStore.getState().game!;
    expect(game.players).toHaveLength(5);
    // suggestRoleCounts(5) would say {1,1} — confirms auto-suggestion stayed off.
    expect(game.settings.undercoverCount).toBe(0);
    expect(game.settings.mrWhiteCount).toBe(1);
  });

  it('rejects invalid role math, leaving settings unchanged', () => {
    newLobbyWithPlayers(3);
    const before = usePnpStore.getState().game!.settings;
    usePnpStore.getState().setRoleCounts({ undercoverCount: 5, mrWhiteCount: 5 });
    expect(usePnpStore.getState().error).toBe('validation');
    expect(usePnpStore.getState().game!.settings).toEqual(before);
  });

  it('setPackSelection / setDifficulties patch settings via updateSettings', () => {
    newLobbyWithPlayers(1);
    usePnpStore.getState().setPackSelection(['pack-a', 'pack-b']);
    expect(usePnpStore.getState().game!.settings.packIds).toEqual(['pack-a', 'pack-b']);
    usePnpStore.getState().setDifficulties(['hard']);
    expect(usePnpStore.getState().game!.settings.difficulties).toEqual(['hard']);
    expect(usePnpStore.getState().error).toBeNull();
  });

  it('setTypedClues / setOpenVote toggle prefs, never GameSettings', () => {
    newLobbyWithPlayers(1);
    const settingsBefore = usePnpStore.getState().game!.settings;
    usePnpStore.getState().setTypedClues(true);
    usePnpStore.getState().setOpenVote(true);
    expect(usePnpStore.getState().prefs).toEqual({ typedClues: true, openVote: true });
    expect(usePnpStore.getState().game!.settings).toBe(settingsBefore);
  });
});

describe('clue phase', () => {
  it('submitTypedClue dispatches as the derived current speaker and advances the turn', () => {
    newLobbyWithPlayers(5);
    usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
    ackAllRitual();

    const speaker = currentSpeaker(usePnpStore.getState().game!)!;
    usePnpStore.getState().submitTypedClue('hello');

    const game = usePnpStore.getState().game!;
    expect(game.clues.at(-1)).toMatchObject({ playerId: speaker.id, text: 'hello' });
    expect(currentSpeaker(game)?.id).not.toBe(speaker.id);
    expect(usePnpStore.getState().error).toBeNull();
  });

  it('submitTypedClue no-ops outside a clue-giving phase', () => {
    newLobbyWithPlayers(1);
    usePnpStore.getState().submitTypedClue('hello'); // still in lobby — no derived speaker
    expect(usePnpStore.getState().game!.clues).toEqual([]);
    expect(usePnpStore.getState().error).toBeNull();
  });

  it('nextSpeaker records a skipped clue for the current turn-holder', () => {
    newLobbyWithPlayers(5);
    usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
    ackAllRitual();
    const speaker = currentSpeaker(usePnpStore.getState().game!)!;
    usePnpStore.getState().nextSpeaker();
    expect(usePnpStore.getState().game!.clues.at(-1)).toMatchObject({
      playerId: speaker.id,
      text: '(skipped)',
    });
  });
});

describe('full game — pass and play', () => {
  it('plays start to a civilian win, exercising the secret-ballot pass-around', () => {
    newLobbyWithPlayers(5);
    const setupGame = usePnpStore.getState().game!;
    expect(setupGame.settings.undercoverCount).toBe(1);
    expect(setupGame.settings.mrWhiteCount).toBe(1);

    usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
    expect(usePnpStore.getState().game!.phase).toBe('dealing');

    ackAllRitual();
    expect(usePnpStore.getState().game!.phase).toBe('clue');

    // Round 1: eliminate one infiltrator via the secret-ballot pass-around.
    runRoundEliminating((alive) => alive.find(isInfiltrator) as GamePlayer, {
      usePassAround: true,
    });

    let game = usePnpStore.getState().game!;
    if (game.phase !== 'game_over') {
      expect(game.phase).toBe('clue');
      // Round 2: eliminate the remaining infiltrator -> civilian win.
      runRoundEliminating((alive) => alive.find(isInfiltrator) as GamePlayer, {
        usePassAround: true,
      });
      game = usePnpStore.getState().game!;
    }

    expect(game.phase).toBe('game_over');
    expect(game.winnerFaction).toBe('civilian');
    const civilians = game.players.filter((p) => p.role === 'civilian');
    expect(civilians).toHaveLength(3);
    for (const p of civilians) expect(game.scoreboard[p.id]).toBe(2);
  });
});

describe('Mr. White guess window', () => {
  /** Plays to the reveal of a game whose eliminated player is Mr. White, then dismisses
   * the reveal so `phase === 'mrwhite_guess'`. Returns the eliminated Mr. White player. */
  function reachMrWhiteGuess(): GamePlayer {
    newLobbyWithPlayers(5);
    usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
    ackAllRitual();

    const mw = usePnpStore.getState().game!.players.find((p) => p.role === 'mrwhite') as GamePlayer;
    runRoundEliminating(() => mw, { stopAtMrWhiteGuess: true });

    expect(usePnpStore.getState().game!.phase).toBe('mrwhite_guess');
    return mw;
  }

  it('a wrong guess sets the wrong_guess interlude and the game continues', () => {
    reachMrWhiteGuess();
    usePnpStore.getState().submitMrWhiteGuess('definitely-wrong-zzz');

    const state = usePnpStore.getState();
    expect(state.interlude).toBe('wrong_guess');
    expect(state.game!.lastGuess).toMatchObject({ correct: false, text: 'definitely-wrong-zzz' });
    // 5 players, one infiltrator (the Undercover) still alive — no winner yet.
    expect(state.game!.phase).toBe('clue');
  });

  it('a correct guess wins the game for Mr. White', () => {
    reachMrWhiteGuess();
    const civilianWord = usePnpStore.getState().game!.pair.civilianWord; // test-only read
    usePnpStore.getState().submitMrWhiteGuess(civilianWord);

    const state = usePnpStore.getState();
    expect(state.game!.winnerFaction).toBe('mrwhite');
    expect(state.game!.phase).toBe('game_over');
  });
});

describe('double tie', () => {
  it('a 3-3 tie enters tiebreak_clue; a repeated 3-3 re-vote raises second_tie', () => {
    newLobbyWithPlayers(6);
    usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
    ackAllRitual();
    skipAllClues();
    usePnpStore.getState().callVote();

    const [p0, p1, p2, p3, p4, p5] = usePnpStore.getState().game!.players as [
      GamePlayer,
      GamePlayer,
      GamePlayer,
      GamePlayer,
      GamePlayer,
      GamePlayer,
    ];
    const split: Record<string, string> = {
      [p0.id]: p3.id,
      [p1.id]: p3.id,
      [p2.id]: p3.id,
      [p3.id]: p0.id,
      [p4.id]: p0.id,
      [p5.id]: p0.id,
    };
    const castSplit = (): void => {
      for (const [voterId, targetId] of Object.entries(split)) {
        usePnpStore.getState().castOpenVote(voterId, targetId);
      }
    };

    castSplit();
    let state = usePnpStore.getState();
    expect(state.game!.phase).toBe('tiebreak_clue');
    expect(new Set(state.game!.tiedPlayerIds ?? [])).toEqual(new Set([p0.id, p3.id]));
    expect(state.interlude).toBeNull();

    skipAllClues(); // one extra clue each from the tied pair -> re-vote
    expect(usePnpStore.getState().game!.phase).toBe('voting');
    expect(usePnpStore.getState().game!.revoteCount).toBe(1);

    castSplit(); // same 3-3 split, restricted to {p0, p3} -> second tie
    state = usePnpStore.getState();
    expect(state.interlude).toBe('second_tie');
    expect(state.game!.phase).toBe('clue');
    expect(state.game!.tiedPlayerIds).toBeNull();
    expect(state.game!.players.filter((p) => p.alive)).toHaveLength(6);
  });
});

describe('checkpoint persistence', () => {
  it('round-trips game + ui slice through localStorage', () => {
    newLobbyWithPlayers(5);
    usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
    usePnpStore.getState().setTypedClues(true);
    usePnpStore.getState().confirmPass();
    usePnpStore.getState().setPeeking(true);

    const before = usePnpStore.getState();
    const snapshot = {
      game: before.game,
      prefs: before.prefs,
      ritual: before.ritual,
      ballot: before.ballot,
      interlude: before.interlude,
      pairPool: before.pairPool,
      usedPairKeys: before.usedPairKeys,
    };
    const rawBefore = window.localStorage.getItem(STORAGE_KEY);
    expect(rawBefore).not.toBeNull();

    // Simulate a fresh session: blow away the in-memory store with an unrelated lobby, then
    // put the saved bytes back (as if a new tab read the same localStorage key).
    usePnpStore.getState().initLobby();
    expect(usePnpStore.getState().game!.players).toHaveLength(0);
    window.localStorage.setItem(STORAGE_KEY, rawBefore as string);

    const restored = usePnpStore.getState().hydrateFromCheckpoint();
    expect(restored).toBe(true);

    const after = usePnpStore.getState();
    expect(after.game).toEqual(snapshot.game);
    expect(after.prefs).toEqual(snapshot.prefs);
    expect(after.ritual).toEqual(snapshot.ritual);
    expect(after.ballot).toEqual(snapshot.ballot);
    expect(after.interlude).toBe(snapshot.interlude);
    expect(after.pairPool).toEqual(snapshot.pairPool);
    expect(after.usedPairKeys).toEqual(snapshot.usedPairKeys);
  });

  it('returns false and clears the key on corrupt JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not valid json');
    const ok = usePnpStore.getState().hydrateFromCheckpoint();
    expect(ok).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns false when there is no checkpoint at all', () => {
    expect(hasCheckpoint()).toBe(false);
    expect(usePnpStore.getState().hydrateFromCheckpoint()).toBe(false);
  });

  it('hasCheckpoint reflects presence of the exact storage key', () => {
    expect(hasCheckpoint()).toBe(false);
    newLobbyWithPlayers(3);
    expect(hasCheckpoint()).toBe(true);
  });

  it('clearCheckpoint removes the key without touching in-memory state', () => {
    newLobbyWithPlayers(3);
    usePnpStore.getState().clearCheckpoint();
    expect(hasCheckpoint()).toBe(false);
    expect(usePnpStore.getState().game!.players).toHaveLength(3);
  });

  it('resetToSetup clears the checkpoint and starts a brand-new empty lobby', () => {
    newLobbyWithPlayers(3);
    const oldSeed = usePnpStore.getState().game!.seed;
    usePnpStore.getState().resetToSetup();
    expect(usePnpStore.getState().game!.players).toHaveLength(0);
    expect(usePnpStore.getState().game!.seed).not.toBe(oldSeed);
    expect(hasCheckpoint()).toBe(true); // resetToSetup's own initLobby() writes a fresh one
  });
});

describe('rematch', () => {
  it('draws a fresh pair, carries the scoreboard, and increments gamesPlayedInRoom', () => {
    newLobbyWithPlayers(5);
    usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
    ackAllRitual();

    runRoundEliminating((alive) => alive.find(isInfiltrator) as GamePlayer);
    if (usePnpStore.getState().game!.phase !== 'game_over') {
      runRoundEliminating((alive) => alive.find(isInfiltrator) as GamePlayer);
    }

    const finished = usePnpStore.getState().game!;
    expect(finished.phase).toBe('game_over');
    const scoreboardBefore = finished.scoreboard;
    const gamesPlayedBefore = finished.gamesPlayedInRoom;
    const wordsBefore = [finished.pair.civilianWord, finished.pair.undercoverWord].sort();

    usePnpStore.getState().rematch();

    const after = usePnpStore.getState().game!;
    expect(after.phase).toBe('dealing');
    expect(after.gamesPlayedInRoom).toBe(gamesPlayedBefore + 1);
    expect(after.scoreboard).toEqual(scoreboardBefore);
    expect([after.pair.civilianWord, after.pair.undercoverWord].sort()).not.toEqual(wordsBefore);
    expect(usePnpStore.getState().usedPairKeys).toHaveLength(2);
    expect(usePnpStore.getState().ritual).toEqual({ confirmed: false, peeking: false });
    expect(usePnpStore.getState().ballot).toEqual({ confirmed: false, selectedTarget: null });
    expect(usePnpStore.getState().interlude).toBeNull();
  });
});
