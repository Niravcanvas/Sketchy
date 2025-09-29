import type { ApplyResult, EngineErrorCode } from '@sketchy/engine/apply-action';
import type { GameEffect } from '@sketchy/engine/effects';
import type { GameState } from '@sketchy/engine/types';
import { getRedis } from '../db/client.js';

/** TTL applied to every room key, refreshed on every accepted action
 * (data-model.md §2). Exported for `rooms/pair-draw.ts` and `sockets/play.ts`,
 * which write their own room-scoped keys (`usedPairs`, `gameId`) outside this
 * module's CAS transaction and need the same lifetime. */
export const ROOM_TTL_SECONDS = 24 * 60 * 60;

function stateKey(code: string): string {
  return `room:${code}:state`;
}
function verKey(code: string): string {
  return `room:${code}:ver`;
}
function lockKey(code: string): string {
  return `room:${code}:lock`;
}
function connKey(code: string): string {
  return `room:${code}:conn`;
}
/** Exported: `rooms/pair-draw.ts` reads/writes this set directly (SMEMBERS to
 * exclude already-played pairs, SADD on a successful draw, DEL to recycle). */
export function usedPairsKey(code: string): string {
  return `room:${code}:usedPairs`;
}
/** `room:{code}:gameId` (data-model.md §2) — the running
 * `games.id`, set by `sockets/play.ts`'s `game:start` handler and read back
 * at game-over to complete that row. */
export function gameIdKey(code: string): string {
  return `room:${code}:gameId`;
}
/** `room:{code}:abandonedAt` — epoch ms at which the abandon sweeper
 * first observed a mid-game room with EVERY player disconnected. Reaped once
 * `now - abandonedAt >= ABANDON_MS` (game-design.md §8 "Abandoned rooms").
 * Persisted in Redis (not in-memory) so the reap survives an API restart —
 * the sweeper is restart-safe by re-reading this key, not by holding a timer. */
export function abandonedAtKey(code: string): string {
  return `room:${code}:abandonedAt`;
}
/** `room:{code}:voice` — Redis hash of playerId → mute state, the
 * `voice:state`/`voice:roster` mirror's durable side (`rooms/voice-store.ts`,
 * which imports this key builder + `ROOM_TTL_SECONDS` back from here, same
 * one-directional pattern as `rooms/pair-draw.ts`'s `usedPairsKey` import —
 * this module stays the single place every room-scoped Redis key is named). */
export function voiceKey(code: string): string {
  return `room:${code}:voice`;
}
/** `room:{code}:chatlog` — a capped Redis LIST of the room's most
 * recent chat lines (JSON `{id,name,text,at}`), maintained by `sockets/lobby.ts`
 * `handleChatSend` (RPUSH + LTRIM). Chat is ephemeral by design (never in
 * `room:snapshot`/state), but a report needs recent CONTEXT — this ring buffer
 * is the ONLY place recent chat is retained server-side, read by
 * `moderation/report-context.ts` when a report is filed.
 * Ephemeral like every other room key (24h TTL); never surfaced to players. */
export function chatLogKey(code: string): string {
  return `room:${code}:chatlog`;
}

export interface LoadedRoom {
  state: GameState;
  ver: number;
}

/** Plain (non-CAS) read — used for pre-join resolution, chat, and `room:sync`,
 * none of which mutate state (data-model.md §2). */
export async function loadRoom(code: string): Promise<LoadedRoom | null> {
  const redis = getRedis();
  const [stateRaw, verRaw] = await redis.mget(stateKey(code), verKey(code));
  if (!stateRaw || !verRaw) {
    return null;
  }
  return { state: JSON.parse(stateRaw) as GameState, ver: Number.parseInt(verRaw, 10) };
}

/**
 * Seeds a brand-new room: `SET state NX` + `SET ver 1` + TTLs on every key
 * (data-model.md §2 `createRoom` spec). Returns `false` if `state` already
 * existed (shouldn't happen given the code was just claimed via
 * `allocateRoomCode`'s `lock` key, but the NX guard makes this function safe
 * to call unconditionally rather than trusting that invariant blindly).
 */
