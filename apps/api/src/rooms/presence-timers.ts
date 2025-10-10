import { applyAction } from '@sketchy/engine/apply-action';
import type { GameState } from '@sketchy/engine/types';
import { SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import { getRedis } from '../db/client.js';
import type { GameNamespace } from '../sockets/types.js';
import { persistAbandonedGame } from './persist-game.js';
import {
  abandonedAtKey,
  applyRoomAction,
  deleteRoomKeys,
  getAllConnEntries,
  loadRoom,
  ROOM_TTL_SECONDS,
} from './room-store.js';
import { broadcastSnapshots } from './snapshot.js';
import { clearTimer } from './timer-wheel.js';

/**
 * The SECOND class of server-owned timer, distinct from the phase-deadline
 * timer wheel (`rooms/timer-wheel.ts`): per-PLAYER disconnect grace windows and
 * the per-ROOM abandon reaper (game-design.md §8 "Disconnects" / "Abandoned
 * rooms"). Kept in its own module — the phase wheel is one-timer-per-room keyed
 * by the engine's `phaseEndsAt`; grace is one-timer-per-(room,player) keyed by a
 * disconnect deadline the engine knows nothing about.
 *
 * Same durability contract as the phase wheel: Redis is the source of truth
 * (`room:{code}:conn`'s `disconnectedAt`, `room:{code}:abandonedAt`), this
 * module is only a scheduling cache over it, rebuilt on boot
 * (`rearmGraceTimersFromRedis`, `startAbandonSweeper`). A process restart never
 * loses a grace window or an abandonment deadline, only the in-memory
 * `setTimeout`/`setInterval` backing them.
 *
 * Logging note: like `timer-wheel.ts`, these fire from timer callbacks with no
 * request context, so they use plain `console.*` (same choice as `db/client.ts`).
 */

/**
 * Timing windows (game-design.md §8): 90-s disconnect grace, 10-min abandon
 * deadline, 60-s reaper cadence. Read from env each time so integration/e2e/load
 * tests can shrink them (`GRACE_WINDOW_MS` etc.) without waiting out real
 * minutes; production leaves them unset and gets the spec defaults. Documented
 * in `.env.example` as optional tuning knobs.
 */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
/** 90-second disconnect grace (game-design.md §8: "a 90-second grace window"). */
export function graceWindowMs(): number {
  return envMs('GRACE_WINDOW_MS', 90_000);
}
/** All players disconnected >10 min mid-game → the room is abandoned (game-design.md §8). */
export function abandonMs(): number {
  return envMs('ABANDON_MS', 10 * 60_000);
}
/** How often the abandon reaper re-scans live rooms. A room is reaped at most
 * one sweep after its grace-plus-abandon deadline actually passes. */
export function abandonSweepMs(): number {
  return envMs('ABANDON_SWEEP_MS', 60_000);
}

interface ArmedGrace {
  timeout: NodeJS.Timeout;
}

/** Keyed `${code}:${playerId}` — at most one pending grace timer per player. */
const graceTimers = new Map<string, ArmedGrace>();

function graceKey(code: string, playerId: string): string {
  return `${code}:${playerId}`;
}

/**
 * Arms (replacing any existing) a grace timer for one disconnected player: at
 * `graceEndsAt`, run `fireGrace`. A deadline already in the past fires
 * ~immediately (the desired catch-up on boot).
 */
export function armGraceTimer(
  namespace: GameNamespace,
  code: string,
  playerId: string,
  graceEndsAt: number,
): void {
  clearGraceTimer(code, playerId);
  const delayMs = Math.max(0, graceEndsAt - Date.now());
  const timeout = setTimeout(() => {
    void fireGrace(namespace, code, playerId);
  }, delayMs);
  // Never let a pending grace timer keep the process alive on its own
  // (mirrors the sweep interval below) — shutdown clears them explicitly.
  timeout.unref?.();
  graceTimers.set(graceKey(code, playerId), { timeout });
}

/** Cancels a player's pending grace timer, if any (no-op otherwise). Called on
 * (re)connect, explicit leave, and kick. */
export function clearGraceTimer(code: string, playerId: string): void {
  const key = graceKey(code, playerId);
  const existing = graceTimers.get(key);
  if (existing) {
    clearTimeout(existing.timeout);
    graceTimers.delete(key);
  }
}

/** Cancels every pending grace timer for a room (used when the room is reaped). */
export function clearRoomGraceTimers(code: string): void {
  for (const key of graceTimers.keys()) {
    if (key.startsWith(`${code}:`)) {
      const existing = graceTimers.get(key);
      if (existing) clearTimeout(existing.timeout);
      graceTimers.delete(key);
    }
  }
}

/** Cancels every pending grace timer in this process (fastify `onClose`). */
export function clearAllGraceTimers(): void {
  for (const entry of graceTimers.values()) {
    clearTimeout(entry.timeout);
  }
  graceTimers.clear();
}

/** Test-only: is a grace timer currently armed for this player? */
export function isGraceTimerArmed(code: string, playerId: string): boolean {
  return graceTimers.has(graceKey(code, playerId));
}

/**
 * Picks the successor host when the sitting host's grace expires (or they leave
 * mid-game): the longest-connected ALIVE player, i.e. the currently-connected
 * alive player whose socket has been bound the longest (smallest `lastSeenAt`),
 * seat order breaking ties. Returns `null` when nobody qualifies (every other
 * player is also gone — the room is on its way to being reaped anyway).
 */
export async function pickMigrationHost(state: GameState, code: string): Promise<string | null> {
  const candidates = state.players.filter(
    (p) => p.alive && p.connected && p.id !== state.hostId,
  );
  if (candidates.length === 0) return null;

  const conn = await getAllConnEntries(code);
  candidates.sort((a, b) => {
    const seenA = conn[a.id]?.lastSeenAt ?? Number.POSITIVE_INFINITY;
    const seenB = conn[b.id]?.lastSeenAt ?? Number.POSITIVE_INFINITY;
    if (seenA !== seenB) return seenA - seenB;
    return a.seat - b.seat;
  });
  return candidates[0]?.id ?? null;
}

/**
 * Dispatches the `migrateHost` engine action, broadcasts the fresh snapshot
 * (the new host's `canAct` flips on automatically — `rooms/snapshot.ts`
 * `buildCanAct` reads `hostId`), and fans out the `hostChanged` toast
 * (copy.md §8). Shared by the three migration triggers: grace expiry (below),
 * explicit host `room:leave` (`sockets/lobby.ts`), and the host's manual
 * `host:transfer` hand-back (`sockets/play.ts`). The AUTHORITY decision (may
 * this migration happen? who inherits?) is the caller's; this only applies it.
 */
export async function migrateHostTo(
  namespace: GameNamespace,
  code: string,
  newHostId: string,
): Promise<boolean> {
  let name = '';
  const result = await applyRoomAction(code, (state) => {
    name = state.players.find((p) => p.id === newHostId)?.name ?? '';
    return applyAction(state, { type: 'migrateHost', newHostId, at: Date.now() });
  });
  if (!result.ok) return false;

  broadcastSnapshots(namespace, code, result.state, result.ver);
  namespace.to(code).emit(SERVER_EVENTS.roomEvent, { type: 'hostChanged', playerId: newHostId, name });
  return true;
}

/**
 * A player's grace window expired. The only hard state consequence is HOST
 * migration (game-design.md §8: "Host loses connection for >grace: host badge
 * auto-migrates to the longest-connected alive player"). A non-host's expiry is
 * a no-op here — they keep their seat ("skipped-not-removed"); the host's
 * clue-turn skip affordance and the phase timers already keep play moving, and
 * a rejoining player re-activates at the next phase boundary. Re-fires safely:
 * a player who reconnected before this ran is `connected: true` again and skips.
 */
async function fireGrace(namespace: GameNamespace, code: string, playerId: string): Promise<void> {
  graceTimers.delete(graceKey(code, playerId));
  try {
    // READ-ONLY: the disconnect handler already applied `connected: false`, so
    // grace expiry only needs to inspect state — a no-op write here would both
    // waste a CAS round on every expiry (matters at load) and, worse, could
    // resurrect a room the abandon reaper deleted in the same tick. The only
    // write grace expiry ever makes is a genuine host migration below.
    const room = await loadRoom(code);
    if (!room) return; // room reaped / gone.

    const state = room.state;
    const player = state.players.find((p) => p.id === playerId);
    if (!player || player.connected) return; // reconnected in the meantime.
    if (state.hostId !== playerId) return; // non-host grace expiry: nothing to do.
    if (state.phase === 'lobby' || state.phase === 'game_over') return;

    const newHostId = await pickMigrationHost(state, code);
    if (!newHostId) return;
    await migrateHostTo(namespace, code, newHostId);
  } catch (error) {
    console.error(`presence-timers: grace fire failed for ${code}/${playerId}`, error);
  }
}

/**
 * Boot-time catch-up for grace windows (mirrors `timer-wheel.ts`'s
 * `rearmTimersFromRedis`). Cursor-scans `room:*:conn`, and for every entry whose
 * `disconnectedAt` is set AND whose player is still `connected: false` in the
 * room state, re-arms a grace timer at `disconnectedAt + GRACE_MS` — already-past
 * deadlines fire immediately, correctly migrating a host who vanished during the
 * downtime. Returns the count re-armed.
 */
export async function rearmGraceTimersFromRedis(namespace: GameNamespace): Promise<number> {
  const redis = getRedis();
  let cursor = '0';
  let count = 0;
  const connPattern = /^room:(.+):conn$/;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'room:*:conn', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const match = connPattern.exec(key);
      if (!match) continue;
      const code = match[1] as string;
      const stateRaw = await redis.get(`room:${code}:state`);
      if (!stateRaw) continue;
      const state = JSON.parse(stateRaw) as GameState;
      const conn = await getAllConnEntries(code);
      for (const [playerId, entry] of Object.entries(conn)) {
        if (entry.disconnectedAt === undefined) continue;
        const player = state.players.find((p) => p.id === playerId);
        if (!player || player.connected) continue;
        armGraceTimer(namespace, code, playerId, entry.disconnectedAt + graceWindowMs());
        count += 1;
      }
    }
  } while (cursor !== '0');
  return count;
}

