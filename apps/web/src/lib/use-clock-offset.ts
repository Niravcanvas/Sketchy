'use client';

import { useEffect, useState } from 'react';
import { useRoomStore } from '@/stores/room-store';

/** Countdown tick granularity — fine enough that a whole-second display never visibly
 * skips or stalls, coarse enough not to burn a render every animation frame
 * (game-design.md §8 "Clocks" — countdowns are a rendering concern, never a decision
 * point: the server's timeout action is the one thing that actually ends a phase). */
const TICK_MS = 250;

/**
 * Countdown in whole seconds remaining until `endsAt` (epoch ms, server clock), corrected
 * for this connection's measured clock offset (`room-store`'s `clockOffsetMs`, set once per
 * connection by `lib/socket.ts`'s `time:ping` round trip — api-contract.md §2.3 rule 3).
 *
 * `endsAt === null` (untimed phase/preset) → `null` out, no ticking. Otherwise clamps to
 * `>= 0` and keeps ticking past zero (still `0`, never negative) — this component never
 * decides the phase is over, it just stops counting down; the next `room:snapshot` is what
 * actually moves the game on.
 */
export function useCountdown(endsAt: number | null): number | null {
  const clockOffsetMs = useRoomStore((state) => state.clockOffsetMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, [endsAt]);

  if (endsAt === null) {
    return null;
  }

  const remainingMs = endsAt - (now + clockOffsetMs);
  return Math.max(0, Math.ceil(remainingMs / 1000));
}
