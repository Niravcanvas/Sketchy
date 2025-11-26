/**
 * Site-wide data-use notice dismissal (Phase-9-prep). Sketchy sets no cookies of its own
 * (verified: no `document.cookie`/`Set-Cookie`/session-cookie library in this codebase) — the
 * guest login token and game preferences live in `localStorage` instead (same pattern as
 * `onboarding-hints.ts` and `active-room.ts`: SSR-safe, error-swallowing, per-device, with a
 * listener set so a dismiss click re-renders immediately). The one thing that CAN set a cookie
 * is the optional Sign in with Google flow (Google's own cookies, only if a user uses that
 * button); Sketchy itself still sets none. This notice discloses the local-storage use plus
 * optional crash reporting up front, dismissed once and remembered — not a cookie-consent
 * banner, because there's nothing of ours to consent to block or allow; it's a disclosure, not
 * an opt-in gate.
 */
const DISMISSED_KEY = 'sketchy.dataNoticeDismissed.v1';

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeDataNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isDataNoticeDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return true;
  }
}

export function dismissDataNotice(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // ignore — storage unavailable, notice just won't persist its dismissal
  }
  emitChange();
}
