'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconUsers } from '@/components/icons/icon-users';
import { LinkEmailDialog } from '@/components/account/link-email-dialog';
import { PopButton } from '@/components/pop/pop-button';
import { PopDialog } from '@/components/pop/pop-dialog';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { useMatchmakingStore } from '@/stores/matchmaking-store';
import { useSessionStore } from '@/stores/session-store';

const FALLBACK_AFTER_MS = 90_000;
const QUICK_JOIN_LANGUAGE = 'en';

/**
 * Home-screen "Quick join" CTA (copy.md §17.3). Guests get the
 * account-link gate (public matchmaking needs a linked account); linked
 * accounts enter the queue and see a "finding you a table…" modal with a
 * cancel and, after 90s of no match, a "host a public room instead?" fallback.
 * Resolution (`mm:matched`) navigates straight into the matched room.
 */
export function QuickJoinButton() {
  const router = useRouter();
  const status = useSessionStore((state) => state.status);
  const player = useSessionStore((state) => state.player);
  const mmStatus = useMatchmakingStore((state) => state.status);
  const matchedCode = useMatchmakingStore((state) => state.matchedCode);
  const error = useMatchmakingStore((state) => state.error);
  const startSearch = useMatchmakingStore((state) => state.startSearch);
  const cancel = useMatchmakingStore((state) => state.cancel);
  const reset = useMatchmakingStore((state) => state.reset);

  const [gateOpen, setGateOpen] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  // A failed "host a public room instead" — surfaced inline in the still-open
  // searching modal so the fallback action never fails silently.
  const [hostError, setHostError] = useState(false);

  // Navigate into the matched room (store `reset` is not a component setState,
  // so it's fine to call synchronously here).
  useEffect(() => {
    if (mmStatus === 'matched' && matchedCode) {
      const code = matchedCode;
      reset();
      router.push(`/r/${code}`);
    }
  }, [mmStatus, matchedCode, reset, router]);

  // 90-second no-match fallback offer. Only arms while searching; the timer
  // callback and the cleanup are the only places `showFallback` is written, so
  // there's no synchronous setState in the effect body.
  useEffect(() => {
    if (mmStatus !== 'searching') {
      return;
    }
    const timer = setTimeout(() => setShowFallback(true), FALLBACK_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setShowFallback(false);
    };
  }, [mmStatus]);

  const canQuickJoin = status === 'authed';
  const searching = mmStatus === 'searching';
  const errored = mmStatus === 'error';

  // The store writes a real `ErrorCode` (via `copyForError`) or the literal `'network'` for a
  // raw fetch/socket failure — `'network'` isn't an `ErrorCode`, so it can't go through
  // `copyForError` and maps to the dedicated offline line instead.
  const errorMessage =
    error === 'network' ? copy.errors.networkOffline : error ? copyForError(error) : null;

  function handleClick(): void {
    if (player?.isGuest) {
      setGateOpen(true);
      return;
    }
    setHostError(false);
    startSearch(QUICK_JOIN_LANGUAGE);
  }

  async function hostPublicInstead(): Promise<void> {
    setHostError(false);
    try {
      const { code } = await apiClient.createRoom({ visibility: 'public' });
      // Only leave the queue once we actually have a room to walk into; if the
      // create fails we stay searching so the error shows in the open modal.
      cancel();
      router.push(`/r/${code}`);
    } catch {
      setHostError(true);
    }
  }

  return (
    <>
      <PopButton
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        disabled={!canQuickJoin}
        data-testid="quick-join"
        onClick={handleClick}
      >
        <IconUsers className="h-5 w-5" />
        {copy.matchmaking.quickJoin.button}
      </PopButton>

      <PopDialog
        open={searching || errored}
        onOpenChange={(open) => {
          if (open) return;
          // Dismissing an error just clears it (nothing is enqueued anymore); dismissing an
          // active search also dequeues — so branch on which state the modal is in.
          if (errored) reset();
          else cancel();
        }}
        title={
          errored
            ? copy.matchmaking.quickJoin.errorHeading
            : copy.matchmaking.quickJoin.searchingHeading
        }
        description={errored ? (errorMessage ?? undefined) : copy.matchmaking.quickJoin.searchingBody}
        closeLabel={copy.matchmaking.quickJoin.cancel}
      >
        {errored ? (
          <div className="flex justify-end gap-3" data-testid="quick-join-error">
            <PopButton type="button" variant="secondary" onClick={() => reset()}>
              {copy.matchmaking.quickJoin.cancel}
            </PopButton>
            <PopButton
              type="button"
              variant="primary"
              data-testid="quick-join-retry"
              onClick={() => startSearch(QUICK_JOIN_LANGUAGE)}
            >
              {copy.matchmaking.quickJoin.retry}
            </PopButton>
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="quick-join-searching">
            {showFallback ? (
              <p className="font-ui text-sm text-graphite">
                {copy.matchmaking.quickJoin.fallbackBody}
              </p>
            ) : null}
            {hostError ? (
              <p
                role="alert"
                data-testid="quick-join-host-error"
                className="font-ui text-sm text-undercover"
              >
                {copy.errors.generic500}
              </p>
            ) : null}
            <div className="flex justify-end gap-3">
              <PopButton type="button" variant="secondary" onClick={() => cancel()}>
                {copy.matchmaking.quickJoin.cancel}
              </PopButton>
              {showFallback ? (
                <PopButton
                  type="button"
                  variant="primary"
                  data-testid="quick-join-host-instead"
                  onClick={() => {
                    void hostPublicInstead();
                  }}
                >
                  {copy.matchmaking.publicRoom.hostPublic}
                </PopButton>
              ) : null}
            </div>
            <Link href="/community" className="font-ui text-sm font-bold text-graphite underline">
              {copy.matchmaking.community.footerLink}
            </Link>
          </div>
        )}
      </PopDialog>

      <LinkEmailDialog open={gateOpen} onOpenChange={setGateOpen} variant="gate" />
    </>
  );
}
