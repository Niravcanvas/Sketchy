import { SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import { inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { blockedPairsWithin, isPairBlocked } from '../moderation/blocks.js';
import { createOnlineRoom } from '../rooms/create-room-service.js';
import { allPublicLobbyCodes, publicLobbyLanguage } from '../rooms/public-lobbies.js';
import { loadRoom } from '../rooms/room-store.js';
import type { GameNamespace } from '../sockets/types.js';
import { personalRoom } from './personal-room.js';
import { dequeueMany, listQueue, type QueueEntry } from './queue-store.js';

/**
 * The quick-join matcher. An in-process
 * interval worker — deliberately simple for launch scale (system-design.md §0:
 * "~50-100 active rooms"). Each tick:
 *
 *  1. Prunes stale queue entries (a crashed client that never cancelled).
 *  2. Groups the queue by language (FIFO within each group).
 *  3. FILLS EXISTING public lobbies of that language first (immediate — no
 *     reason to make someone wait when there's an open table).
 *  4. FORMS new public rooms from the rest, targeting 6–8 players, but only
 *     once the group hits the target OR the oldest waiter has waited long
 *     enough (so 2 people don't wait forever for a 6th that never comes).
 *
 * Block-aware throughout: a player is never seated with anyone they've blocked
 * or who blocked them. Resolution is pushed as
 * `mm:matched { code }` to each matched player's personal socket room.
 *
 * Single process today; the same design lifts to multi-process later because
 * the queue + lobby index + room state all live in shared Redis (only the
 * interval itself is per-process — a future refinement would elect one runner).
 */

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** How often the matcher runs. */
const INTERVAL_MS = num(process.env.MATCH_INTERVAL_MS, 3000);
/** Target/cap players per formed or filled room (6–8 band; cap at 8). */
const TARGET = 8;
/** Minimum to form a NEW room (filling an existing lobby can add even 1). */
const MIN_TO_FORM = 2;
/** Once the oldest waiter in a group has waited this long, form a room even
 * below TARGET (env-overridable; tests set it to 0 for deterministic ticks). */
const FORM_AFTER_MS = num(process.env.MATCH_FORM_AFTER_MS, 8000);
/** Queue entries older than this are assumed abandoned (crashed client) and dropped. */
const STALE_MS = num(process.env.MATCH_STALE_MS, 5 * 60 * 1000);

let timer: ReturnType<typeof setInterval> | undefined;

export function startMatchmaker(namespace: GameNamespace, logger: FastifyBaseLogger): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    void runMatchTick(namespace, Date.now()).catch((error) => {
      logger.error({ err: error }, 'matchmaker tick failed');
    });
  }, INTERVAL_MS);
  // Don't keep the event loop alive just for the matcher (mirrors how the
  // abandon sweeper is treated) — the process should still exit on shutdown.
  timer.unref?.();
}

