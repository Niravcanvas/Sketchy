'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';

type VerifyStatus = 'loading' | 'success' | 'failure';

/**
 * `/link` magic-link verify. Consumes the `?token=` from the emailed
 * link, upgrades the guest identity in place (`POST /auth/link/verify`), and
 * adopts the returned `{ token, player }` — the device is now the linked
 * account. Single-use: a re-visit of a consumed link lands on the failure copy.
 */
export function LinkVerify() {
  const params = useSearchParams();
  const token = params.get('token');
  const adoptSession = useSessionStore((state) => state.adoptSession);
  // No token → 'failure' from the initial render (no synchronous setState in
  // the effect); a token → 'loading' until verify resolves.
  const [status, setStatus] = useState<VerifyStatus>(token ? 'loading' : 'failure');
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token || startedRef.current) return; // verify exactly once (single-use token)
    startedRef.current = true;
    apiClient
      .verifyEmailLink({ token })
      .then((res) => {
        adoptSession(res.token, res.player);
        setStatus('success');
      })
      .catch(() => setStatus('failure'));
  }, [token, adoptSession]);

  return (
    <PopCard className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
      {status === 'loading' ? (
        <p role="status" className="font-ui text-lg text-ink">
          {copy.matchmaking.account.verifyLoading}
        </p>
      ) : null}
      {status === 'success' ? (
        <>
          <p role="status" data-testid="link-success" className="font-display text-xl uppercase text-ink">
            {copy.matchmaking.account.verifySuccessHeading}
          </p>
          <Link
            href="/"
            className="rounded-lg border-3 border-ink bg-civilian px-4 py-2 font-ui font-bold text-white shadow-hard-sm"
          >
            {copy.matchmaking.account.verifySuccessCta}
          </Link>
        </>
      ) : null}
      {status === 'failure' ? (
        <>
          <p role="alert" data-testid="link-failure" className="font-ui text-lg text-undercover">
            {copy.matchmaking.account.verifyFailure}
          </p>
          <Link
            href="/"
            className="rounded-lg border-3 border-ink bg-paper-2 px-4 py-2 font-ui font-bold text-ink shadow-hard-sm"
          >
            {copy.matchmaking.account.verifyFailureCta}
          </Link>
        </>
      ) : null}
    </PopCard>
  );
}
