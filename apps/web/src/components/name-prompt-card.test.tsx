import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@sketchy/shared/client';
import type { Player } from '@sketchy/shared/contract/players';
import { copy } from '../copy';
import { useSessionStore } from '@/stores/session-store';
import { NamePromptCard } from './name-prompt-card';

const guestAuth = vi.fn();
const getMe = vi.fn();

// The store this component reads from calls the real `@/lib/api-client`
// singleton, which opens a real `fetch`. Mock it wholesale so no test in
// this file ever touches the network (per-task instruction: mock
// `src/lib/api-client.ts` via `vi.mock`).
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    guestAuth: (body: { displayName: string }) => guestAuth(body),
    getMe: () => getMe(),
  },
}));

const validPlayer: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Sam',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' },
  isGuest: true,
  createdAt: Date.now(),
};

describe('NamePromptCard', () => {
  beforeEach(() => {
    guestAuth.mockReset();
    getMe.mockReset();
    window.localStorage.clear();
    useSessionStore.setState({ token: null, player: null, status: 'anonymous' });
  });

  it('renders nothing while the session is still loading', () => {
    useSessionStore.setState({ status: 'loading' });
    const { container } = render(<NamePromptCard />);

    expect(container.childElementCount).toBe(0);
  });

  it('renders the §2 name-prompt copy verbatim when anonymous', () => {
    render(<NamePromptCard />);

    // The question is the input's single visible <label> (its former duplicate
    // display heading was dropped so the card shows the prompt once) — the input
    // still resolves by that accessible name.
    expect(screen.getByText(copy.home.namePrompt.question)).toBeTruthy();
    expect(screen.getByLabelText(copy.home.namePrompt.question)).toBeTruthy();
    expect(screen.getByPlaceholderText(copy.home.namePrompt.placeholder)).toBeTruthy();
    expect(screen.getByText(copy.home.namePrompt.helper)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.home.namePrompt.submit })).toBeTruthy();
  });

  it('signs in on submit and switches to the authed signature state', async () => {
    guestAuth.mockResolvedValueOnce({ token: 'jwt-1', player: validPlayer });
    render(<NamePromptCard />);

    fireEvent.change(screen.getByPlaceholderText(copy.home.namePrompt.placeholder), {
      target: { value: 'Sam' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.home.namePrompt.submit }));

    await waitFor(() => {
      expect(screen.getByText('Sam')).toBeTruthy();
    });
    expect(guestAuth).toHaveBeenCalledWith({ displayName: 'Sam' });
    // The form is gone — no more asking once we're authed.
    expect(screen.queryByPlaceholderText(copy.home.namePrompt.placeholder)).toBeNull();
  });

  it('renders the exact §9 profanity line when signIn rejects with that ApiError code', async () => {
    guestAuth.mockRejectedValueOnce(new ApiError(400, 'profanity', "Let's keep it printable."));
    render(<NamePromptCard />);

    fireEvent.change(screen.getByPlaceholderText(copy.home.namePrompt.placeholder), {
      target: { value: 'badname' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.home.namePrompt.submit }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(copy.errors.profanity);
    });
    expect(screen.getByPlaceholderText(copy.home.namePrompt.placeholder)).toBeTruthy();
  });

  it('renders the network-offline line when signIn throws a raw (non-ApiError) failure', async () => {
    guestAuth.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<NamePromptCard />);

    fireEvent.change(screen.getByPlaceholderText(copy.home.namePrompt.placeholder), {
      target: { value: 'Sam' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.home.namePrompt.submit }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(copy.errors.networkOffline);
    });
  });

  it('disables submit until the name is at least 2 characters', () => {
    render(<NamePromptCard />);

    const submit = screen.getByRole('button', {
      name: copy.home.namePrompt.submit,
    }) as HTMLButtonElement;
    const input = screen.getByPlaceholderText(copy.home.namePrompt.placeholder);

    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'S' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Sam' } });
    expect(submit.disabled).toBe(false);
  });
});
