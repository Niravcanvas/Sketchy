import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import {
  closeTable,
  createTable,
  freshestState,
  playToGameOver,
  priority as tablePriority,
} from '../bots/table.js';
import type { SocketBot } from '../bots/socket-bot.js';

/**
 * Special roles wave 1 (Judge/Ghost/Jester) — a 5-bot end-to-end proof over the
 * real wire (socket handlers, redaction, snapshot broadcast), complementing the exhaustive
 * unit coverage in packages/engine/src/reducers/{deal,vote}.test.ts and redact-for.test.ts.
 * A manufactured tie routes to the Judge; the Judge's decision eliminates the Jester as the
 * FIRST player out (proving the +4 bonus); a second manufactured vote proves an eliminated
 * Ghost's ballot is both REQUIRED for the vote to close and can swing a clean plurality into
 * a tie; the game is then driven to `game_over` by the generic (now ghost/judge-aware) bot
 * driver to prove the whole loop still terminates normally with all three roles active.
 */
describe('special roles wave 1 (Judge/Ghost/Jester) — 5-bot integration', () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  it('routes a tie to the Judge, awards the Jester their first-out bonus, and a Ghost swings a later vote', async () => {
    const table = await createTable(server, baseUrl, {
      n: 5,
      namePrefix: 'Spice',
      settings: { specialRoles: ['judge', 'ghost', 'jester'] },
    });

    try {
      const judgeBot = table.bots.find((b) => b.latest()?.you.specialRole === 'judge');
      const jesterBot = table.bots.find((b) => b.latest()?.you.specialRole === 'jester');
      expect(judgeBot, 'a Judge holder must be assigned').toBeDefined();
      expect(jesterBot, 'a Jester holder must be assigned').toBeDefined();
      expect(judgeBot!.playerId).not.toBe(jesterBot!.playerId);

      // Pre-reveal: nobody else can see who the Judge is yet (data-model.md §4).
      const otherBotPreReveal = table.bots.find((b) => b.playerId !== judgeBot!.playerId)!;
      const preRevealState = otherBotPreReveal.latest()!.state;
      expect(
        preRevealState.players.find((p) => p.id === judgeBot!.playerId)?.specialRole,
      ).toBeNull();

      const plainBots = table.bots.filter(
        (b) => b.playerId !== judgeBot!.playerId && b.playerId !== jesterBot!.playerId,
      );
      expect(plainBots).toHaveLength(3);
      const [targetA, voterB, voterC] = plainBots as [SocketBot, SocketBot, SocketBot];

      // --- Round 1: manufacture a tie between the Jester and targetA -----------------
      await playToGameOver(table, {
        priority: tablePriority.undercoverWin,
        until: (s) => s.phase === 'voting',
        timeoutMs: 15_000,
      });

      // jesterBot <-> targetA tied at 2 votes each; voterB's vote (to voterC) is the odd
      // one out; judgeBot's own required ballot (to voterB) doesn't touch either side.
      const round1Votes: Array<[SocketBot, SocketBot]> = [
        [jesterBot!, targetA],
        [targetA, jesterBot!],
        [voterB, jesterBot!],
        [voterC, targetA],
        [judgeBot!, voterB],
      ];
      for (const [voter, target] of round1Votes) {
        const ack = await voter.vote(target.playerId);
        expect(ack.ok).toBe(true);
      }

      await table.host.waitForPhase('judge_decision', 6000);
      const tiedState = freshestState(table);
      expect(new Set(tiedState.tiedPlayerIds)).toEqual(
        new Set([jesterBot!.playerId, targetA.playerId]),
      );

      // The Judge's identity is now PUBLIC to everyone (data-model.md §4 exception) —
      // check it from a bystander's OWN snapshot, not the Judge's.
      const bystander = table.bots.find(
        (b) => b.playerId !== judgeBot!.playerId && b.playerId !== jesterBot!.playerId,
      )!;
      await bystander.waitForSnapshot(
        (s) => s.state.players.find((p) => p.id === judgeBot!.playerId)?.specialRole === 'judge',
        'the Judge to be revealed to a bystander',
      );
      // Meanwhile nobody's Jester identity has leaked — that special role has no public
      // reveal exception.
      const revealedState = freshestState(table);
      expect(
        revealedState.players.find((p) => p.id === jesterBot!.playerId)?.specialRole,
      ).toBeNull();

      // canAct.judge is true ONLY for the Judge, during judge_decision.
      expect(judgeBot!.latest()!.you.canAct.judge).toBe(true);
      expect(bystander.latest()!.you.canAct.judge).toBe(false);

      // A non-Judge attempting to decide is rejected server-side, never trusting the client.
      const impersonation = await bystander.specialJudge(targetA.playerId);
      expect(impersonation).toEqual({ ok: false, error: 'validation' });

      // The Judge eliminates the Jester — the FIRST player out this game.
      const decideAck = await judgeBot!.specialJudge(jesterBot!.playerId);
      expect(decideAck.ok).toBe(true);

      await table.host.waitForPhase('reveal', 6000);
      const afterDecision = freshestState(table);
      expect(afterDecision.pendingElimination).toBe(jesterBot!.playerId);
      expect(afterDecision.scoreboard[jesterBot!.playerId]).toBe(4);

      // --- Round 2: a Ghost's ballot is required to close the vote, and swings a clean
      // plurality into a fresh tie ------------------------------------------------------
      await playToGameOver(table, {
        priority: tablePriority.undercoverWin,
        until: (s) => s.phase === 'voting',
        timeoutMs: 15_000,
      });

      // 4 alive voters: judgeBot(J), targetA(A), voterB(B), voterC(C). J->A, C->A (A: 2),
      // B->C (C: 1), A->B (B: 1) -> A has a clean plurality (2) before the ghost votes.
      const aliveRound2: Array<[SocketBot, SocketBot]> = [
        [judgeBot!, targetA],
        [voterC, targetA],
        [voterB, voterC],
        [targetA, voterB],
      ];
      for (const [voter, target] of aliveRound2) {
        const ack = await voter.vote(target.playerId);
        expect(ack.ok).toBe(true);
      }

      // Still open — the eliminated Jester (now a Ghost) hasn't voted yet.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(freshestState(table).phase).toBe('voting');

      // The Ghost's ballot both closes the vote AND swings it: voterB (1 -> 2) now ties
      // targetA (2), instead of targetA winning outright.
      const ghostVoteAck = await jesterBot!.vote(voterB.playerId);
      expect(ghostVoteAck.ok).toBe(true);

      await table.host.waitForPhase('judge_decision', 6000);
      const round2Tie = freshestState(table);
      expect(new Set(round2Tie.tiedPlayerIds)).toEqual(
        new Set([targetA.playerId, voterB.playerId]),
      );

      // Resolve it (Judge again) so the driver below has a clean 'reveal' to continue from.
      const decide2 = await judgeBot!.specialJudge(voterB.playerId);
      expect(decide2.ok).toBe(true);
      await table.host.waitForPhase('reveal', 6000);

      // --- Finish the game out normally — the generic driver is ghost/judge-aware now --
      const final = await playToGameOver(table, {
        priority: tablePriority.undercoverWin,
        timeoutMs: 20_000,
      });
      expect(final.phase).toBe('game_over');
      // The Jester's +4 consolation persists in the session scoreboard through to the end.
      expect(final.scoreboard[jesterBot!.playerId]).toBeGreaterThanOrEqual(4);
    } finally {
      closeTable(table);
    }
  }, 30000);
});
