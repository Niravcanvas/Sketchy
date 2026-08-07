'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PnpGame } from '@/components/pnp/pnp-game';
import { NavBackButton } from '@/components/nav-back-button';

/**
 * Pass-and-play route (game-design.md §2): a client component running the
 * engine in the browser — no sockets, no server dependency (api-contract.md
 * §3). The QueryClientProvider is scoped here rather than the root layout:
 * packs (the setup screen) are the only server-cache state the app has so
 * far; a later phase can lift it when more routes need it.
 */
export default function PlayPage() {
  // `retry: false` so an offline pack fetch fails fast into the bundled
  // starter-pack fallback instead of spinning through retries.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 5 * 60_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <NavBackButton href="/" />
      <PnpGame />
    </QueryClientProvider>
  );
}
