import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isGraceTimerArmed } from '../../src/rooms/presence-timers.js';
import { loadRoom } from '../../src/rooms/room-store.js';
import { buildServer } from '../../src/server.js';
import { sleep } from '../bots/socket-bot.js';
import { closeTable, createTable, playToGameOver, priority } from '../bots/table.js';

/**
 * Timer-wheel restart proof (system-design.md §9): the
 * server owns every deadline, Redis (`phaseEndsAt`, `conn.disconnectedAt`) is
 * the source of truth, and a process restart re-arms both timer classes from it.
 * We simulate a container restart in-process: capture the port, `server.close()`
 * (its onClose clears every in-memory timer), then `buildServer()` + re-listen on
 * the SAME port (registerSockets' boot re-arm runs). If durability were broken,
 * the re-armed deadline would never fire and the room would hang forever.
 */

const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  saved[k] = process.env[k];
  process.env[k] = v;
}

async function pollRoom(
  code: string,
  predicate: (room: NonNullable<Awaited<ReturnType<typeof loadRoom>>>) => boolean,
  desc: string,
  timeoutMs = 6000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const room = await loadRoom(code);
    if (room && predicate(room)) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${desc}`);
    await sleep(60);
  }
}

describe('timer-wheel restart durability', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let port: number;

  beforeAll(() => {
    setEnv('GRACE_WINDOW_MS', '250');
    // Keep the reaper from interfering with these short-lived rooms.
    setEnv('ABANDON_MS', '600000');
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
    await server.close();
  });

  /** Kills and re-launches the API on the same port (boot re-arm runs on start). */
  async function restart(): Promise<void> {
    await server.close();
    server = await buildServer();
    baseUrl = await server.listen({ port });
  }

  it('re-arms and fires a mid-CLUE timer after a restart (auto-skip the stalled turn)', async () => {
    const table = await createTable(server, baseUrl, {
      n: 4,
      namePrefix: 'ClueTimer',
      settings: { clueTimerSec: 3 },
    });
    const code = table.code;
    try {
      await table.host.waitForPhase('clue');
      const before = await loadRoom(code);
      expect(before!.state.phase).toBe('clue');
      expect(before!.state.clues.length).toBe(0);

      // Restart while the clue turn is still open — the in-memory timer dies,
      // Redis keeps `phaseEndsAt`.
      closeTable(table);
      await restart();

      // The re-armed timer fires at the original deadline → a skipped clue lands.
      await pollRoom(code, (r) => r.state.clues.length >= 1, 'auto-skip after restart');
    } finally {
      closeTable(table);
    }
  });

  it('re-arms and fires a mid-VOTE timer after a restart (vote closes on the deadline)', async () => {
    const table = await createTable(server, baseUrl, {
      n: 4,
      namePrefix: 'VoteTimer',
      settings: { voteTimerSec: 3 },
    });
    const code = table.code;
    try {
      // Drive clue+discussion, then halt at voting WITHOUT casting ballots.
      await playToGameOver(table, {
        priority: priority.civilianWin,
        until: (s) => s.phase === 'voting',
        timeoutMs: 15_000,
      });
      const before = await loadRoom(code);
      expect(before!.state.phase).toBe('voting');
      const roundBefore = before!.state.round;

      closeTable(table);
      await restart();

      // The re-armed vote timer fires → all abstain → the game moves on
      // (next clue round or a reveal), proving the deadline survived.
      await pollRoom(
        code,
        (r) => r.state.phase !== 'voting' || r.state.round > roundBefore,
        'vote close after restart',
      );
    } finally {
      closeTable(table);
    }
  });

  it('re-arms a running grace window from Redis after a restart', async () => {
    // A long grace so the window is still OPEN right after the restart, making
    // the re-arm directly observable (the migration-on-expiry behaviour itself
    // is covered by grace-migration.test.ts).
    const prevGrace = process.env.GRACE_WINDOW_MS;
    process.env.GRACE_WINDOW_MS = '5000';
    const table = await createTable(server, baseUrl, { n: 3, namePrefix: 'GraceRestart' });
    const code = table.code;
    const hostId = table.host.playerId;
    try {
      await table.host.waitForPhase('clue');

      // Host drops; a grace window is now running in Redis (conn.disconnectedAt).
      table.host.hardDisconnect();
      await sleep(60);
      expect(isGraceTimerArmed(code, hostId)).toBe(true);

      // Restart before grace expires — the in-memory timer dies with the process,
      // Redis keeps `disconnectedAt`.
      closeTable(table);
      await restart();

      // Boot re-arm rebuilt the grace timer purely from Redis — proving the
      // second timer class survives a restart, same as the phase wheel.
      expect(isGraceTimerArmed(code, hostId)).toBe(true);
    } finally {
      if (prevGrace === undefined) delete process.env.GRACE_WINDOW_MS;
      else process.env.GRACE_WINDOW_MS = prevGrace;
      closeTable(table);
    }
  });
});