let sweepInterval: NodeJS.Timeout | undefined;

/** Starts the periodic abandon reaper. Idempotent — a second call is a no-op. */
export function startAbandonSweeper(namespace: GameNamespace): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    // Never let a sweep that races connection teardown (e.g. between a server
    // close and the shared Redis client's disconnect in tests) surface as an
    // unhandled rejection — the next tick just tries again.
    void sweepAbandonedRooms(namespace).catch((error) => {
      console.error('presence-timers: abandon sweep pass failed', error);
    });
  }, abandonSweepMs());
  sweepInterval.unref?.();
}

/** Stops the reaper (fastify `onClose`). */
export function stopAbandonSweeper(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = undefined;
  }
}

/**
 * One reaper pass (exported for the chaos/restart tests to drive deterministically
 * instead of waiting out the interval). For every mid-game room:
 * - all players disconnected → stamp/read `room:{code}:abandonedAt`; once the
 *   room has been fully empty for `ABANDON_MS`, persist it as an UNFINISHED game
 *   (winner NULL, `rooms/persist-game.ts`) and delete every Redis key for it.
 * - anyone still connected → clear any stale `abandonedAt` so a recovered room's
 *   clock resets.
 * Lobby / game_over rooms are ignored: a lobby simply expires on its 24 h TTL
 * (game-design.md §8), and a finished game is already persisted.
 */
