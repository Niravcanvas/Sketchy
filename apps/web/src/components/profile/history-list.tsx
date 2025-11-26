'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { HistoryGameCard } from './history-game-card';

const PAGE_SIZE = 20;

function LoadingSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-32 w-full animate-pulse rounded-xl border-3 border-ink bg-paper-2"
    />
  );
}

/**
 * Paginated game history, cursor-paginated via
 * `GET /players/me/games` (api-contract.md §1 §0 pagination convention). `useInfiniteQuery`
 * owns the accumulated pages so "Load more" is a plain `fetchNextPage()` call rather than
 * hand-rolled page-merging state.
 */
export function HistoryList() {
  const query = useInfiniteQuery({
    queryKey: ['playerGames', 'list'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiClient.getPlayerGames({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex w-full flex-col gap-3">
      <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.profile.history.header}
      </h2>

      {query.isPending ? <LoadingSkeleton /> : null}

      {!query.isPending && items.length === 0 ? (
        <PopCard className="text-center">
          <p className="font-ui text-sm text-graphite">{copy.profile.history.emptyState}</p>
        </PopCard>
      ) : null}

      {items.map((item) => (
        <HistoryGameCard key={item.gameId} item={item} />
      ))}

      {query.hasNextPage ? (
        <PopButton
          variant="secondary"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
          className="self-center"
        >
          {copy.profile.history.loadMore}
        </PopButton>
      ) : null}
    </div>
  );
}
