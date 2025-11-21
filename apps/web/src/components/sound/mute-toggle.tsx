'use client';

import { useSyncExternalStore } from 'react';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { isSoundMuted, setSoundMuted, subscribeSoundMuted } from '@/lib/sound-mute';

/**
 * The persistent, always-visible mute control ("small, tasteful,
 * default-on with a visible persistent mute"). Icon-free by design — design-party-pop.md
 * §6's icon contract lists a fixed, already-drawn set with no volume/speaker glyph in it,
 * and the hard rule keeps icons to "the existing Lucide-geometry components"
 * (design-party-pop.md §6/§14: the quieter option when unspecified) — a plain text chip is
 * unambiguous and needs no new icon file.
 *
 * Mounted at each in-game composition root (`PnpGame`, the online room route) rather than
 * the root layout: sound only ever plays during actual gameplay, so the toggle only needs
 * to exist there, not on marketing/static pages.
 */
export function MuteToggle() {
  const muted = useSyncExternalStore(subscribeSoundMuted, isSoundMuted, () => false);

  return (
    <PopButton
      type="button"
      variant="secondary"
      size="md"
      aria-pressed={muted}
      data-testid="sound-mute-toggle"
      onClick={() => setSoundMuted(!muted)}
      className="fixed right-4 top-4 z-30"
    >
      {muted ? copy.sound.unmuteLabel : copy.sound.muteLabel}
    </PopButton>
  );
}
