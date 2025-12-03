import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorCode } from '@sketchy/shared/contract/errors';
import type { Player } from '@sketchy/shared/contract/players';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { useMatchmakingStore } from '@/stores/matchmaking-store';
import { useSessionStore } from '@/stores/session-store';
import { QuickJoinButton } from './quick-join-button';

// The component navigates on match, the store owns a websocket, and both (plus session-store)
// import the real `@/lib/api-client` singleton — stub all three so this stays a pure render
// test that drives the store's error state directly (no navigation, socket, or network).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/matchmaking-socket', () => ({
  connectMatchmaking: vi.fn(),
  disconnectMatchmaking: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    enqueueMatchmaking: vi.fn().mockResolvedValue({}),
    cancelMatchmaking: vi.fn().mockResolvedValue({}),
    createRoom: vi.fn().mockResolvedValue({ code: 'ABCD' }),
  },
}));

const LINKED_PLAYER: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Priya',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'civilian' },
  isGuest: false,
  createdAt: Date.now(),
};

// Set the store into a matchmaking failure BEFORE render so the initial render reflects it
// (no post-render setState outside `act`).
function enterError(error: ErrorCode | 'network'): void {
  useMatchmakingStore.setState({ status: 'error', error, matchedCode: null });
}

describe('QuickJoinButton — matchmaking error surface', () => {
  beforeEach(() => {
    useSessionStore.setState({ player: LINKED_PLAYER, token: 'test-token', status: 'authed' });
    useMatchmakingStore.setState({
      status: 'idle',
      matchedCode: null,
      error: null,
      startedAt: null,
    });
  });

  it('keeps the modal open and shows the mapped error line on an `ErrorCode` failure', () => {
    enterError('rate_limited');
    render(<QuickJoinButton />);

    // The failure is surfaced, not silently swallowed: modal stays open with the error heading
    // + the shared `copyForError` line, and the "still searching" heading is gone.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(copy.matchmaking.quickJoin.errorHeading)).toBeTruthy();
    expect(screen.getByText(copyForError('rate_limited'))).toBeTruthy();
    expect(screen.queryByText(copy.matchmaking.quickJoin.searchingHeading)).toBeNull();
  });

  it('maps the literal `network` error to the offline line (not through copyForError)', () => {
    enterError('network');
    render(<QuickJoinButton />);

    expect(screen.getByText(copy.errors.networkOffline)).toBeTruthy();
  });

  it('shows the suspended explanation when a suspended player quick-joins', () => {
    enterError('suspended');
    render(<QuickJoinButton />);

    expect(screen.getByText(copyForError('suspended'))).toBeTruthy();
    expect(screen.getByText(copy.errors.suspended)).toBeTruthy();
  });

  it('"Try again" re-enqueues — status flips back to searching and the modal shows the search UI', () => {
    enterError('rate_limited');
    render(<QuickJoinButton />);

    fireEvent.click(screen.getByTestId('quick-join-retry'));

    expect(useMatchmakingStore.getState().status).toBe('searching');
    expect(screen.getByText(copy.matchmaking.quickJoin.searchingHeading)).toBeTruthy();
    expect(screen.queryByText(copy.matchmaking.quickJoin.errorHeading)).toBeNull();
  });

  it('dismiss resets the store to idle and closes the modal', () => {
    enterError('rate_limited');
    render(<QuickJoinButton />);

    fireEvent.click(screen.getByText(copy.matchmaking.quickJoin.cancel));

    expect(useMatchmakingStore.getState().status).toBe('idle');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
