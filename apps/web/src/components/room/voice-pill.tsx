'use client';

import { useState } from 'react';
import { IconMic } from '@/components/icons/icon-mic';
import { IconMicOff } from '@/components/icons/icon-mic-off';
import { IconQuestion } from '@/components/icons/icon-question';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { joinVoice, leaveVoice, setVoiceMuted } from '@/lib/voice';
import { useRoomStore } from '@/stores/room-store';
import { useVoiceStore } from '@/stores/voice-store';

/**
 * "Join voice 🎙️" pill (game-design.md §10) — replaces the old
 * lobby call hint (copy.md §4) and doubles as the in-game status-strip voice control.
 * Rendered in BOTH `cheat-sheet-card.tsx` (lobby) and `game/status-strip.tsx` (in-game); it
 * self-derives the room code from `room-store` rather than taking it as a prop, same pattern
 * `player-strip.tsx` uses for `snapshot`.
 *
 * Degradation: every non-`'connected'` state renders a plain button
 * + optional helper line — never a blocking modal, never anything that implies the GAME is
 * affected. `'unavailable'`/`'denied'` stay clickable (not `disabled`) so a player can retry
 * immediately rather than wait out the background retry loop (`lib/voice.ts`).
 */
export function VoicePill() {
  const code = useRoomStore((state) => state.snapshot?.code ?? null);
  const status = useVoiceStore((state) => state.status);
  const muted = useVoiceStore((state) => state.muted);
  const [isToggling, setIsToggling] = useState(false);

  if (!code) {
    return null;
  }

  async function handleToggleMute(): Promise<void> {
    setIsToggling(true);
    await setVoiceMuted(!muted);
    setIsToggling(false);
  }

  if (status === 'connected') {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        data-testid="voice-pill"
        data-voice-status={status}
      >
        <span className="font-ui text-sm font-bold text-ink">{copy.rooms.voice.pill.connected}</span>
        <PopButton
          type="button"
          variant="secondary"
          data-testid="voice-mute-toggle"
          disabled={isToggling}
          aria-label={muted ? copy.rooms.voice.unmute : copy.rooms.voice.mute}
          onClick={() => {
            void handleToggleMute();
          }}
        >
          {muted ? (
            <IconMicOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <IconMic className="h-4 w-4" aria-hidden="true" />
          )}
          {muted ? copy.rooms.voice.unmute : copy.rooms.voice.mute}
        </PopButton>
        <PopButton type="button" variant="secondary" data-testid="voice-leave" onClick={() => leaveVoice()}>
          {copy.rooms.voice.leave}
        </PopButton>
        {/* iOS/background-tab honesty tooltip (copy.md §4 "Voice") — a real, focusable button
            so the disclosure is keyboard-reachable, not just a hover-only title. */}
        <button
          type="button"
          data-testid="voice-ios-tooltip"
          title={copy.rooms.voice.iosTooltip}
          aria-label={copy.rooms.voice.iosTooltip}
          className="text-graphite"
        >
          <IconQuestion className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const label = (() => {
    switch (status) {
      case 'connecting':
        return copy.rooms.voice.pill.connecting;
      case 'denied':
        return copy.rooms.voice.pill.denied;
      case 'unavailable':
        return copy.rooms.voice.pill.unavailable;
      default:
        return copy.rooms.voice.pill.idle;
    }
  })();

  const helper =
    status === 'denied'
      ? copy.rooms.voice.micDenied
      : status === 'unavailable'
        ? copy.rooms.voice.unavailableHint
        : null;

  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid="voice-pill"
      data-voice-status={status}
    >
      <PopButton
        type="button"
        variant="secondary"
        data-testid="voice-join"
        disabled={status === 'connecting'}
        onClick={() => {
          void joinVoice(code);
        }}
      >
        <IconMic className="h-4 w-4" aria-hidden="true" />
        {label}
      </PopButton>
      {helper ? (
        <p className="max-w-xs text-center font-ui text-xs text-graphite">{helper}</p>
      ) : null}
    </div>
  );
}
