'use client';

import { useSyncExternalStore } from 'react';
import { IconChip } from '@/components/pop/icon-chip';
import { IconVolume2 } from '@/components/icons/icon-volume-2';
import { IconVolumeX } from '@/components/icons/icon-volume-x';
import { copy } from '@/copy';
import { isSoundMuted, setSoundMuted, subscribeSoundMuted } from '@/lib/sound-mute';

/**
 * The persistent, always-visible mute control.
 *
 * Mounted at each in-game composition root (`PnpGame`, the online room route) rather than
 * the root layout: sound only ever plays during actual gameplay, so the toggle only needs
 * to exist there, not on marketing/static pages.
 */
export function MuteToggle() {
  const muted = useSyncExternalStore(subscribeSoundMuted, isSoundMuted, () => false);

  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label={muted ? copy.sound.unmuteLabel : copy.sound.muteLabel}
      data-testid="sound-mute-toggle"
      onClick={() => setSoundMuted(!muted)}
      className="fixed right-4 top-4 z-30 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2"
    >
      <IconChip tone="plain">
        {muted ? <IconVolumeX className="h-5 w-5" /> : <IconVolume2 className="h-5 w-5" />}
      </IconChip>
    </button>
  );
}
