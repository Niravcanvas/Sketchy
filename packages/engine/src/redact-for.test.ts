import { describe, expect, it } from 'vitest';
import { redactFor } from './redact-for.js';
import { makeSettings, makeState } from './test-support.js';

describe('redactFor — data-model.md §4 matrix', () => {
  it('always shows your own role/word/specialRole', () => {
    const state = makeState(); // p0 civilian
    const mine = redactFor(state, 'p0');
    const me = mine.players.find((p) => p.id === 'p0')!;
    expect(me.role).toBe('civilian');
    expect(me.word).toBe('sun');
  });

  it("hides another ALIVE player's role/word/specialRole", () => {
    const state = makeState();
    const asP0 = redactFor(state, 'p0');
    const other = asP0.players.find((p) => p.id === 'p2')!; // alive undercover
    expect(other.role).toBeNull();
    expect(other.word).toBeNull();
    expect(other.specialRole).toBeNull();
  });

  it("reveals an ELIMINATED player's role to everyone from the reveal phase on", () => {
    const state = makeState({
      players: makeState().players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    const asP0 = redactFor(state, 'p0');
    const eliminated = asP0.players.find((p) => p.id === 'p2')!;
    expect(eliminated.role).toBe('undercover');
  });

  it('keeps an ELIMINATED player\'s word hidden when eliminationReveal is "role" (default)', () => {
    const state = makeState({
      settings: makeSettings({ eliminationReveal: 'role' }),
      players: makeState().players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    const asP0 = redactFor(state, 'p0');
    expect(asP0.players.find((p) => p.id === 'p2')!.word).toBeNull();
  });

  it('reveals an ELIMINATED player\'s word when eliminationReveal is "word_and_role"', () => {
    const state = makeState({
      settings: makeSettings({ eliminationReveal: 'word_and_role' }),
      players: makeState().players.map((p) =>
        p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1 } : p,
      ),
    });
    const asP0 = redactFor(state, 'p0');
    expect(asP0.players.find((p) => p.id === 'p2')!.word).toBe('moon');
  });

  it('reveals everything to everyone once the game is over', () => {
    const state = makeState({ phase: 'game_over', winnerFaction: 'civilian' });
    const spectator = redactFor(state, 'spectator');
    for (const p of spectator.players) {
      expect(p.role).not.toBeNull();
    }
    const mrwhite = spectator.players.find((p) => p.role === 'mrwhite')!;
    expect(mrwhite.word).toBeNull(); // Mr. White's word is null by nature, not a redaction
  });

  it('pair is null before game_over, for everyone including yourself', () => {
    const state = makeState();
    expect(redactFor(state, 'p0').pair).toBeNull();
    expect(redactFor(state, 'spectator').pair).toBeNull();
  });

  it('pair is shown to everyone once the game is over', () => {
    const state = makeState({ phase: 'game_over' });
    expect(redactFor(state, 'spectator').pair).toEqual({
      civilianWord: 'sun',
      undercoverWord: 'moon',
      pairId: 'pair-1',
    });
  });

  it("votes: only the viewer's own ballot is included; votedIds is public", () => {
    const state = makeState({ phase: 'voting', votes: { p0: 'p2', p1: 'p3' } });
    const asP0 = redactFor(state, 'p0');
    expect(asP0.votes).toEqual({ p0: 'p2' });
    expect(asP0.votedIds.sort()).toEqual(['p0', 'p1']);
  });

  it('votes: a spectator sees no ballots at all, but still sees votedIds', () => {
    const state = makeState({ phase: 'voting', votes: { p0: 'p2', p1: 'p3' } });
    const spectator = redactFor(state, 'spectator');
    expect(spectator.votes).toEqual({});
    expect(spectator.votedIds.sort()).toEqual(['p0', 'p1']);
  });

  it('votes: a viewer who has not voted this round has an empty ballot slice', () => {
    const state = makeState({ phase: 'voting', votes: { p1: 'p3' } });
    expect(redactFor(state, 'p0').votes).toEqual({});
  });

  it('seed is always redacted to an empty string', () => {
    const state = makeState({ seed: 'super-secret-seed' });
    expect(redactFor(state, 'p0').seed).toBe('');
    expect(redactFor(state, 'spectator').seed).toBe('');
  });

  it('voteHistory is hidden until game_over, then fully shown', () => {
    const history = [{ round: 1, revote: false, votes: { p0: 'p2' }, eliminated: 'p2' }];
    const midGame = makeState({ voteHistory: history });
    expect(redactFor(midGame, 'p0').voteHistory).toEqual([]);

    const over = makeState({ phase: 'game_over', voteHistory: history });
    expect(redactFor(over, 'p0').voteHistory).toEqual(history);
  });

  it('lastGuess is always public (game-design.md §6.6)', () => {
    const state = makeState({ lastGuess: { playerId: 'p3', text: 'wrong', correct: false } });
    expect(redactFor(state, 'spectator').lastGuess).toEqual({
      playerId: 'p3',
      text: 'wrong',
      correct: false,
    });
  });

  it('spectator has no self — nobody\'s "own" fields are revealed early', () => {
    const state = makeState();
    const spectator = redactFor(state, 'spectator');
    for (const p of spectator.players) {
      if (p.alive) expect(p.role).toBeNull();
    }
  });

  it('all other GameState fields (phase, round, settings, clues, scoreboard, hostId, turnSeat, tiedPlayerIds, revoteCount, pendingElimination, phaseEndsAt, gamesPlayedInRoom, timerExtended, code, mode, createdAt) pass through unredacted', () => {
    const state = makeState({
      phase: 'tiebreak_clue',
      round: 3,
      clues: [{ round: 1, playerId: 'p0', text: 'hot', mimed: false }],
      scoreboard: { p0: 2 },
      tiedPlayerIds: ['p0', 'p1'],
      revoteCount: 0,
      pendingElimination: null,
      phaseEndsAt: 12345,
      gamesPlayedInRoom: 2,
      timerExtended: true,
      code: 'ABCDE',
      mode: 'online_private',
      createdAt: 999,
    });
    const redacted = redactFor(state, 'spectator');
    expect(redacted).toMatchObject({
      phase: 'tiebreak_clue',
      round: 3,
      clues: state.clues,
      scoreboard: { p0: 2 },
      tiedPlayerIds: ['p0', 'p1'],
      revoteCount: 0,
      pendingElimination: null,
      phaseEndsAt: 12345,
      gamesPlayedInRoom: 2,
      timerExtended: true,
      code: 'ABCDE',
      mode: 'online_private',
      createdAt: 999,
      hostId: state.hostId,
      settings: state.settings,
    });
  });

  it('a player object with no matching viewer (unknown id) behaves like a spectator view', () => {
    const state = makeState();
    const redacted = redactFor(state, 'someone-not-in-the-game');
    for (const p of redacted.players) {
      if (p.alive) expect(p.role).toBeNull();
    }
  });

  describe('phase 12 — the Judge public-reveal exception', () => {
    it("hides an ALIVE Judge's specialRole from others before judgeRevealed latches", () => {
      const state = makeState({
        judgeRevealed: false,
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, specialRole: 'judge' } : p,
        ),
      });
      const asP0 = redactFor(state, 'p0');
      expect(asP0.players.find((p) => p.id === 'p2')!.specialRole).toBeNull();
      const spectator = redactFor(state, 'spectator');
      expect(spectator.players.find((p) => p.id === 'p2')!.specialRole).toBeNull();
    });

    it("reveals an ALIVE Judge's specialRole to EVERYONE once judgeRevealed is true", () => {
      const state = makeState({
        judgeRevealed: true,
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, specialRole: 'judge' } : p,
        ),
      });
      const asP0 = redactFor(state, 'p0');
      expect(asP0.players.find((p) => p.id === 'p2')!.specialRole).toBe('judge');
      const spectator = redactFor(state, 'spectator');
      expect(spectator.players.find((p) => p.id === 'p2')!.specialRole).toBe('judge');
    });

    it("judgeRevealed does NOT also leak the Judge's base role — only specialRole", () => {
      const state = makeState({
        judgeRevealed: true,
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, specialRole: 'judge' } : p,
        ),
      });
      const asP0 = redactFor(state, 'p0');
      const p2 = asP0.players.find((p) => p.id === 'p2')!;
      expect(p2.specialRole).toBe('judge');
      expect(p2.role).toBeNull(); // p2 (undercover) is still alive and not the viewer
    });

    it('judgeRevealed has no effect on a non-Judge specialRole (still hidden while alive)', () => {
      const state = makeState({
        judgeRevealed: true,
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, specialRole: 'jester' } : p,
        ),
      });
      const asP0 = redactFor(state, 'p0');
      expect(asP0.players.find((p) => p.id === 'p2')!.specialRole).toBeNull();
    });

    it("an eliminated Judge's specialRole is visible regardless of judgeRevealed (the ordinary eliminated-player rule)", () => {
      const state = makeState({
        judgeRevealed: false,
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, alive: false, eliminatedRound: 1, specialRole: 'judge' } : p,
        ),
      });
      const asP0 = redactFor(state, 'p0');
      expect(asP0.players.find((p) => p.id === 'p2')!.specialRole).toBe('judge');
    });
  });

  describe('phase 13 — no NEW early-reveal exceptions for Mirror/Lovebirds/Rivals/Grudge', () => {
    it("an ALIVE Mirror's specialRole stays hidden from everyone — surviving a bounce grants NO early reveal", () => {
      const state = makeState({
        mirrorBounced: true, // a bounce just happened THIS reveal sequence
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, specialRole: 'mirror' } : p,
        ),
      });
      const asP0 = redactFor(state, 'p0');
      expect(asP0.players.find((p) => p.id === 'p2')!.specialRole).toBeNull();
      const spectator = redactFor(state, 'spectator');
      expect(spectator.players.find((p) => p.id === 'p2')!.specialRole).toBeNull();
    });

    it("an ALIVE Lovebirds/Rivals/Grudge holder's specialRole stays hidden from a non-partner viewer (no early reveal)", () => {
      const state = makeState({
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, specialRole: 'lovebirds' } : p,
        ),
      });
      const asP0 = redactFor(state, 'p0'); // p0 is not p2's partner
      expect(asP0.players.find((p) => p.id === 'p2')!.specialRole).toBeNull();
    });

    it("your OWN specialRole (lovebirds/rivals/grudge/mirror) is always visible to yourself, same as any other role", () => {
      const state = makeState({
        players: makeState().players.map((p) =>
          p.id === 'p2' ? { ...p, specialRole: 'rivals' } : p,
        ),
      });
      const asP2 = redactFor(state, 'p2');
      expect(asP2.players.find((p) => p.id === 'p2')!.specialRole).toBe('rivals');
    });

    it('mirrorBounced being true does NOT, by itself, leak any player identity — no player id field carries it', () => {
      const state = makeState({ mirrorBounced: true });
      const redacted = redactFor(state, 'spectator');
      expect(redacted.mirrorBounced).toBe(true);
      // The type itself has no player-id-shaped field for this — a structural guarantee,
      // not just a runtime one, but pin the runtime shape here too.
      expect(Object.keys(redacted)).not.toContain('mirrorId');
    });
  });

  describe('phase 13 — new public fields pass through unredacted', () => {
    it('pendingCascade passes through to every viewer, including a spectator', () => {
      const state = makeState({ pendingCascade: ['p1', 'p2'] });
      expect(redactFor(state, 'p0').pendingCascade).toEqual(['p1', 'p2']);
      expect(redactFor(state, 'spectator').pendingCascade).toEqual(['p1', 'p2']);
    });

    it('mimeId passes through to every viewer, including a spectator', () => {
      const state = makeState({ mimeId: 'p3' });
      expect(redactFor(state, 'p0').mimeId).toBe('p3');
      expect(redactFor(state, 'spectator').mimeId).toBe('p3');
    });

    it("a clue's `mimed` flag passes through unredacted (clues are always public)", () => {
      const state = makeState({
        clues: [{ round: 1, playerId: 'p2', text: 'gesture', mimed: true }],
      });
      expect(redactFor(state, 'spectator').clues).toEqual(state.clues);
    });
  });
});
