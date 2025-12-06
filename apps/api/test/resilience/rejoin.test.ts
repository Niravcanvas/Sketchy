import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllGraceTimers, stopAbandonSweeper } from '../../src/rooms/presence-timers.js';
import { buildServer } from '../../src/server.js';
import type { SocketBot } from '../bots/socket-bot.js';
import { botFor, closeTable, createTable, freshestState, playToGameOver, roleMap } from '../bots/table.js';

/**
 * Rejoin completeness (game-design.md §8 "Rejoin after full
 * close"): reopening the socket restores mid-ANY-phase — same seat, role, word —
 * and the server-owned timers keep running underneath. The two hard cases are
 * `mrwhite_guess` (the guess window must still be ticking on
 * rejoin) and `tiebreak_clue`.
 */

describe('rejoin completeness', () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });
  afterEach(async () => {
    clearAllGraceTimers();
    stopAbandonSweeper();
    await server.close();
  });

  it('restores role + word mid-clue (your word is never lost)', async () => {
    const table = await createTable(server, baseUrl, { n: 4, namePrefix: 'Rejoin' });
    try {
      await table.host.waitForPhase('clue');
      const victim = table.bots[2]!;
      const roleBefore = victim.you().role;
      const wordBefore = victim.you().word;

      victim.hardDisconnect();
      await victim.reconnect();

      const you = victim.you();
      expect(you.role).toBe(roleBefore);
      expect(you.word).toBe(wordBefore);
      expect(victim.latest()!.state.phase).toBe('clue');
    } finally {
      closeTable(table);
    }
  });

  it('restores mid-mrwhite_guess with the guess window still running', async () => {
    // 6 players with a Mr. White; vote the Mr. White out first to open their guess.
    const table = await createTable(server, baseUrl, {
      n: 6,
      namePrefix: 'MrW',
      settings: { undercoverCount: 1, mrWhiteCount: 1 },
      pairs: [{ wordA: 'Comet', wordB: 'Meteor' }],
    });
    try {
      await playToGameOver(table, {
        priority: (role) => (role === 'mrwhite' ? 0 : 1),
        until: (s) => s.phase === 'mrwhite_guess',
        timeoutMs: 20_000,
      });

      const state = freshestState(table);
      expect(state.phase).toBe('mrwhite_guess');
      const guesserId = state.pendingElimination!;
      expect(roleMap(table).get(guesserId)).toBe('mrwhite');
      const endsAtBefore = state.phaseEndsAt;
      expect(endsAtBefore).not.toBeNull();

      const mrWhite = botFor(table, guesserId) as SocketBot;
      mrWhite.hardDisconnect();
      await mrWhite.reconnect();

      const after = mrWhite.latest()!;
      expect(after.state.phase).toBe('mrwhite_guess');
      expect(after.state.pendingElimination).toBe(guesserId);
      // The 30s guess timer kept running server-side across the blip.
      expect(after.state.phaseEndsAt).toBe(endsAtBefore);
      expect(after.state.phaseEndsAt!).toBeGreaterThan(Date.now());
      // …and they can still take their shot.
      expect(after.you.canAct).toBeDefined();
      const guessAck = await mrWhite.mrWhiteGuess('definitely-wrong');
      expect(guessAck.ok).toBe(true);
    } finally {
      closeTable(table);
    }
  });

  it('restores mid-tiebreak_clue with the tie intact', async () => {
    const table = await createTable(server, baseUrl, {
      n: 4,
      namePrefix: 'Tie',
      settings: { undercoverCount: 1, mrWhiteCount: 0 },
    });
    try {
      // Drive to an un-voted voting phase, then hand-craft a 2-2 tie.
      await playToGameOver(table, {
        priority: (role) => (role === 'undercover' ? 0 : 1),
        until: (s) => s.phase === 'voting',
        timeoutMs: 15_000,
      });
      const alive = freshestState(table)
        .players.filter((p) => p.alive)
        .sort((a, b) => a.seat - b.seat);
      expect(alive.length).toBe(4);
      const [p0, p1, p2, p3] = alive.map((p) => p.id) as [string, string, string, string];

      // p0,p3 → p2 ; p1,p2 → p3  ⇒ p2 and p3 tie on 2 each.
      await botFor(table, p0)!.vote(p2);
      await botFor(table, p1)!.vote(p3);
      await botFor(table, p2)!.vote(p3);
      await botFor(table, p3)!.vote(p2);

      await table.host.waitForSnapshot(
        (s) => s.state.phase === 'tiebreak_clue',
        'tiebreak_clue',
        6000,
      );
      const tied = freshestState(table).tiedPlayerIds ?? [];
      expect(new Set(tied)).toEqual(new Set([p2, p3]));

      // A tied player blips out and back — the tie must survive on their view.
      const victim = botFor(table, p2)!;
      victim.hardDisconnect();
      await victim.reconnect();

      const after = victim.latest()!;
      expect(after.state.phase).toBe('tiebreak_clue');
      expect(new Set(after.state.tiedPlayerIds ?? [])).toEqual(new Set([p2, p3]));
    } finally {
      closeTable(table);
    }
  });
});
