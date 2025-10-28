import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbiesPage } from '@sketchy/shared/contract/matchmaking';
import type { Player } from '@sketchy/shared/contract/players';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';
import { LobbiesBrowser } from './lobbies-browser';

// The browser navigates on join/host and fetches the lobby list through the real
// `@/lib/api-client` singleton — stub both so this stays a pure render test driven by
// the session store and the mocked list responses.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getLobbies: vi.fn(),
    createRoom: vi.fn().mockResolvedValue({ code: 'ABCDE' }),
  },
}));

const getLobbies = vi.mocked(apiClient.getLobbies);

const LINKED_PLAYER: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Priya',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'civilian' },
  isGuest: false,
  createdAt: Date.now(),
};

const PAGE_ONE: LobbiesPage = {
  items: [{ code: 'ABCDE', hostName: 'Priya', playerCount: 2, maxPlayers: 6, language: 'en' }],
  nextCursor: 'cursor-1',
};

describe('LobbiesBrowser — access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLobbies.mockResolvedValue(PAGE_ONE);
  });

  it('shows the actionable sign-in gate (not the list) to a visitor without a session', () => {
    useSessionStore.setState({ status: 'anonymous', player: null, token: null });
    render(<LobbiesBrowser />);

    expect(screen.getByTestId('lobbies-gate')).toBeTruthy();
    expect(screen.getByText(copy.matchmaking.publicRoom.browseGate)).toBeTruthy();
    // The account-link affordance, and never the list itself.
    expect(screen.getByText(copy.matchmaking.account.linkButton)).toBeTruthy();
    expect(screen.queryByText(copy.matchmaking.publicRoom.browserTitle)).toBeNull();
    // Browsing the list is not even attempted without a session.
    expect(getLobbies).not.toHaveBeenCalled();
  });

  it('shows the browser (heading + list) to an authed player', async () => {
    useSessionStore.setState({ status: 'authed', player: LINKED_PLAYER, token: 'test-token' });
    render(<LobbiesBrowser />);

    expect(await screen.findByTestId('lobbies-list')).toBeTruthy();
    expect(screen.getByText(copy.matchmaking.publicRoom.browserTitle)).toBeTruthy();
    expect(screen.queryByTestId('lobbies-gate')).toBeNull();
  });
});

describe('LobbiesBrowser — load more', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ status: 'authed', player: LINKED_PLAYER, token: 'test-token' });
  });

  it('disables "Load more" while a page is in flight and never double-fetches', async () => {
    // Mount resolves page one; the load-more fetch stays pending so the guard is observable.
    let resolveSecond: ((page: LobbiesPage) => void) | undefined;
    getLobbies
      .mockResolvedValueOnce(PAGE_ONE)
      .mockImplementationOnce(
        () =>
          new Promise<LobbiesPage>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    render(<LobbiesBrowser />);
    const button = (await screen.findByTestId('lobbies-load-more')) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(button.disabled).toBe(true);

    // A rapid second tap can't kick off an overlapping fetch.
    fireEvent.click(button);
    expect(getLobbies).toHaveBeenCalledTimes(2);

    resolveSecond?.({ items: [], nextCursor: null });
  });
});

describe('LobbiesBrowser — failure feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ status: 'authed', player: LINKED_PLAYER, token: 'test-token' });
  });

  it('surfaces an error line when the list fetch fails instead of failing silently', async () => {
    getLobbies.mockRejectedValue(new Error('boom'));
    render(<LobbiesBrowser />);

    const alert = await screen.findByTestId('lobbies-error');
    expect(alert.textContent).toBe(copy.errors.generic500);
  });
});
