/**
 * Voice auto-rejoin preference (game-design.md §10 "voice auto-joins on room entry only if
 * the player opted in previously"). A GLOBAL, per-device preference
 * (not per-room) — flips true the first time a `joinVoice()` call actually succeeds, flips
 * back false on an EXPLICIT "Leave voice" tap (so the next room doesn't nag with a mic
 * prompt), and is left untouched by a mic-permission denial or a transient "unavailable"
 * (those aren't a decision to stop wanting voice). Same SSR-safe, error-swallowing shape as
 * `active-room.ts` / `sound-mute.ts` — a storage failure here must never break anything.
 */
const VOICE_OPT_IN_KEY = 'sketchy.voiceOptIn.v1';

export function hasVoiceOptIn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(VOICE_OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setVoiceOptIn(optedIn: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (optedIn) {
      window.localStorage.setItem(VOICE_OPT_IN_KEY, '1');
    } else {
      window.localStorage.removeItem(VOICE_OPT_IN_KEY);
    }
  } catch {
    // ignore — storage unavailable
  }
}
