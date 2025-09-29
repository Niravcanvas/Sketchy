/**
 * Active-room memory (game-design.md §8 "Rejoin after full
 * close"): the code of the room the player is currently seated in, persisted to
 * localStorage so any later site entry can offer "Rejoin room {CODE}?" (copy §8).
 * Written on a successful `room:join`, cleared on an explicit leave / kick — a
 * closed tab keeps it, which is the whole point.
 *
 * Deliberately tiny + SSR-safe (like `session-store`'s persistence): all access
 * is guarded and swallows storage errors (private mode / quota), because a game
 * must never break just because localStorage is unavailable.
 */
const ACTIVE_ROOM_KEY = 'sketchy.activeRoom.v1';

/** Subscribers (the rejoin prompt) so it re-renders when the remembered room
 * changes — lets `readActiveRoom` back a `useSyncExternalStore` read rather than
 * a setState-in-effect (avoids hydration mismatch AND the cascading-render lint). */
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeActiveRoom(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rememberActiveRoom(code: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_ROOM_KEY, code);
  } catch {
    // ignore — storage unavailable
  }
  emitChange();
}

export function forgetActiveRoom(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // ignore
  }
  emitChange();
}

export function readActiveRoom(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_ROOM_KEY);
  } catch {
    return null;
  }
}
