import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Pack, PublicPacksPage } from '@sketchy/shared/contract/packs';
import type { Player } from '@sketchy/shared/contract/players';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';
import { PublicPacksBrowser } from './public-packs-browser';

// The browser fetches + imports through the real `@/lib/api-client` singleton — stub both so
// this stays a pure render test driven by the session store and the mocked responses.
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    browsePublicPacks: vi.fn(),
    importPublicPack: vi.fn(),
  },
}));

const browsePublicPacks = vi.mocked(apiClient.browsePublicPacks);
const importPublicPack = vi.mocked(apiClient.importPublicPack);

const AUTHED_PLAYER: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Priya',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'civilian' },
  isGuest: true,
  createdAt: Date.now(),
};

function makePack(id: string, name: string): Pack {
  return {
    id,
    slug: null,
    name,
    description: '',
    category: 'custom',
    language: 'en',
    isOfficial: false,
    ownerId: '223e4567-e89b-12d3-a456-426614174000',
    visibility: 'public',
    reviewStatus: 'approved',
    shareCode: null,
    coverUrl: null,
    pairCount: 12,
    createdAt: Date.now(),
    ownerName: 'Sam',
  };
}

const PACK_ID = '333e4567-e89b-12d3-a456-426614174000';
const PAGE_ONE: PublicPacksPage = {
  items: [makePack(PACK_ID, 'Community Pack')],
  nextCursor: 'cursor-1',
};

function renderBrowser() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PublicPacksBrowser />
    </QueryClientProvider>,
  );
}

describe('PublicPacksBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ status: 'authed', player: AUTHED_PLAYER, token: 'test-token' });
    browsePublicPacks.mockResolvedValue(PAGE_ONE);
    importPublicPack.mockResolvedValue({ pack: PAGE_ONE.items[0]! });
  });

  it('renders the catalog list for an authed player', async () => {
    renderBrowser();

    expect(await screen.findByTestId('browse-list')).toBeTruthy();
    expect(screen.getByText('Community Pack')).toBeTruthy();
    expect(screen.getByTestId('browse-add').textContent).toBe(copy.packs.browse.addButton);
  });

  it('"Add to my packs" imports the pack by id and reflects the added state', async () => {
    renderBrowser();

    const addButton = (await screen.findByTestId('browse-add')) as HTMLButtonElement;
    fireEvent.click(addButton);

    expect(importPublicPack).toHaveBeenCalledWith(PACK_ID);
    await waitFor(() => {
      const button = screen.getByTestId('browse-add') as HTMLButtonElement;
      expect(button.textContent).toBe(copy.packs.browse.addedButton);
      expect(button.disabled).toBe(true);
    });
  });

  it('renders the empty state when the catalog has nothing to add', async () => {
    browsePublicPacks.mockResolvedValue({ items: [], nextCursor: null });
    renderBrowser();

    expect(await screen.findByTestId('browse-empty')).toBeTruthy();
    expect(screen.getByText(copy.packs.browse.empty)).toBeTruthy();
    expect(screen.queryByTestId('browse-list')).toBeNull();
  });

  it('surfaces an error line when the fetch fails instead of failing silently', async () => {
    browsePublicPacks.mockRejectedValue(new Error('boom'));
    renderBrowser();

    const alert = await screen.findByTestId('browse-error');
    expect(alert.textContent).toBe(copy.packs.browse.error);
  });

  it('disables "Load more" while a page is in flight and never double-fetches', async () => {
    // Mount resolves page one; the load-more fetch stays pending so the guard is observable.
    let resolveSecond: ((page: PublicPacksPage) => void) | undefined;
    browsePublicPacks
      .mockResolvedValueOnce(PAGE_ONE)
      .mockImplementationOnce(
        () =>
          new Promise<PublicPacksPage>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    renderBrowser();
    const button = (await screen.findByTestId('browse-load-more')) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(button.disabled).toBe(true);

    // A rapid second tap can't kick off an overlapping fetch (mount + one load-more = 2).
    fireEvent.click(button);
    expect(browsePublicPacks).toHaveBeenCalledTimes(2);

    resolveSecond?.({ items: [], nextCursor: null });
  });
});
