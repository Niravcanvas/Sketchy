'use client';

import { useEffect } from 'react';
import { useRoomStore, type RoomToast } from '@/stores/room-store';

/** How long a presence toast stays on screen before auto-dismissing (game-design.md §8
 * events are "transient" — the store just holds them, this component owns the timing). */
const TOAST_LIFETIME_MS = 4000;

/**
 * Renders `room-store`'s `events` as transient Party Pop toasts (design-party-pop.md §11).
 * Auto-dismiss is this component's job, not the store's (room-store.ts's doc comment on
 * `events`) — each toast owns its own timer so a later toast never resets an earlier one's
 * countdown.
 */
export function Toasts() {
  const events = useRoomStore((state) => state.events);
  const dismissEvent = useRoomStore((state) => state.dismissEvent);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-4 z-30 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {events.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismissEvent} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: RoomToast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      data-testid="room-toast"
      className="pnp-toast-slam pointer-events-auto rounded-xl border-3 border-ink bg-paper-2 px-4 py-2 font-ui text-[15px] font-bold text-ink shadow-hard"
    >
      {toast.text}
    </div>
  );
}
