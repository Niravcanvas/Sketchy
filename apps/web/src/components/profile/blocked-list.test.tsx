import { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockItem } from '@sketchy/shared/contract/blocks';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useBlocksStore } from '@/stores/blocks-store';
import { BlockedList } from './blocked-list';

// `blocked-list.tsx` reads `GET /blocks` and `blocks-store.unblock` (which itself calls the
// real `apiClient` singleton) — mock the whole module so both paths stay off the network.
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    listBlocks: vi.fn(),
    unblockPlayer: vi.fn(),
  },
}));

const listBlocksMock = vi.mocked(apiClient.listBlocks);
const unblockPlayerMock = vi.mocked(apiClient.unblockPlayer);

const ID_A = '123e4567-e89b-12d3-a456-426614174000';
const ID_B = '987f6543-a21b-43c4-b567-537725285111';

function blockItem(id: string): BlockItem {
  return { blockedPlayerId: id, createdAt: Date.now() };
}

/** Fresh `QueryClientProvider` per render, `retry: false` so a rejected mock fails a query
 * immediately (same helper shape as `win-screen.test.tsx`). */
function renderWithClient(ui: ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(ui, { wrapper: Wrapper });
}

describe('BlockedList', () => {
  beforeEach(() => {
    listBlocksMock.mockReset();
    unblockPlayerMock.mockReset();
    useBlocksStore.setState({ blockedIds: [], loaded: false });
  });

  it('renders a row (shortened id) for each blocked player from GET /blocks', async () => {
    listBlocksMock.mockResolvedValue({ items: [blockItem(ID_A), blockItem(ID_B)] });

    renderWithClient(<BlockedList />);

    expect(screen.getByText(copy.matchmaking.moderation.blockedListHeading)).toBeTruthy();
    // Scope to the visible label span: the shortened id also appears in the AvatarDoodle's
    // accessible `<title>`, so a bare getByText would match twice.
    await waitFor(() => expect(screen.getByText('123e4567', { selector: 'span' })).toBeTruthy());
    expect(screen.getByText('987f6543', { selector: 'span' })).toBeTruthy();
  });

  it('shows the empty-state copy when the block list is empty', async () => {
    listBlocksMock.mockResolvedValue({ items: [] });

    renderWithClient(<BlockedList />);

    await waitFor(() =>
      expect(screen.getByText(copy.matchmaking.moderation.blockedListEmpty)).toBeTruthy(),
    );
  });

  it('unblock calls DELETE /blocks/:id and removes the row from the list', async () => {
    // Stateful backing list so the post-unblock refetch (query invalidation) reflects the
    // removal — the same way the real server would drop the row.
    let backing: BlockItem[] = [blockItem(ID_A), blockItem(ID_B)];
    listBlocksMock.mockImplementation(async () => ({ items: backing }));
    unblockPlayerMock.mockImplementation(async (id: string) => {
      backing = backing.filter((b) => b.blockedPlayerId !== id);
      return { ok: true };
    });

    renderWithClient(<BlockedList />);

    await waitFor(() => expect(screen.getByText('123e4567', { selector: 'span' })).toBeTruthy());

    fireEvent.click(
      screen.getByRole('button', { name: `${copy.matchmaking.moderation.unblock} 123e4567` }),
    );

    await waitFor(() => expect(unblockPlayerMock).toHaveBeenCalledWith(ID_A));
    // Row for the unblocked player leaves; the other block stays.
    await waitFor(() =>
      expect(screen.queryByText('123e4567', { selector: 'span' })).toBeNull(),
    );
    expect(screen.getByText('987f6543', { selector: 'span' })).toBeTruthy();
  });
});
