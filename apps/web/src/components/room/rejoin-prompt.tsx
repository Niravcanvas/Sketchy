'use client';

import { useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { forgetActiveRoom, readActiveRoom, subscribeActiveRoom } from '@/lib/active-room';

/**
 * Site-entry rejoin offer (game-design.md §8 / copy §8): if
 * localStorage remembers a room the player is seated in, offer to rejoin it.
 * `useSyncExternalStore` with a null server snapshot means server + first client paint
 * agree (nothing) — no hydration mismatch — and `Abandon`/join changes re-render via
 * the store's subscription. `Rejoin` routes to the room; `Abandon` forgets it (the
 * room itself keeps their seat until it's reaped).
 */
export function RejoinPrompt() {
  const router = useRouter();
  const code = useSyncExternalStore(
    subscribeActiveRoom,
    readActiveRoom,
    () => null,
  );

  if (!code) return null;

  return (
    <PopCard
      role="status"
      aria-live="polite"
      className="flex w-full max-w-sm flex-col gap-3 border-highlight"
    >
      <p className="font-ui text-sm text-ink">{copy.presence.rejoinPrompt(code)}</p>
      <div className="flex gap-2">
        <PopButton
          variant="primary"
          size="md"
          className="flex-1"
          onClick={() => router.push(`/r/${code}`)}
        >
          {copy.presence.rejoinCta}
        </PopButton>
        <PopButton variant="secondary" size="md" onClick={() => forgetActiveRoom()}>
          {copy.presence.abandonCta}
        </PopButton>
      </div>
    </PopCard>
  );
}
