import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@sketchy/shared/contract/players';
import { useSessionStore } from './session-store';

const guestAuth = vi.fn();
const getMe = vi.fn();

// `session-store.ts` imports the real `@/lib/api-client` singleton, which in
// turn imports `@sketchy/shared/client` (a real `fetch`-based client) and
// this very store back (see api-client.ts's doc comment on the deliberate
// circular import). Mocking the module wholesale means the real client, and
// its circular import back into this store, never actually loads in tests —
// no network calls, and no risk of the mock racing module initialization.
// Vitest hoists `vi.mock` above the imports above, so the store's own
// `import { apiClient } from '@/lib/api-client'` resolves to this mock.
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    guestAuth: (body: { displayName: string }) => guestAuth(body),
    getMe: () => getMe(),
  },
}));

const STORAGE_KEY = 'sketchy.session.v1';

const validPlayer: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Sam',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' },
  isGuest: true,
  createdAt: Date.now(),
};

const renamedPlayer: Player = { ...validPlayer, displayName: 'Sam the Second' };

function readStorage(): { token: string; player: Player } | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { token: string; player: Player }) : null;
}

describe('session-store', () => {
  beforeEach(() => {
    guestAuth.mockReset();
    getMe.mockReset();
    window.localStorage.clear();
    useSessionStore.setState({ token: null, player: null, status: 'loading' });
  });

  it('signIn stores the token+player, flips status to authed, and persists them', async () => {
    guestAuth.mockResolvedValueOnce({ token: 'jwt-1', player: validPlayer });

    await useSessionStore.getState().signIn('Sam');

    expect(guestAuth).toHaveBeenCalledWith({ displayName: 'Sam' });
    const state = useSessionStore.getState();
    expect(state.status).toBe('authed');
    expect(state.token).toBe('jwt-1');
    expect(state.player).toEqual(validPlayer);
    expect(readStorage()).toEqual({ token: 'jwt-1', player: validPlayer });
  });

  it('signIn rejects and leaves status untouched when guestAuth fails', async () => {
    guestAuth.mockRejectedValueOnce(new Error('boom'));

    await expect(useSessionStore.getState().signIn('Sam')).rejects.toThrow('boom');
    expect(useSessionStore.getState().status).toBe('loading');
    expect(readStorage()).toBeNull();
  });

  it('hydrate flips to anonymous when nothing is persisted', () => {
    useSessionStore.getState().hydrate();

    expect(useSessionStore.getState().status).toBe('anonymous');
  });

  it('hydrate restores a persisted session synchronously', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', player: validPlayer }),
    );
    getMe.mockResolvedValueOnce({ player: validPlayer });

    useSessionStore.getState().hydrate();

    const state = useSessionStore.getState();
    expect(state.status).toBe('authed');
    expect(state.token).toBe('jwt-1');
    expect(state.player).toEqual(validPlayer);
  });

  it('hydrate fire-and-forgets a getMe refresh and applies the updated player', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', player: validPlayer }),
    );
    getMe.mockResolvedValueOnce({ player: renamedPlayer });

    useSessionStore.getState().hydrate();

    await vi.waitFor(() => {
      expect(useSessionStore.getState().player).toEqual(renamedPlayer);
    });
    expect(readStorage()).toEqual({ token: 'jwt-1', player: renamedPlayer });
  });

  it('hydrate tolerates a failed getMe refresh (offline) and keeps the cached player', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', player: validPlayer }),
    );
    getMe.mockRejectedValueOnce(new Error('network down'));

    useSessionStore.getState().hydrate();

    await vi.waitFor(() => {
      expect(getMe).toHaveBeenCalledTimes(1);
    });
    // Give the rejected promise's .catch a tick to run before asserting the
    // state didn't change.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = useSessionStore.getState();
    expect(state.status).toBe('authed');
    expect(state.player).toEqual(validPlayer);
  });

  it('applyRefreshedToken updates the token and re-persists it alongside the current player', () => {
    useSessionStore.setState({ token: 'jwt-1', player: validPlayer, status: 'authed' });
    writeInitialStorage();

    useSessionStore.getState().applyRefreshedToken('jwt-2');

    expect(useSessionStore.getState().token).toBe('jwt-2');
    expect(readStorage()).toEqual({ token: 'jwt-2', player: validPlayer });
  });

  it('updatePlayer updates the player and re-persists it alongside the current token', () => {
    useSessionStore.setState({ token: 'jwt-1', player: validPlayer, status: 'authed' });
    writeInitialStorage();

    useSessionStore.getState().updatePlayer(renamedPlayer);

    expect(useSessionStore.getState().player).toEqual(renamedPlayer);
    expect(readStorage()).toEqual({ token: 'jwt-1', player: renamedPlayer });
  });
});

function writeInitialStorage(): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: 'jwt-1', player: validPlayer }));
}
