'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NamePromptCard } from '@/components/name-prompt-card';
import { NavBackButton } from '@/components/nav-back-button';
import { PublicPacksBrowser } from '@/components/packs/public-packs-browser';
import { useSessionStore } from '@/stores/session-store';

/**
 * `/packs/browse` — the public-catalog browser. Gated on a real guest identity the same way
 * the `/packs` manager is (every pack REST call is authed, api-contract.md §0): `loading`
 * renders nothing, anonymous shows the shared `NamePromptCard`, authed renders the browser.
 * A dynamic client route needs its own `QueryClientProvider` instance (same pattern as
 * `/packs` and `/packs/:id`). The interactive browser itself lives in
 * `components/packs/public-packs-browser.tsx` — a page file may only export `default`
 * (plus Next's recognized special exports), so it can't also export the component directly.
 */
export default function BrowsePublicPacksPage() {
  const status = useSessionStore((state) => state.status);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );

  if (status === 'loading') {
    return null;
  }

  if (status !== 'authed') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6">
        <NamePromptCard />
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 bg-paper px-6 py-12">
        <NavBackButton href="/packs" />
        <PublicPacksBrowser />
      </main>
    </QueryClientProvider>
  );
}
