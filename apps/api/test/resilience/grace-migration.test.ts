import type { RoomEvent } from '@sketchy/shared/contract/socket';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllGraceTimers,
  isGraceTimerArmed,
  stopAbandonSweeper,
} from '../../src/rooms/presence-timers.js';
import { buildServer } from '../../src/server.js';
import { SocketBot, sleep } from '../bots/socket-bot.js';
import {
  botFor,
  closeTable,
  createTable,
  freshestState,
  playToGameOver,
  roleMap,
} from '../bots/table.js';

/**
 * Grace window + host migration end-to-end (game-design.md §8). Uses a SHRUNK
 * grace window (`GRACE_WINDOW_MS`) so the 90s
 * spec default doesn't make the suite wait out real minutes — the code path is
 * identical, only the deadline moves.
 */

const GRACE_MS = 150;

function hostChangedEvents(bot: SocketBot): RoomEvent[] {
  return bot.events.filter((e) => e.type === 'hostChanged');
}

async function waitFor(pred: () => boolean, desc: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${desc}`);
    await sleep(20);
  }
}

describe('grace window + host migration', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let previousGrace: string | undefined;

  beforeAll(() => {
    previousGrace = process.env.GRACE_WINDOW_MS;
    process.env.GRACE_WINDOW_MS = String(GRACE_MS);
  });
  afterAll(() => {
    if (previousGrace === undefined) delete process.env.GRACE_WINDOW_MS;
    else process.env.GRACE_WINDOW_MS = previousGrace;
  });

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });
  afterEach(async () => {
    // Stop background timers BEFORE tearing down the socket adapter so a grace
    // fire can't emit through a closing redis-adapter pub client (benign
    // "Connection is closed." race). Production's onClose does the same ordering.
    clearAllGraceTimers();
    stopAbandonSweeper();
    await server.close();
  });

  it('migrates the host to the longest-connected alive player after grace expiry', async () => {
    const table = await createTable(server, baseUrl, { n: 4, namePrefix: 'Grace' });
    try {
      await table.host.waitForPhase('clue');
      const originalHostId = table.host.playerId;
      expect(freshestState(table).hostId).toBe(originalHostId);

      // The host's phone dies.
      table.host.hardDisconnect();

      // A witness (still-connected) bot should see the hostChanged toast + a
      // snapshot whose hostId is no longer the original host.
      const witness = table.bots[1]!;
      await waitFor(() => hostChangedEvents(witness).length > 0, 'hostChanged toast');
      const newHostId = freshestState(table).hostId;
      expect(newHostId).not.toBe(originalHostId);
      // Longest-connected alive = seat 1 (connected first among the survivors).
      expect(newHostId).toBe(witness.playerId);

      // The new host actually holds host powers now (canAct derives from hostId).
      const newHostSnap = witness.latest()!;
      expect(newHostSnap.you.playerId).toBe(newHostId);
      expect(newHostSnap.you.canAct.advancePhase || newHostSnap.state.phase === 'clue').toBe(true);

      // No grace timer should still be armed for the (now-migrated) old host.
      expect(isGraceTimerArmed(table.code, originalHostId)).toBe(false);
    } finally {
      closeTable(table);
    }
  });

  it('does NOT auto-reclaim host when the original host reconnects', async () => {
    const table = await createTable(server, baseUrl, { n: 3, namePrefix: 'Reclaim' });
    try {
      await table.host.waitForPhase('clue');
      const originalHostId = table.host.playerId;
      const witness = table.bots[1]!;

      table.host.hardDisconnect();
      await waitFor(() => hostChangedEvents(witness).length > 0, 'migration');
      const newHostId = freshestState(table).hostId;
      expect(newHostId).not.toBe(originalHostId);

      // Original host comes back — must rejoin as a REGULAR player (no flapping).
      await table.host.reconnect();
      await sleep(GRACE_MS * 2);
      expect(freshestState(table).hostId).toBe(newHostId);
      expect(table.host.latest()!.you.canAct.advancePhase).toBe(false);
    } finally {
      closeTable(table);
    }
  });

  it('migrates immediately on an explicit mid-game host leave (no grace wait)', async () => {
    const table = await createTable(server, baseUrl, { n: 3, namePrefix: 'Leave' });
    try {
      await table.host.waitForPhase('clue');
      const originalHostId = table.host.playerId;
      const witness = table.bots[1]!;

      const ack = await table.host.leave();
      expect(ack.ok).toBe(true);

      await waitFor(() => hostChangedEvents(witness).length > 0, 'immediate migration');
      expect(freshestState(table).hostId).not.toBe(originalHostId);
    } finally {
      closeTable(table);
    }
  });

  it('supports manual host:transfer (host-only) and rejects a non-host transfer', async () => {
    const table = await createTable(server, baseUrl, { n: 4, namePrefix: 'Xfer' });
    try {
      await table.host.waitForPhase('clue');
      const target = table.bots[2]!;

      // A non-host cannot transfer.
      const badAck = await table.bots[1]!.hostTransfer(target.playerId);
      expect(badAck).toEqual({ ok: false, error: 'not_host' });

      // The host hands the pencil to bot2.
      const ack = await table.host.hostTransfer(target.playerId);
      expect(ack.ok).toBe(true);
      await waitFor(() => hostChangedEvents(target).length > 0, 'hostChanged after transfer');
      expect(freshestState(table).hostId).toBe(target.playerId);
    } finally {
      closeTable(table);
    }
  });

  it('live drill: host tab dies mid-vote → migration fires, vote still closes, original host rejoins as a regular player', async () => {
    // The automated form of a manual 3-device drill.
    const table = await createTable(server, baseUrl, {
      n: 4,
      namePrefix: 'Drill',
      settings: { undercoverCount: 1, mrWhiteCount: 0, voteTimerSec: 2 },
    });
    try {
      await playToGameOver(table, {
        priority: (role) => (role === 'undercover' ? 0 : 1),
        until: (s) => s.phase === 'voting',
        timeoutMs: 15_000,
      });
      const originalHostId = table.host.playerId;
      const witness = table.bots[1]!;
      const alive = freshestState(table).players.filter((p) => p.alive);

      // The host kills their tab mid-vote.
      table.host.hardDisconnect();

      // Migration fires on grace expiry → someone else holds the pencil.
      await waitFor(() => hostChangedEvents(witness).length > 0, 'host migration');
      const newHostId = freshestState(table).hostId;
      expect(newHostId).not.toBe(originalHostId);

      // The remaining players vote the undercover out; the vanished host abstains
      // at the vote timer, and the vote still closes correctly.
      const roles = roleMap(table);
      const target =
        alive.find((p) => roles.get(p.id) === 'undercover') ??
        alive.find((p) => p.id !== originalHostId)!;
      for (const p of alive) {
        if (p.id === originalHostId) continue;
        const bot = botFor(table, p.id)!;
        const targetId =
          p.id === target.id ? alive.find((a) => a.id !== target.id && a.id !== originalHostId)!.id : target.id;
        await bot.vote(targetId);
      }
      await witness.waitForSnapshot((s) => s.state.phase !== 'voting', 'vote closes', 6000);
      const eliminated = freshestState(table).players.find((p) => p.id === target.id);
      expect(freshestState(table).pendingElimination === target.id || !eliminated?.alive).toBe(true);

      // The original host reconnects — as a REGULAR player, not the host.
      await table.host.reconnect();
      await sleep(GRACE_MS * 2);
      expect(freshestState(table).hostId).toBe(newHostId);
      expect(table.host.latest()!.you.canAct.advancePhase).toBe(false);
    } finally {
      closeTable(table);
    }
  });

  it('treats a session supersede as instant (no disconnect+grace churn, no migration)', async () => {
    const table = await createTable(server, baseUrl, { n: 3, namePrefix: 'Super' });
    try {
      await table.host.waitForPhase('clue');
      const hostId = table.host.playerId;

      // The host opens the room on a SECOND device (same identity/token).
      const second = new SocketBot(baseUrl, {
        token: table.host.token,
        playerId: table.host.playerId,
        displayName: table.host.displayName,
      });
      await second.connect();
      const ack = await second.join(table.code);
      expect(ack.ok).toBe(true);

      // The original tab is superseded, not "disconnected then reconnected".
      await waitFor(() => table.host.superseded, 'original tab superseded');

      // Device-switch must be instant: no grace window left running, host unchanged.
      await sleep(GRACE_MS * 2);
      expect(isGraceTimerArmed(table.code, hostId)).toBe(false);
      expect(freshestState(table).hostId).toBe(hostId);
      // No spurious hostChanged from the supersede.
      expect(hostChangedEvents(table.bots[1]!).length).toBe(0);

      second.close();
    } finally {
      closeTable(table);
    }
  });
});
