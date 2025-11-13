'use client';

import { useState } from 'react';
import { LinkEmailDialog } from '@/components/account/link-email-dialog';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { useSessionStore } from '@/stores/session-store';

/**
 * Guest-identity caveat + account-link upsell. Honest, no dark patterns
 * (copy.md §12): says plainly the
 * scrapbook lives on this browser, and offers the "claim your scrapbook" email
 * link. A linked account has nothing to claim, so this renders nothing for them.
 */
export function GuestCaveat() {
  const player = useSessionStore((state) => state.player);
  const [open, setOpen] = useState(false);
  const isGuest = !player || player.isGuest;

  if (!isGuest) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="max-w-md text-center font-ui text-xs text-graphite">
        {copy.matchmaking.account.guestCaveat}
      </p>
      <PopButton
        type="button"
        variant="secondary"
        data-testid="link-my-email"
        onClick={() => setOpen(true)}
      >
        {copy.matchmaking.account.linkButton}
      </PopButton>
      <LinkEmailDialog open={open} onOpenChange={setOpen} variant="upsell" />
    </div>
  );
}
