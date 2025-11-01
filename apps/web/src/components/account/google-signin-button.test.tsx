import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@sketchy/shared/contract/players';
import { apiClient } from '@/lib/api-client';
import {
  loadGoogleIdentity,
  type GoogleCredentialResponse,
  type GoogleIdentityApi,
} from '@/lib/google-identity';
import { useSessionStore } from '@/stores/session-store';
import { GoogleSignInButton } from './google-signin-button';

// Both the component and session-store import the real `@/lib/api-client` singleton —
// mock it so the test stays off the network. GIS is mocked too (no script load in jsdom).
vi.mock('@/lib/api-client', () => ({ apiClient: { googleSignIn: vi.fn(), getMe: vi.fn() } }));
vi.mock('@/lib/google-identity', () => ({ loadGoogleIdentity: vi.fn() }));

const googleSignInMock = vi.mocked(apiClient.googleSignIn);
const loadGoogleIdentityMock = vi.mocked(loadGoogleIdentity);

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

const UPGRADED: Player = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Grace',
  avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'civilian' },
  isGuest: false,
  createdAt: Date.now(),
};

/** A fake GIS surface: captures the credential callback `initialize()` receives and
 * spies `renderButton`, so a test can wait for the button to mount and then fire a
 * credential as GIS would after the user picks a Google account. */
function fakeIdentity() {
  let captured: ((response: GoogleCredentialResponse) => void) | null = null;
  const initialize = vi.fn(
    (config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => {
      captured = config.callback;
    },
  );
  const renderButton = vi.fn();
  const api = { initialize, renderButton } as unknown as GoogleIdentityApi;
  return {
    api,
    initialize,
    renderButton,
    fireCredential: (credential: string) => captured?.({ credential }),
  };
}

describe('GoogleSignInButton', () => {
  beforeEach(() => {
    googleSignInMock.mockReset();
    loadGoogleIdentityMock.mockReset();
    // Start signed in as a guest — linking upgrades this device in place.
    useSessionStore.setState({
      token: 'guest-token',
      player: { ...UPGRADED, isGuest: true },
      status: 'authed',
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing and never loads GIS when the client ID is unset (feature off)', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '');
    const { container } = render(<GoogleSignInButton />);
    expect(container.firstChild).toBeNull();
    expect(loadGoogleIdentityMock).not.toHaveBeenCalled();
  });

  it('renders the Google button and initializes GIS with the client ID when configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', CLIENT_ID);
    const gis = fakeIdentity();
    loadGoogleIdentityMock.mockResolvedValue(gis.api);

    render(<GoogleSignInButton />);
    expect(screen.getByTestId('google-signin')).toBeTruthy();

    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(1));
    expect(gis.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: CLIENT_ID }));
  });

  it('links via googleSignIn and adopts the returned session on the credential callback', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', CLIENT_ID);
    const gis = fakeIdentity();
    loadGoogleIdentityMock.mockResolvedValue(gis.api);
    googleSignInMock.mockResolvedValue({ token: 'upgraded-jwt', player: UPGRADED });

    render(<GoogleSignInButton />);
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    // GIS fires the credential (the Google ID token) after the user picks an account.
    gis.fireCredential('fake-id-token');

    await waitFor(() => expect(googleSignInMock).toHaveBeenCalledWith('fake-id-token'));
    // The device adopts the upgraded (non-guest) identity, exactly like magic-link verify.
    await waitFor(() => expect(useSessionStore.getState().player?.isGuest).toBe(false));
    expect(useSessionStore.getState().token).toBe('upgraded-jwt');
  });
});
