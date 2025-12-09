'use client';

import { CheatSheetCard } from './cheat-sheet-card';
import { ChatDrawer } from './chat-drawer';
import { PlayerStrip } from './player-strip';
import { ReadyBar } from './ready-bar';
import { RoomCodeHero } from './room-code-hero';
import { SettingsDrawer } from './settings-drawer';
import { Toasts } from './toasts';
import { copy } from '@/copy';
import { useRoomStore } from '@/stores/room-store';

/**
 * The lobby view (game-design.md §5) — composition root reading `room-store` directly (this
 * phase's only reachable `phase === 'lobby'` render; `app/r/[code]/page.tsx` only mounts
 * this once the store has a snapshot in `lobby` phase).
 */
export function LobbyScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const status = useRoomStore((state) => state.status);

  if (!snapshot) {
    return null;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 bg-paper px-6 py-12">
      <Toasts />
      {status === 'reconnecting' ? (
        <p role="status" className="text-center font-ui text-sm text-graphite">
          {copy.presence.reconnectingSelf}
        </p>
      ) : null}
      <RoomCodeHero code={snapshot.code ?? ''} />
      <PlayerStrip />
      <SettingsDrawer />
      <CheatSheetCard code={snapshot.code ?? ''} />
      <ReadyBar />
      <ChatDrawer />
    </main>
  );
}
