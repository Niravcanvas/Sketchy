import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAllGraceTimers, stopAbandonSweeper } from '../../src/rooms/presence-timers.js';
import { buildServer } from '../../src/server.js';
import type { SocketBot } from '../bots/socket-bot.js';
import { closeTable, createTable, playToGameOver, priority } from '../bots/table.js';

/**
 * Chaos integration suite: full games played THROUGH
 * disconnect/reconnect churn and an API restart, asserting each still reaches a
 * clean `game_over` with a winner. Designed to be deterministic-enough to run
 * 10× clean (flaky = bug): a seeded PRNG drives the chaos, phase timers are
 * short so a dropped player's turn/ballot resolves via host-skip / abstain, and
 * the host stays connected so reveal/discussion advance promptly.
 */

/** mulberry32 — a tiny seeded PRNG so each run's chaos is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAST_TIMERS = { clueTimerSec: 2, discussionTimerSec: 1, voteTimerSec: 2 };

describe('chaos integration', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let port: number;
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ['GRACE_WINDOW_MS', 'ABANDON_MS']) saved[k] = process.env[k];
    process.env.GRACE_WINDOW_MS = '400';
    process.env.ABANDON_MS = '600000'; // keep the reaper out of these games.
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
    port = Number.parseInt(new URL(baseUrl).port, 10);
  });
  afterEach(async () => {
    clearAllGraceTimers();
    stopAbandonSweeper();
    await server.close();
  });

  // Three seeds → three independent chaotic games in one pass.
  for (const seed of [1, 7, 23]) {
    it(`reaches game_over through disconnect/reconnect churn (seed ${seed})`, async () => {
      const rng = mulberry32(seed);
      const table = await createTable(server, baseUrl, {
        n: 6,
        namePrefix: `Chaos${seed}`,
        settings: FAST_TIMERS,
      });
      try {
        const final = await playToGameOver(table, {
          priority: priority.civilianWin,
          timeoutMs: 40_000,
          pollMs: 100,
          onTick: async (t, state) => {
            // Churn only NON-host players (host drives reveal/discussion), and
            // keep >=2 alive-and-connected so a phase can always make progress.
            const host = state.hostId;
            const churnable = t.bots.filter((b) => b.playerId !== host);
            const connected = churnable.filter((b) => b.socket.connected);
            const dropped = churnable.filter((b) => !b.socket.connected);
            const r = rng();
            if (r < 0.14 && connected.length > 2) {
              pick(connected, rng).hardDisconnect();
            } else if (r < 0.4 && dropped.length > 0) {
              await pick(dropped, rng).reconnect();
            }
          },
        });
        expect(final.phase).toBe('game_over');
        expect(final.winnerFaction).not.toBeNull();
      } finally {
        closeTable(table);
      }
    });
  }

  it('survives a full API restart mid-game and still finishes', async () => {
    const table = await createTable(server, baseUrl, {
      n: 5,
      namePrefix: 'Restart',
      settings: FAST_TIMERS,
    });
    try {
      // Play into the thick of it, then yank the process out from under everyone.
      await playToGameOver(table, {
        priority: priority.civilianWin,
        until: (s) => s.round >= 1 && s.phase === 'discussion',
        timeoutMs: 15_000,
      });

      // A real restart drops every client the instant the process dies — model
      // that (and let the server close without draining live sockets).
      for (const bot of table.bots) bot.hardDisconnect();
      await server.close();
      server = await buildServer();
      baseUrl = await server.listen({ port });

      // Clients reconnect to the relaunched process; the game (advancing on its
      // re-armed timers in the gap) resumes and reaches a winner.
      for (const bot of table.bots) await bot.reconnect();

      const final = await playToGameOver(table, {
        priority: priority.civilianWin,
        timeoutMs: 40_000,
      });
      expect(final.phase).toBe('game_over');
      expect(final.winnerFaction).not.toBeNull();
    } finally {
      closeTable(table);
    }
  }, 90_000);
});

function pick(bots: SocketBot[], rng: () => number): SocketBot {
  return bots[Math.floor(rng() * bots.length)]!;
}