export async function createRoom(code: string, state: GameState): Promise<boolean> {
  const redis = getRedis();
  const claimed = await redis.set(
    stateKey(code),
    JSON.stringify(state),
    'EX',
    ROOM_TTL_SECONDS,
    'NX',
  );
  if (claimed !== 'OK') {
    return false;
  }
  await redis
    .multi()
    .set(verKey(code), 1, 'EX', ROOM_TTL_SECONDS)
    .expire(lockKey(code), ROOM_TTL_SECONDS)
    .exec();
  return true;
}

export type RoomReducer = (state: GameState) => ApplyResult;

/**
 * `effects` rides alongside the accepted state/ver — the
 * reducer's `ApplyResult.effects` (data-model.md §3), which lobby actions
 * never produce, but every game-play handler
 * in `sockets/play.ts` (via `rooms/apply-and-broadcast.ts`) and the timer
 * wheel (`rooms/timer-wheel.ts`) must route to `startTimer`/`clearTimer`.
 */
export type ApplyRoomActionResult =
  | { ok: true; state: GameState; ver: number; effects: GameEffect[] }
  | { ok: false; error: EngineErrorCode | 'internal' };

/**
 * Bounded CAS retry count. Data-model.md §2 originally specified
 * "retry ONCE" on the assumption that "a single API process makes conflicts
 * near-impossible". That holds for the turn-based hot path, but NOT for the
 * genuine burst cases resilience introduced: every phone on a table dropping at
 * once (all firing `presence:false` on the same room), or the whole table's
 * ballots landing in the same tick at vote close. Under N-way contention a
 * single retry can lose an update — a dropped `presence:false` leaves a player
 * stuck `connected:true`, which (fatally) stops the abandon reaper from ever
 * firing. A small bounded retry with jittered backoff makes the CAS actually
 * serialize an N-writer burst; still bounded so a pathological hot key fails
 * fast rather than spinning. (data-model.md §2 updated to match.)
 */
const MAX_CAS_ATTEMPTS = 8;

function casBackoffMs(attempt: number): number {
  // Small jittered backoff so concurrent writers don't lock-step and livelock.
  return Math.min(2 ** attempt, 12) + Math.floor(Math.random() * 4);
}

/**
 * CAS write discipline (data-model.md §2): `WATCH room:{code}:ver` → `GET state`
 * → run `reduce` → `MULTI` (`SET state`, `SET nextVer`, TTL refresh on every
 * room key) → `EXEC`; on a `null` EXEC (a concurrent writer changed `ver`
 * first) retry from a freshly re-read state, up to `MAX_CAS_ATTEMPTS`, then give
 * up with `internal`.
 *
 * Connection choice: this duplicates a fresh ioredis connection per call
 * rather than reusing the shared `getRedis()` client. `WATCH` is scoped to
 * the CONNECTION that issued it, and the shared client is one multiplexed
 * TCP connection serving every concurrent, unrelated command in this
 * process (the rate limiter, other rooms' CAS calls, presence hash writes,
 * ...). Two overlapping CAS calls sharing that connection would corrupt
 * each other: a second `WATCH` before the first `EXEC` merely ADDS to the
 * same connection-wide watched-key set, and the first `EXEC` clears watches
 * for the WHOLE connection — silently disarming the second call's
 * optimistic lock. A fresh `duplicate()` per call sidesteps that without a
 * hand-rolled connection pool or a mutex serializing unrelated rooms; at
 * this project's scale (single process, action rate capped at 60/min/player,
 * "~50-100 active rooms", system-design.md §0) the extra TCP setup per
 * accepted action is not a meaningful cost, and is the chosen alternative to
 * a small pool.
 */
