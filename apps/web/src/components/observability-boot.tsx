'use client';

import { useEffect } from 'react';
import { initWebObservability, setPlayerTag, setRoomTag } from '@/lib/observability';
import { useRoomStore } from '@/stores/room-store';
import { useSessionStore } from '@/stores/session-store';

/**
 * Initializes client Sentry once on mount, then keeps the `playerId` / `roomCode`
 * tags in sync with the session and the current room.
 * Renders no DOM — a side-effect leaf mounted from `layout.tsx` beside
 * `SessionBoot`, so the layout itself stays a Server Component. A no-op unless
 * `SENTRY_DSN` is set (see `lib/observability.ts`).
 */
export function ObservabilityBoot() {
  const playerId = useSessionStore((state) => state.player?.id ?? null);
  const roomCode = useRoomStore((state) => state.snapshot?.code ?? null);

  useEffect(() => {
    initWebObservability();
  }, []);

  useEffect(() => {
    setPlayerTag(playerId);
  }, [playerId]);

  useEffect(() => {
    setRoomTag(roomCode);
  }, [roomCode]);

  return null;
}
