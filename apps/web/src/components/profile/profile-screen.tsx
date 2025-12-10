'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BlockedList } from '@/components/profile/blocked-list';
import { DeleteAccountCard } from '@/components/profile/delete-account-card';
import { GuestCaveat } from '@/components/profile/guest-caveat';
import { HeadlineTotals } from '@/components/profile/headline-totals';
import { HistoryList } from '@/components/profile/history-list';
import { IdentityCard } from '@/components/profile/identity-card';
import { PointsSparkline } from '@/components/profile/points-sparkline';
import { RoleWinRateBars } from '@/components/profile/role-winrate-bars';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';

const SPARKLINE_SAMPLE_SIZE = 20;

function LoadingSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-24 w-full animate-pulse rounded-xl border-3 border-ink bg-paper-2"
    />
  );
}

/**
 * `/profile` screen content ("the scrapbook"): identity card, headline
 * totals, per-role win-rate bars, points-over-time sparkline, and paginated history. A guest
 * session is required (there's nothing to show without one) — an anonymous visitor is bounced
 * back to `/` rather than shown an empty shell.
 */
export function ProfileScreen() {
  const router = useRouter();
  const sessionStatus = useSessionStore((state) => state.status);

  useEffect(() => {
    if (sessionStatus === 'anonymous') {
      router.replace('/');
    }
  }, [sessionStatus, router]);

  const statsQuery = useQuery({
    queryKey: ['playerStats'],
    queryFn: () => apiClient.getPlayerStats(),
    enabled: sessionStatus === 'authed',
  });

  // A small, separate first-page fetch for the sparkline (not the same cache entry as
  // `HistoryList`'s `useInfiniteQuery` — the two hooks store pages in incompatible shapes,
  // so sharing a queryKey between them would corrupt whichever reads it second). Cheap:
  // one extra `limit=20` GET, same endpoint `HistoryList` already calls for its first page.
  const sparklineQuery = useQuery({
    queryKey: ['playerGames', 'sparkline'],
    queryFn: () => apiClient.getPlayerGames({ limit: SPARKLINE_SAMPLE_SIZE }),
    enabled: sessionStatus === 'authed',
  });

  if (sessionStatus !== 'authed') {
    return null;
  }

  const pointsChronological = sparklineQuery.data
    ? [...sparklineQuery.data.items].reverse().map((item) => item.myPoints)
    : [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-6 bg-paper px-6 py-12">
      <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
        {copy.profile.screenTitle}
      </h1>

      <IdentityCard />

      {statsQuery.data ? (
        <>
          <HeadlineTotals
            totalPoints={statsQuery.data.totalPoints}
            gamesPlayed={statsQuery.data.gamesPlayed}
            gamesWon={statsQuery.data.gamesWon}
          />
          <RoleWinRateBars byRole={statsQuery.data.byRole} />
        </>
      ) : (
        <LoadingSkeleton />
      )}

      <PointsSparkline pointsChronological={pointsChronological} />

      <HistoryList />

      <BlockedList />

      <GuestCaveat />

      <DeleteAccountCard />
    </main>
  );
}
