'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@sketchy/shared/client';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopDialog } from '@/components/pop/pop-dialog';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { useSessionStore } from '@/stores/session-store';

const deleteCopy = copy.matchmaking.account.deleteAccount;

/** Maps a failed `DELETE /v1/account` to one §9 error line — same shape as
 * `identity-card.tsx`'s patch-error mapping. */
function copyForDeleteError(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

/**
 * "Delete account" danger section of `/profile`. Shown ONLY for a LINKED
 * account — a guest has no linked identity to delete, so this renders nothing
 * for them (they also never see it, since the server would reject it anyway).
 *
 * Deletion is soft-anonymize server-side (`DELETE /v1/account` scrubs the PII
 * and keeps the row so the moderation audit trail survives); the destructive
 * button is guarded behind a type-to-confirm so it can't be a fat-finger. On
 * success the local session is dropped (the server can't revoke the still-valid
 * JWT, so the client dropping it IS the session end) and we return home.
 */
export function DeleteAccountCard() {
  const router = useRouter();
  const player = useSessionStore((state) => state.player);
  const signOut = useSessionStore((state) => state.signOut);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guests have nothing to delete — never render the affordance for them.
  if (!player || player.isGuest) {
    return null;
  }

  const confirmed = typed.trim() === deleteCopy.confirmWord;

  function reset(): void {
    setTyped('');
    setBusy(false);
    setError(null);
  }

  async function handleDelete(): Promise<void> {
    if (!confirmed || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.deleteAccount();
      // Drop the local session first (there is no server-side JWT revocation),
      // then leave the now-inaccessible profile for home.
      signOut();
      router.replace('/');
    } catch (caught) {
      setError(copyForDeleteError(caught));
      setBusy(false);
    }
  }

  return (
    <section className="flex w-full flex-col gap-3">
      <h2 className="font-display text-2xl uppercase tracking-wide text-undercover">
        {deleteCopy.heading}
      </h2>
      <PopCard className="flex w-full flex-col items-start gap-4">
        <p className="font-ui text-sm text-graphite">{deleteCopy.blurb}</p>
        <PopButton
          variant="danger"
          data-testid="delete-account-trigger"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          {deleteCopy.trigger}
        </PopButton>
      </PopCard>

      <PopDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            reset();
          }
        }}
        title={deleteCopy.heading}
        description={deleteCopy.warning}
        closeLabel={deleteCopy.cancel}
      >
        <div className="flex flex-col gap-4" data-testid="delete-account-dialog">
          <PopInput
            label={deleteCopy.confirmLabel}
            value={typed}
            autoComplete="off"
            data-testid="delete-account-confirm-input"
            onChange={(event) => setTyped(event.target.value)}
          />
          {error ? (
            <p role="alert" className="font-ui text-sm text-undercover">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <PopButton
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              {deleteCopy.cancel}
            </PopButton>
            <PopButton
              variant="danger"
              disabled={!confirmed || busy}
              data-testid="delete-account-confirm"
              onClick={() => {
                void handleDelete();
              }}
            >
              {busy ? deleteCopy.pending : deleteCopy.confirmButton}
            </PopButton>
          </div>
        </div>
      </PopDialog>
    </section>
  );
}
