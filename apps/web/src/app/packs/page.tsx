'use client';

import { useState } from 'react';
import Link from 'next/link';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconBook } from '@/components/icons/icon-book';
import { CreatePackDialog } from '@/components/packs/create-pack-dialog';
import { ImportPackForm } from '@/components/packs/import-pack-form';
import { PackCard } from '@/components/packs/pack-card';
import { IconChip } from '@/components/pop/icon-chip';
import { NamePromptCard } from '@/components/name-prompt-card';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';

type Tab = 'mine' | 'official';

function PackManager() {
  const player = useSessionStore((state) => state.player);
  const [tab, setTab] = useState<Tab>('mine');
  const queryClient = useQueryClient();

  const mineQuery = useQuery({
    queryKey: ['packs', 'mine'],
    queryFn: () => apiClient.listPacks({ mine: true }),
  });
  const officialQuery = useQuery({
    queryKey: ['packs', 'official'],
    queryFn: () => apiClient.listPacks({ official: true }),
  });

  const activeQuery = tab === 'mine' ? mineQuery : officialQuery;
  const items = activeQuery.data?.items ?? [];

  function refetchMine(): void {
    void queryClient.invalidateQueries({ queryKey: ['packs', 'mine'] });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 bg-paper px-6 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        <IconChip tone="accent" className="h-14 w-14">
          <IconBook className="h-6 w-6" />
        </IconChip>
        <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
          {copy.packs.manager.title}
        </h1>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2" role="tablist">
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
            {copy.packs.manager.tabs.mine}
          </TabButton>
          <TabButton active={tab === 'official'} onClick={() => setTab('official')}>
            {copy.packs.manager.tabs.official}
          </TabButton>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/packs/browse"
            className="rounded-xl border-3 border-ink bg-paper-2 px-4 py-2 font-display text-sm uppercase tracking-wide text-ink shadow-hard-sm transition-transform duration-150 hover:-translate-y-0.5"
          >
            {copy.packs.browse.title}
          </Link>
          <CreatePackDialog />
        </div>
      </div>

      {tab === 'mine' ? <ImportPackForm onImported={refetchMine} /> : null}

      {items.length === 0 && !activeQuery.isLoading ? (
        // copy.md §15: "Mine" is one merged owned+imported list with no sub-split, so
        // there's no distinct "imports are empty" state to show `emptyImports` for — the
        // official tab (server-seeded, arch/copy.md §13's 8 packs) isn't expected to ever
        // hit this branch, but if it somehow does, showing nothing beats showing the wrong
        // tab's copy.
        tab === 'mine' ? (
          <p className="font-ui text-sm text-graphite">{copy.packs.manager.emptyMine}</p>
        ) : null
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {items.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              showOwnerAttribution={tab === 'mine' && pack.ownerId !== player?.id}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'rounded-xl border-3 border-ink bg-highlight px-4 py-2 font-display text-sm uppercase tracking-wide text-ink shadow-hard-sm'
          : 'rounded-xl border-3 border-ink bg-paper-2 px-4 py-2 font-display text-sm uppercase tracking-wide text-graphite shadow-hard-sm'
      }
    >
      {children}
    </button>
  );
}

/**
 * `/packs` — the pack manager (copy.md §14). Gated on a real guest
 * identity (every pack REST call is authed, api-contract.md §0) the same way the room routes
 * gate on the join flow: `loading` renders nothing, `anonymous` shows the same
 * `NamePromptCard` the home screen uses, `authed` renders the manager.
 */
export default function PacksPage() {
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
      <PackManager />
    </QueryClientProvider>
  );
}
