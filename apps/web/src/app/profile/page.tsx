'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileScreen } from '@/components/profile/profile-screen';

/**
 * `/profile` route — "My scrapbook" (copy.md §2/§14). A client component
 * fed by `GET /players/me/stats` and `GET /players/me/games` (both TanStack Query, per
 * conventions.md §1 "server cache state... TanStack Query"). The `QueryClientProvider` is
 * scoped to this route rather than the root layout — same pattern `/play` and `/r/[code]`
 * already use (each route that needs server-cache state owns its own client).
 */
export default function ProfilePage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ProfileScreen />
    </QueryClientProvider>
  );
}
