'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LobbyItem } from '@sketchy/shared/contract/matchmaking';
import { LinkEmailDialog } from '@/components/account/link-email-dialog';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';

/**
 * The public-room browser (`/lobbies`, copy.md §17.2). Any signed-in
 * player can browse; JOINING a public room requires a linked account, so a
 * guest tapping Join gets the account-link gate (the same rule the server
 * enforces at `room:join`). Cursor-paginated with a plain "load more".
 */
export function LobbiesBrowser() {
  const router = useRouter();
  const status = useSessionStore((state) => state.status);
  const player = useSessionStore((state) => state.player);

  const [items, setItems] = useState<LobbyItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // `load` is used by the Refresh / Load-more BUTTONS (event handlers, where
  // setState is fine). The mount fetch is inlined in the effect below with a
  // `.then` continuation so no setState runs synchronously in the effect body
  // (react-hooks/set-state-in-effect).
  const load = useCallback(async (cursor?: string) => {
    setError(null);
    try {
      const page = await apiClient.getLobbies(cursor ? { cursor } : undefined);
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch {
      // Surface the failure instead of leaving a stale/empty list looking normal.
      setError(copy.errors.generic500);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authed') {
      return;
    }
    let active = true;
    apiClient
      .getLobbies()
      .then((page) => {
        if (active) {
          setItems(page.items);
          setNextCursor(page.nextCursor);
        }
      })
      .catch(() => {
        if (active) {
          setError(copy.errors.generic500);
        }
      });
    return () => {
      active = false;
    };
  }, [status]);

  // Guard "Load more" against overlapping fetches from rapid double-taps.
  async function loadMore(): Promise<void> {
    if (loadingMore || !nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  function join(code: string): void {
    if (player?.isGuest) {
      setGateOpen(true);
      return;
    }
    router.push(`/r/${code}`);
  }

  async function hostPublic(): Promise<void> {
    if (player?.isGuest) {
      setGateOpen(true);
      return;
    }
    setError(null);
    try {
      const { code } = await apiClient.createRoom({ visibility: 'public' });
      router.push(`/r/${code}`);
    } catch {
      setError(copy.errors.generic500);
    }
  }

  // Browsing public tables needs a session (the server gates the list too). A
  // visitor without one gets an actionable account-link gate rather than a
  // confusing empty list — the same affordance quick-join shows a guest.
  if (status !== 'authed') {
    return (
      <PopCard
        className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 text-center"
        data-testid="lobbies-gate"
      >
        <p className="font-ui text-base text-ink">{copy.matchmaking.publicRoom.browseGate}</p>
        <PopButton type="button" variant="primary" onClick={() => setGateOpen(true)}>
          {copy.matchmaking.account.linkButton}
        </PopButton>
        <LinkEmailDialog open={gateOpen} onOpenChange={setGateOpen} variant="gate" />
      </PopCard>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
            {copy.matchmaking.publicRoom.browserTitle}
          </h1>
          <p className="font-ui text-base text-graphite">
            {copy.matchmaking.publicRoom.browserSubtitle}
          </p>
        </div>
        <PopButton type="button" variant="secondary" onClick={() => void load()}>
          {copy.matchmaking.publicRoom.refresh}
        </PopButton>
      </div>

      {error ? (
        <p role="alert" data-testid="lobbies-error" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <PopCard
          className="flex flex-col items-center gap-4 text-center"
          data-testid="lobbies-empty"
        >
          <p className="font-ui text-base text-graphite">
            {copy.matchmaking.publicRoom.browserEmpty}
          </p>
          <PopButton type="button" variant="primary" onClick={() => void hostPublic()}>
            {copy.matchmaking.publicRoom.hostPublic}
          </PopButton>
        </PopCard>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="lobbies-list">
          {items.map((lobby) => (
            <li key={lobby.code}>
              <PopCard className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="font-ui font-bold text-ink">
                    {copy.matchmaking.publicRoom.hostTable(lobby.hostName)}
                  </span>
                  <span className="font-ui text-sm text-graphite">
                    {copy.matchmaking.publicRoom.playerCount(lobby.playerCount, lobby.maxPlayers)}
                  </span>
                </div>
                <PopButton
                  type="button"
                  variant="primary"
                  data-testid="lobby-join"
                  onClick={() => join(lobby.code)}
                >
                  {copy.matchmaking.publicRoom.join}
                </PopButton>
              </PopCard>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <PopButton
          type="button"
          variant="secondary"
          disabled={loadingMore}
          data-testid="lobbies-load-more"
          onClick={() => void loadMore()}
        >
          {copy.matchmaking.publicRoom.loadMore}
        </PopButton>
      ) : null}

      <Link href="/community" className="font-ui text-sm font-bold text-graphite underline">
        {copy.matchmaking.community.footerLink}
      </Link>

      <LinkEmailDialog open={gateOpen} onOpenChange={setGateOpen} variant="gate" />
    </div>
  );
}
