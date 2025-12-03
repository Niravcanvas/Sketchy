/**
 * Native HTML5 Audio sound effects. Deliberately NO audio
 * library — plain `Audio` elements, one pooled instance per sound key reused across
 * plays (so a rapid re-fire just restarts the clip from the top instead of layering
 * overlapping instances, which is the right call for these very short one-shots).
 *
 * Every entry point here is a best-effort no-op on failure: a missing sound file,
 * a browser blocking autoplay before a user gesture (`unlockAudio` below exists precisely
 * to avoid that on iOS/Safari), the OS silent switch muting `HTMLAudioElement` outright
 * (expected on iOS, not something to work around) — none of it ever throws or logs an
 * error. Sound is NEVER gameplay-critical (game-design.md §1 pillar 1): every screen must
 * work identically with sound off, blocked, or erroring.
 */
import { isSoundMuted } from './sound-mute';

export type SoundKey = 'pencil-scratch' | 'page-turn' | 'reveal-sting' | 'win-horn';

/** Self-hosted under `apps/web/public/sounds/` — sources + CC0 licenses in CREDITS.md
 * "Sound (Phase 14)". */
const SOUND_FILES: Record<SoundKey, string> = {
  'pencil-scratch': '/sounds/pencil-scratch.mp3',
  'page-turn': '/sounds/page-turn.mp3',
  'reveal-sting': '/sounds/reveal-sting.mp3',
  'win-horn': '/sounds/win-horn.mp3',
};

const pool = new Map<SoundKey, HTMLAudioElement>();

function getAudio(key: SoundKey): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return null;
  }
  let audio = pool.get(key);
  if (!audio) {
    audio = new Audio(SOUND_FILES[key]);
    audio.preload = 'auto';
    pool.set(key, audio);
  }
  return audio;
}

/** Plays `key` unless the player has muted sound. Never throws — see the file header. */
export function playSound(key: SoundKey): void {
  if (isSoundMuted()) {
    return;
  }
  const audio = getAudio(key);
  if (!audio) {
    return;
  }
  try {
    audio.currentTime = 0;
    audio.play()?.catch(() => {
      // Autoplay blocked (no gesture yet) or the file failed to load — silent no-op.
    });
  } catch {
    // Some browsers throw synchronously here instead of rejecting the promise.
  }
}

/**
 * Primes every pooled sound for playback, for browsers (iOS/Safari chief among them) that
 * refuse to let ANY `Audio.play()` succeed until it happens inside a real user-gesture
 * handler. Call once, from the very first pointerdown/keydown anywhere in the app
 * (`components/sound/sound-unlock-boot.tsx`) — playing-then-immediately-pausing each
 * element inside that same gesture unlocks it for every later programmatic `playSound()`
 * call. Muted state is irrelevant here — unlocking is silent either way (paused before any
 * audible frame plays) and must happen regardless, so a later mute→unmute toggle doesn't
 * still first need a fresh gesture.
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return;
  }
  for (const key of Object.keys(SOUND_FILES) as SoundKey[]) {
    const audio = getAudio(key);
    if (!audio) {
      continue;
    }
    try {
      const result = audio.play();
      if (result && typeof result.then === 'function') {
        result
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          .catch(() => {
            // Still locked, or no supported source — playSound() stays a graceful
            // no-op later; nothing else to do here.
          });
      }
    } catch {
      // Same as above.
    }
  }
}
