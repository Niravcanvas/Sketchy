'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Pack } from '@sketchy/shared/contract/packs';
import { PackCard } from '@/components/packs/pack-card';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';

/**
 * The public-catalog browser (`/packs/browse`). Discover packs other players opened to
 * everyone and add them to your own set — an add mints a `pack_access` grant server-side,
 * so the pack then lands in `GET /packs` (the "Mine" list AND the room settings pack picker,
 * which both read that same set). Any authenticated player — guests included — may browse and
 * add; only public matchmaking gates on a linked account, not pack sharing.
 *
 * Fetching mirrors the lobby browser (`components/matchmaking/lobbies-browser.tsx`): a plain
 * cursor-paginated list with a `loadingMore` in-flight guard so rapid "Load more" taps can't
 * kick off overlapping fetches, and a visible error line rather than a silent swallow. The
 * add action invalidates the `['packs']` query family so any pack list mounted under this
 * QueryClient refetches with the newly-granted pack.
 */
export function PublicPacksBrowser() {
  const status = useSessionStore((state) => state.status);
  const queryClient = useQueryClient();

  const [items, setItems] = useState<Pack[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());

  // Used by the search/Load-more BUTTON handlers (event handlers, where setState is fine).
  // The mount fetch is inlined in the effect below with a `.then` continuation so no setState
  // runs synchronously in the effect body (react-hooks/set-state-in-effect).
  const load = useCallback(async (query: string, cursor?: string) => {
    setError(null);
    try {
      const trimmed = query.trim();
      const page = await apiClient.browsePublicPacks({
        q: trimmed || undefined,
        ...(cursor ? { cursor } : {}),
      });
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
      // Only a fresh (non-cursor) load establishes the query the "Load more" pages continue.
      if (!cursor) {
        setSubmittedQuery(trimmed);
      }
    } catch {
      setError(copy.packs.browse.error);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authed') {
      return;
    }
    let active = true;
    apiClient
      .browsePublicPacks()
      .then((page) => {
        if (active) {
          setItems(page.items);
          setNextCursor(page.nextCursor);
        }
      })
      .catch(() => {
        if (active) {
          setError(copy.packs.browse.error);
        }
      });
    return () => {
      active = false;
    };
  }, [status]);

  function onSearchSubmit(event: FormEvent): void {
    event.preventDefault();
    void load(searchInput);
  }

  // Guard "Load more" against overlapping fetches from rapid double-taps.
  async function loadMore(): Promise<void> {
    if (loadingMore || !nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      await load(submittedQuery, nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function add(id: string): Promise<void> {
    setError(null);
    try {
      await apiClient.importPublicPack(id);
      setAddedIds((prev) => new Set(prev).add(id));
      // Refresh any pack list mounted under this QueryClient so the newly-added pack shows up
      // (the manager + room picker refetch on their own routes; this keeps in-view lists live).
      void queryClient.invalidateQueries({ queryKey: ['packs'] });
    } catch {
      setError(copy.packs.browse.error);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
          {copy.packs.browse.title}
        </h1>
        <p className="font-ui text-base text-graphite">{copy.packs.browse.subtitle}</p>
      </header>

      <form onSubmit={onSearchSubmit} className="flex items-end gap-3">
        <div className="grow">
          <PopInput
            label={copy.packs.browse.searchLabel}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={copy.packs.browse.searchPlaceholder}
            maxLength={40}
            data-testid="browse-search"
          />
        </div>
        <PopButton type="submit" variant="secondary">
          {copy.packs.browse.searchSubmit}
        </PopButton>
      </form>

      {error ? (
        <p role="alert" data-testid="browse-error" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <PopCard className="text-center" data-testid="browse-empty">
          <p className="font-ui text-base text-graphite">{copy.packs.browse.empty}</p>
        </PopCard>
      ) : (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3"
          data-testid="browse-list"
        >
          {items.map((pack) => {
            const added = addedIds.has(pack.id);
            return (
              <div key={pack.id} className="flex flex-col gap-2" data-testid="browse-pack">
                <PackCard pack={pack} showOwnerAttribution />
                <PopButton
                  type="button"
                  variant={added ? 'secondary' : 'primary'}
                  disabled={added}
                  data-testid="browse-add"
                  onClick={() => void add(pack.id)}
                >
                  {added ? copy.packs.browse.addedButton : copy.packs.browse.addButton}
                </PopButton>
              </div>
            );
          })}
        </div>
      )}

      {nextCursor ? (
        <PopButton
          type="button"
          variant="secondary"
          disabled={loadingMore}
          data-testid="browse-load-more"
          onClick={() => void loadMore()}
        >
          {copy.packs.browse.loadMore}
        </PopButton>
      ) : null}
    </div>
  );
}
