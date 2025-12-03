/**
 * Sound mute preference ("small, tasteful, default-on with a
 * visible persistent mute"): persisted per-device in localStorage so a mute choice
 * survives a refresh. Same SSR-safe, error-swallowing, subscribe-based shape as
 * `active-room.ts` — sound (and therefore this preference) is NEVER gameplay-critical
 * (game-design.md §1 pillar 1), so a storage failure here must never break anything else.
 * Default is UNMUTED (the key is simply absent) — that's what "default-on" means.
 */
const SOUND_MUTED_KEY = 'sketchy.soundMuted.v1';

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeSoundMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SOUND_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSoundMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (muted) {
      window.localStorage.setItem(SOUND_MUTED_KEY, '1');
    } else {
      window.localStorage.removeItem(SOUND_MUTED_KEY);
    }
  } catch {
    // ignore — storage unavailable
  }
  emitChange();
}
