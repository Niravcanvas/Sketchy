'use client';

import { useEffect } from 'react';
import { unlockAudio } from '@/lib/sound';

/**
 * Unlocks HTML5 Audio playback on the very first user gesture anywhere in the app
 * (iOS/Safari refuse a programmatic `Audio.play()` before one).
 * Mounted once, in the root layout, so it's armed before any in-game screen could try to
 * play a sound. Renders nothing; removes its own listeners the moment it fires once.
 */
export function SoundUnlockBoot() {
  useEffect(() => {
    let unlocked = false;

    function handleGesture(): void {
      if (unlocked) {
        return;
      }
      unlocked = true;
      unlockAudio();
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    }

    window.addEventListener('pointerdown', handleGesture);
    window.addEventListener('keydown', handleGesture);
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, []);

  return null;
}
