import { HowToPlayButton } from '@/components/how-to-play-button';
import { PopCard } from '@/components/pop/pop-card';
import { VoicePill } from '@/components/room/voice-pill';
import { copy } from '@/copy';

export interface CheatSheetCardProps {
  /** The lobby's room code — used to send `/how-to-play`'s Skip/finish back to THIS room
   * ("linked from home / lobby / join flows") rather than home. */
  code: string;
}

/**
 * Lobby cheat-sheet card (game-design.md §5 "'how to play' cheat-sheet card for
 * newcomers"): the copy.md §10 loop line plus the `<VoicePill>` (replaces the old
 * §4 voice-call hint text, copy.md §4 "Voice"), extended with a link into the
 * full `/how-to-play` walkthrough for anyone who wants more than the one-liner. Still a
 * plain presentational leaf itself (no hooks of its own — `VoicePill` carries its own `"use
 * client"` and is only ever mounted inside `lobby-screen.tsx`, which is already a client
 * component), so this file doesn't need the directive either.
 */
export function CheatSheetCard({ code }: CheatSheetCardProps) {
  return (
    <PopCard className="flex flex-col items-center gap-3 text-center">
      <p className="font-ui text-base font-medium text-ink">{copy.howToPlay.cheatSheet}</p>
      <VoicePill />
      <HowToPlayButton from={`/r/${code}`} />
    </PopCard>
  );
}
