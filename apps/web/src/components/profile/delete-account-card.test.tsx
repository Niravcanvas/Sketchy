import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@sketchy/shared/contract/players';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session-store';
import { DeleteAccountCard } from './delete-account-card';

// Hoisted so the `next/navigation` mock factory can close over it (vi.mock is hoisted above
// imports). The card calls `router.replace('/')` after a successful delete.
const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

// `delete-account-card.tsx` AND `session-store.ts` both import the real `@/lib/api-client`
// singleton — mock it so the whole test stays off the network.
vi.mock('@/lib/api-client', () => ({
  apiClient: { deleteAccount: vi.fn() },
}));

const deleteAccountMock = vi.mocked(apiClient.deleteAccount);
const del = copy.matchmaking.account.deleteAccount;

const LINKED_PLAYER: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Priya',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'civilian' },
  isGuest: false,
  createdAt: Date.now(),
};

describe('DeleteAccountCard', () => {
  beforeEach(() => {
    deleteAccountMock.mockReset();
    replaceMock.mockReset();
    useSessionStore.setState({ player: LINKED_PLAYER, token: 'test-token', status: 'authed' });
  });

  it('renders nothing for a guest — guests have no linked account to delete', () => {
    useSessionStore.setState({
      player: { ...LINKED_PLAYER, isGuest: true },
      token: 'guest-token',
      status: 'authed',
    });
    const { container } = render(<DeleteAccountCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the danger section for a linked account', () => {
    render(<DeleteAccountCard />);
    // `heading` and `trigger` share the label "Delete account" — scope to the section heading.
    expect(screen.getByRole('heading', { name: del.heading })).toBeTruthy();
    expect(screen.getByTestId('delete-account-trigger')).toBeTruthy();
  });

  it('keeps the destructive button disabled until the type-to-confirm matches DELETE', () => {
    render(<DeleteAccountCard />);
    fireEvent.click(screen.getByTestId('delete-account-trigger'));

    const confirm = screen.getByTestId('delete-account-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const input = screen.getByLabelText(del.confirmLabel);
    fireEvent.change(input, { target: { value: 'delete' } }); // wrong case
    expect(confirm.disabled).toBe(true);

    fireEvent.change(input, { target: { value: del.confirmWord } });
    expect(confirm.disabled).toBe(false);
  });

  it('confirming calls deleteAccount(), drops the session, and returns home', async () => {
    deleteAccountMock.mockResolvedValue({ ok: true });

    render(<DeleteAccountCard />);
    fireEvent.click(screen.getByTestId('delete-account-trigger'));
    fireEvent.change(screen.getByLabelText(del.confirmLabel), {
      target: { value: del.confirmWord },
    });
    fireEvent.click(screen.getByTestId('delete-account-confirm'));

    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalledTimes(1));
    // Logged out: token dropped, status flipped to anonymous.
    await waitFor(() => expect(useSessionStore.getState().status).toBe('anonymous'));
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().player).toBeNull();
    expect(replaceMock).toHaveBeenCalledWith('/');
  });

  it('shows the mapped error line and keeps the session when the delete fails', async () => {
    const { ApiError } = await import('@sketchy/shared/client');
    deleteAccountMock.mockRejectedValue(new ApiError(429, 'rate_limited', 'slow down'));

    render(<DeleteAccountCard />);
    fireEvent.click(screen.getByTestId('delete-account-trigger'));
    fireEvent.change(screen.getByLabelText(del.confirmLabel), {
      target: { value: del.confirmWord },
    });
    fireEvent.click(screen.getByTestId('delete-account-confirm'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(copy.errors.rateLimited),
    );
    // Session intact — a failed delete never logs the player out.
    expect(useSessionStore.getState().status).toBe('authed');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
