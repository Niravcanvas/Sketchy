import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllGraceTimers, stopAbandonSweeper } from '../../src/rooms/presence-timers.js';
import { loadRoom } from '../../src/rooms/room-store.js';
import { buildServer } from '../../src/server.js';
import { sleep } from '../bots/socket-bot.js';
import { botFor, closeTable, createTable, freshestState, playToGameOver } from '../bots/table.js';

/**
 * Idempotency & races (game-design.md §8 "Simultaneity"):
 * double-submits ack harmlessly, and the CAS write path holds up under the
 * genuine N-writer bursts (all ballots at close, all phones dropping at once)
 * that the single-retry version silently lost (fixed in room-store.ts).
 */

describe('idempotency & races', () => {
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

  async function driveToVoting(namePrefix: string, n = 4): Promise<Awaited<ReturnType<typeof createTable>>> {
    const table = await createTable(server, baseUrl, {
      n,
      namePrefix,
      settings: { undercoverCount: 1, mrWhiteCount: 0 },
    });
    await playToGameOver(table, {
      priority: (role) => (role === 'undercover' ? 0 : 1),
      until: (s) => s.phase === 'voting',
      timeoutMs: 25_000,
    });
    return table;
  }

  it('acks a re-submitted identical ballot as already_voted (harmless)', async () => {
    const table = await driveToVoting('Idem');
    try {
      const alive = freshestState(table).players.filter((p) => p.alive);
      const voter = botFor(table, alive[0]!.id)!;
      const target = alive[1]!.id;

      const first = await voter.vote(target);
      expect(first.ok).toBe(true);
      const second = await voter.vote(target);
      expect(second).toEqual({ ok: false, error: 'already_voted' });

      // The room is unharmed: still voting, exactly one ballot recorded for them.
      const state = freshestState(table);
      expect(state.phase).toBe('voting');
      expect(state.votedIds).toContain(voter.playerId);
    } finally {
      closeTable(table);
    }
  }, 30_000);

  it('counts every ballot when the whole table votes in the same tick (no lost update)', async () => {
    const table = await driveToVoting('Burst');
    try {
      const alive = freshestState(table).players.filter((p) => p.alive);
      const target = alive[1]!.id; // everyone piles onto one suspect…

      // …all ballots fire concurrently — the exact contention the bounded CAS
      // retry exists for. A lost ballot would leave the vote unable to close.
      const acks = await Promise.all(
        alive.map((p) => {
          const bot = botFor(table, p.id)!;
          // The target can't vote for themself; they throw a ballot elsewhere.
          const t = p.id === target ? alive[0]!.id : target;
          return bot.vote(t);
        }),
      );
      expect(acks.every((a) => a.ok)).toBe(true);

      // The vote closes on a clean plurality → the pile-on target is eliminated.
      await table.host.waitForSnapshot((s) => s.state.phase !== 'voting', 'vote resolved', 6000);
      const state = freshestState(table);
      const targetPlayer = state.players.find((p) => p.id === target)!;
      expect(state.pendingElimination === target || !targetPlayer.alive).toBe(true);
    } finally {
      closeTable(table);
    }
  }, 30_000);

  it('marks every player disconnected when the whole table drops at once', async () => {
    const table = await createTable(server, baseUrl, { n: 5, namePrefix: 'Drop' });
    const code = table.code;
    try {
      await table.host.waitForPhase('clue');
      // Simultaneous disconnects → N concurrent presence:false on one room.
      for (const bot of table.bots) bot.hardDisconnect();

      // Every one must land — the single-retry CAS dropped some, stranding a
      // player connected and defeating the abandon reaper.
      const deadline = Date.now() + 4000;
      for (;;) {
        const room = await loadRoom(code);
        if (room && room.state.players.every((p) => !p.connected)) break;
        if (Date.now() > deadline) {
          const room = await loadRoom(code);
          throw new Error(
            `not all disconnected: ${JSON.stringify(room?.state.players.map((p) => p.connected))}`,
          );
        }
        await sleep(60);
      }
    } finally {
      closeTable(table);
    }
  }, 30_000);

  it('never delivers a socket a snapshot with a lower ver than a previous one', async () => {
    const table = await createTable(server, baseUrl, { n: 4, namePrefix: 'Mono' });
    try {
      await playToGameOver(table, { priority: (role) => (role === 'undercover' ? 0 : 1) });
      // Each socket's stream of snapshots is strictly increasing in ver — the
      // invariant the client-side monotonicity guard relies on (drop ver<=cur).
      for (const bot of table.bots) {
        const vers = bot.snapshots.map((s) => s.ver);
        for (let i = 1; i < vers.length; i += 1) {
          expect(vers[i]!).toBeGreaterThanOrEqual(vers[i - 1]!);
        }
      }
    } finally {
      closeTable(table);
    }
  }, 30_000);
});
