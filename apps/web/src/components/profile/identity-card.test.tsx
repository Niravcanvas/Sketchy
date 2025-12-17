import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@sketchy/shared/contract/players';
import { copy } from '@/copy';
import { useSessionStore } from '@/stores/session-store';
import { IdentityCard } from './identity-card';

const patchMe = vi.fn();

// Same wholesale-mock rationale as `session-store.test.ts`: `identity-card.tsx` AND
// `session-store.ts` (circularly) both import the real `@/lib/api-client` singleton — mocking
// it here keeps this test off the network for both.
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    patchMe: (body: unknown) => patchMe(body),
  },
}));

const PLAYER: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Priya',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'civilian' },
  isGuest: true,
  createdAt: Date.now(),
};

describe('IdentityCard', () => {
  beforeEach(() => {
    patchMe.mockReset();
    useSessionStore.setState({ player: PLAYER, token: 'test-token', status: 'authed' });
  });

  it('renders nothing without a session player', () => {
    useSessionStore.setState({ player: null, token: null, status: 'anonymous' });
    const { container } = render(<IdentityCard />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the read-only name + avatar, then switches to the edit form on the pencil chip', () => {
    render(<IdentityCard />);
    // "Priya" legitimately appears twice: the name heading, and the avatar SVG's accessible
    // `<title>` (AvatarDoodle's `title` prop) — scope to the heading specifically.
    expect(screen.getByText('Priya', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText(copy.profile.identity.save)).toBeNull();

    fireEvent.click(screen.getByTestId('profile-edit-identity'));
    expect(screen.getByText(copy.profile.identity.save)).toBeTruthy();
    expect(screen.getByText(copy.profile.identity.cancel)).toBeTruthy();
  });

  it('cancel discards the draft without calling PATCH /players/me', () => {
    render(<IdentityCard />);
    fireEvent.click(screen.getByTestId('profile-edit-identity'));
    fireEvent.click(screen.getByText(copy.profile.identity.cancel));

    expect(patchMe).not.toHaveBeenCalled();
    expect(screen.getByText('Priya', { selector: 'p' })).toBeTruthy();
    expect(useSessionStore.getState().player?.displayName).toBe('Priya');
  });

  it('save calls PATCH /players/me and updates session-store on success', async () => {
    const updated: Player = { ...PLAYER, displayName: 'Priya the Second' };
    patchMe.mockResolvedValue({ player: updated });

    render(<IdentityCard />);
    fireEvent.click(screen.getByTestId('profile-edit-identity'));

    const nameInput = screen.getByLabelText(copy.home.namePrompt.question);
    fireEvent.change(nameInput, { target: { value: 'Priya the Second' } });
    fireEvent.click(screen.getByText(copy.profile.identity.save));

    await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(1));
    expect(patchMe).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Priya the Second' }),
    );
    // `{ selector: 'p' }`: the same name also appears in the avatar SVG's accessible
    // `<title>` (AvatarDoodle's `title` prop) — scope to the name heading specifically.
    await waitFor(() =>
      expect(screen.getByText('Priya the Second', { selector: 'p' })).toBeTruthy(),
    );
    expect(useSessionStore.getState().player?.displayName).toBe('Priya the Second');
  });

  it('shows the mapped error line and stays in edit mode when PATCH fails', async () => {
    const { ApiError } = await import('@sketchy/shared/client');
    patchMe.mockRejectedValue(new ApiError(400, 'profanity', 'nope'));

    render(<IdentityCard />);
    fireEvent.click(screen.getByTestId('profile-edit-identity'));
    fireEvent.click(screen.getByText(copy.profile.identity.save));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.errors.profanity));
    // Still in edit mode — the draft isn't discarded on a failed save.
    expect(screen.getByText(copy.profile.identity.save)).toBeTruthy();
  });
});
