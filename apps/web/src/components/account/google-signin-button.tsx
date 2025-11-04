'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@sketchy/shared/client';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { loadGoogleIdentity } from '@/lib/google-identity';
import { useSessionStore } from '@/stores/session-store';

/**
 * "Sign in with Google" — an ADDITIONAL account-link method alongside the email
 * magic link. Renders ONLY when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is configured;
 * with the feature off it returns `null`, so the GIS script never loads and
 * Google sets no cookies (the privacy claim in `copy.ts`). On the credential
 * callback it links the caller via `POST /auth/google` and adopts the returned
 * `{ token, player }` — the exact same session-store path the magic-link verify
 * uses (`adoptSession`), upgrading this device to the now-linked identity.
 */
export function GoogleSignInButton() {
  // Read at render: Next.js inlines `NEXT_PUBLIC_*` wherever it textually
  // appears, so the whole Google path compiles out of a build with no client ID.
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const adoptSession = useSessionStore((state) => state.adoptSession);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    async function linkWithCredential(credential: string): Promise<void> {
      setError(null);
      try {
        const res = await apiClient.googleSignIn(credential);
        adoptSession(res.token, res.player);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? copyForError(caught.code) : copy.errors.networkOffline,
        );
      }
    }

    void loadGoogleIdentity()
      .then((identity) => {
        if (cancelled) return;
        identity.initialize({
          client_id: clientId,
          callback: (response) => {
            void linkWithCredential(response.credential);
          },
        });
        identity.renderButton(container, { theme: 'outline', size: 'large', text: 'signin_with' });
      })
      .catch(() => {
        if (!cancelled) setError(copy.errors.networkOffline);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, adoptSession]);

  if (!clientId) return null;

  return (
    <div className="flex flex-col items-stretch gap-2" data-testid="google-signin">
      <p
        className="text-center font-ui text-xs uppercase tracking-wide text-graphite"
        aria-hidden
      >
        {copy.matchmaking.account.googleDivider}
      </p>
      {/* GIS renders its own branded button into this container (Google's branding
          rules require their button, not ours) — the aria-label names the control. */}
      <div ref={containerRef} aria-label={copy.matchmaking.account.googleButton} />
      <p className="font-ui text-xs text-graphite">
        {copy.matchmaking.account.googleDisclosure}
      </p>
      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
    </div>
  );
}