export function stopMatchmaker(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

function matched(namespace: GameNamespace, playerId: string, code: string): void {
  namespace.to(personalRoom(playerId)).emit(SERVER_EVENTS.matched, { code });
}

/** Greedily picks up to `max` players from a FIFO list, skipping any candidate
 * blocked (either direction) with an already-chosen one. */
function pickBlockAware(fifo: QueueEntry[], blocked: Set<string>, max: number): string[] {
  const chosen: string[] = [];
  for (const entry of fifo) {
    if (chosen.length >= max) {
      break;
    }
    if (chosen.every((id) => !isPairBlocked(blocked, id, entry.playerId))) {
      chosen.push(entry.playerId);
    }
  }
  return chosen;
}

/**
 * Runs one matcher pass at time `now`. Exported so tests can drive a
 * deterministic tick without waiting on the interval. Returns the codes of any
 * rooms filled/formed this tick (for test assertions/logging).
 */
export async function runMatchTick(namespace: GameNamespace, now: number): Promise<string[]> {
  const all = await listQueue();
  if (all.length === 0) {
    return [];
  }

  // 1. Drop stale entries.
  const stale = all.filter((e) => now - e.enqueuedAt > STALE_MS).map((e) => e.playerId);
  if (stale.length > 0) {
    await dequeueMany(stale);
  }
  const live = all.filter((e) => now - e.enqueuedAt <= STALE_MS);

  // 2. Group by language, preserving FIFO order.
  const byLang = new Map<string, QueueEntry[]>();
  for (const entry of live) {
    const group = byLang.get(entry.language) ?? [];
    group.push(entry);
    byLang.set(entry.language, group);
  }

  const touched: string[] = [];
  for (const [language, groupInit] of byLang) {
    let group = groupInit;

    // 3. Fill existing public lobbies of this language first.
    group = await fillExistingLobbies(namespace, language, group, touched);

    // 4. Form new rooms from the remainder.
    group = await formNewRooms(namespace, group, now, touched);
  }

  return touched;
}

async function fillExistingLobbies(
  namespace: GameNamespace,
  language: string,
  group: QueueEntry[],
  touched: string[],
): Promise<QueueEntry[]> {
  if (group.length === 0) {
    return group;
  }
  const codes = await allPublicLobbyCodes();
  let remaining = group;
  for (const code of codes) {
    if (remaining.length === 0) {
      break;
    }
    if ((await publicLobbyLanguage(code)) !== language) {
      continue;
    }
    const room = await loadRoom(code);
    if (!room || room.state.mode !== 'online_public' || room.state.phase !== 'lobby') {
      continue;
    }
    const seatedIds = room.state.players.map((p) => p.id);
    const openSeats = room.state.settings.maxPlayers - seatedIds.length;
    if (openSeats <= 0) {
      continue;
    }
    const relevant = [...remaining.map((e) => e.playerId), ...seatedIds];
    const blocked = await blockedPairsWithin(relevant);
    const chosen: string[] = [];
    for (const entry of remaining) {
      if (chosen.length >= openSeats) {
        break;
      }
      const conflictsSeated = seatedIds.some((s) => isPairBlocked(blocked, s, entry.playerId));
      const conflictsChosen = chosen.some((c) => isPairBlocked(blocked, c, entry.playerId));
      if (!conflictsSeated && !conflictsChosen) {
        chosen.push(entry.playerId);
      }
    }
    if (chosen.length > 0) {
      for (const id of chosen) {
        matched(namespace, id, code);
      }
      await dequeueMany(chosen);
      touched.push(code);
      remaining = remaining.filter((e) => !chosen.includes(e.playerId));
    }
  }
  return remaining;
}

async function formNewRooms(
  namespace: GameNamespace,
  group: QueueEntry[],
  now: number,
  touched: string[],
): Promise<QueueEntry[]> {
  let remaining = group;
  while (remaining.length >= MIN_TO_FORM) {
    const oldestWait = now - (remaining[0]?.enqueuedAt ?? now);
    const shouldForm = remaining.length >= TARGET || oldestWait >= FORM_AFTER_MS;
    if (!shouldForm) {
      break;
    }
    const blocked = await blockedPairsWithin(remaining.map((e) => e.playerId));
    const chosen = pickBlockAware(remaining, blocked, TARGET);
    if (chosen.length < MIN_TO_FORM) {
      // The oldest can't be grouped with anyone (all mutually blocked) — stop
      // rather than spin; they wait for a compatible player.
      break;
    }
    const created = await formRoom(namespace, chosen);
    if (!created) {
      break; // couldn't create (e.g. no loadable host) — try again next tick.
    }
    touched.push(created);
    remaining = remaining.filter((e) => !chosen.includes(e.playerId));
  }
  return remaining;
}

/** Creates a new public room hosted by the first loadable player in `chosen`,
 * then pushes `mm:matched` to everyone (including the host) and dequeues them.
 * Returns the room code, or `null` if no host row could be loaded. */
async function formRoom(namespace: GameNamespace, chosen: string[]): Promise<string | null> {
  const rows = await getDb()
    .select({ id: players.id, displayName: players.displayName, avatar: players.avatar })
    .from(players)
    .where(inArray(players.id, chosen));
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Preserve FIFO order for host selection (first chosen that still exists).
  const host = chosen.map((id) => byId.get(id)).find((row) => row !== undefined);
  if (!host) {
    return null;
  }

  const result = await createOnlineRoom({
    host: { id: host.id, displayName: host.displayName, avatar: host.avatar },
    visibility: 'public',
  });
  if (!result.ok) {
    return null;
  }

  for (const id of chosen) {
    matched(namespace, id, result.code);
  }
  await dequeueMany(chosen);
  return result.code;
}