export async function applyRoomAction(code: string, reduce: RoomReducer): Promise<ApplyRoomActionResult> {
  const client = getRedis().duplicate();
  try {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      await client.watch(verKey(code));
      const [stateRaw, verRaw] = await client.mget(stateKey(code), verKey(code));
      if (!stateRaw || !verRaw) {
        await client.unwatch();
        return { ok: false, error: 'internal' };
      }

      const state = JSON.parse(stateRaw) as GameState;
      const result = reduce(state);

      if (result.error) {
        await client.unwatch();
        return { ok: false, error: result.error };
      }

      const nextVer = Number.parseInt(verRaw, 10) + 1;
      const execResult = await client
        .multi()
        .set(stateKey(code), JSON.stringify(result.state), 'EX', ROOM_TTL_SECONDS)
        .set(verKey(code), nextVer, 'EX', ROOM_TTL_SECONDS)
        .expire(lockKey(code), ROOM_TTL_SECONDS)
        .expire(connKey(code), ROOM_TTL_SECONDS)
        .expire(usedPairsKey(code), ROOM_TTL_SECONDS)
        .exec();

      if (execResult === null) {
        // WATCH conflict — another writer committed first. Back off briefly and
        // retry from a fresh read (a re-run of `reduce` against current state).
        if (attempt < MAX_CAS_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, casBackoffMs(attempt)));
        }
        continue;
      }
      return { ok: true, state: result.state, ver: nextVer, effects: result.effects };
    }
    return { ok: false, error: 'internal' };
  } finally {
    client.disconnect();
  }
}

export interface ConnEntry {
  socketId: string;
  lastSeenAt: number;
  /** Epoch ms this player's socket dropped, set on `disconnect` and cleared on
   * (re)connect. Presence of this field is the durable record that a
   * grace window is running — `sockets/presence-timers.ts` re-arms grace timers
   * from it on boot (Redis is truth, mirroring the phase-deadline timer wheel). */
  disconnectedAt?: number;
}

/** `room:{code}:conn` hash read (data-model.md §2) — playerId → `{socketId,
 * lastSeenAt}`, driving presence and session-supersede decisions. */
export async function getConnEntry(code: string, playerId: string): Promise<ConnEntry | null> {
  const raw = await getRedis().hget(connKey(code), playerId);
  return raw ? (JSON.parse(raw) as ConnEntry) : null;
}

/** Every presence entry for a room — used by host-migration to pick
 * the longest-connected alive player by `lastSeenAt`, and by the boot re-arm
 * to find running grace windows. */
export async function getAllConnEntries(code: string): Promise<Record<string, ConnEntry>> {
  const raw = await getRedis().hgetall(connKey(code));
  const out: Record<string, ConnEntry> = {};
  for (const [playerId, value] of Object.entries(raw)) {
    out[playerId] = JSON.parse(value) as ConnEntry;
  }
  return out;
}

export async function setConnEntry(code: string, playerId: string, entry: ConnEntry): Promise<void> {
  const redis = getRedis();
  await redis
    .multi()
    .hset(connKey(code), playerId, JSON.stringify(entry))
    .expire(connKey(code), ROOM_TTL_SECONDS)
    .exec();
}

export async function deleteConnEntry(code: string, playerId: string): Promise<void> {
  await getRedis().hdel(connKey(code), playerId);
}

/**
 * Removes every Redis key for a room in one shot (abandon reaping):
 * state, ver, lock, conn, usedPairs, gameId, abandonedAt, voice,
 * chatlog. Used after an abandoned game is persisted
 * (`rooms/persist-game.ts`) to free the room — the game's durable record now
 * lives in Postgres, so Redis retains nothing. (The public-lobby index is
 * pruned separately: a reaped room was mid-game, so it had already left the
 * lobby index at `game:start`.)
 */
export async function deleteRoomKeys(code: string): Promise<void> {
  await getRedis().del(
    stateKey(code),
    verKey(code),
    lockKey(code),
    connKey(code),
    usedPairsKey(code),
    gameIdKey(code),
    abandonedAtKey(code),
    voiceKey(code),
    chatLogKey(code),
  );
}