export async function sweepAbandonedRooms(namespace: GameNamespace): Promise<void> {
  const redis = getRedis();
  let cursor = '0';
  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'room:*:state', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const match = /^room:(.+):state$/.exec(key);
        if (!match) continue;
        const code = match[1] as string;
        try {
          await sweepOneRoom(namespace, code);
        } catch (error) {
          console.error(`presence-timers: abandon sweep failed for room ${code}`, error);
        }
      }
    } while (cursor !== '0');
  } catch (error) {
    // The SCAN itself failed (Redis unavailable / teardown) — abandon this pass.
    console.error('presence-timers: abandon sweep scan failed', error);
  }
}

async function sweepOneRoom(namespace: GameNamespace, code: string): Promise<void> {
  const redis = getRedis();
  const stateRaw = await redis.get(`room:${code}:state`);
  if (!stateRaw) return;
  const state = JSON.parse(stateRaw) as GameState;

  const midGame = state.phase !== 'lobby' && state.phase !== 'game_over';
  const allDisconnected =
    state.players.length > 0 && state.players.every((p) => !p.connected);

  if (!midGame || !allDisconnected) {
    // Recovered (or never eligible) — reset the clock if one was running.
    await redis.del(abandonedAtKey(code));
    return;
  }

  const abandonedRaw = await redis.get(abandonedAtKey(code));
  const now = Date.now();
  if (!abandonedRaw) {
    await redis.set(abandonedAtKey(code), String(now), 'EX', ROOM_TTL_SECONDS);
    return;
  }
  if (now - Number.parseInt(abandonedRaw, 10) < abandonMs()) return;

  // Reap: persist as unfinished, then free every Redis key for the room.
  await persistAbandonedGame(code, state);
  clearRoomGraceTimers(code);
  clearTimer(code);
  await deleteRoomKeys(code);
  console.info(`presence-timers: reaped abandoned room ${code} (round ${state.round}, ${state.phase})`);
}
