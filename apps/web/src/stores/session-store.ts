import { create } from 'zustand';
import type { Player } from '@sketchy/shared/contract/players';
import { apiClient } from '@/lib/api-client';

/**
 * localStorage key for the persisted session (token + player), conventions.md
 * §1 (session-store holds token/player). Bump the version suffix if the
 * persisted shape ever changes incompatibly.
 */
const STORAGE_KEY = 'sketchy.session.v1';

interface PersistedSession {
  token: string;
  player: Player;
}

export type SessionStatus = 'loading' | 'anonymous' | 'authed';

export interface SessionState {
  token: string | null;
  player: Player | null;
  /**
   * `loading` until `hydrate()` has read localStorage once (SSR + first
   * client paint both render this — see `session-boot.tsx`); then
   * `anonymous` or `authed`.
   */
  status: SessionStatus;
  /** Creates a guest identity (name prompt, copy.md §2), persists the
   * result, and flips `status` to `authed`. Rejects with `ApiError` (or a
   * raw fetch failure) — the caller (name-prompt-card) renders the copy. */
  signIn: (displayName: string) => Promise<void>;
  /** Reads any persisted session from localStorage (SSR-safe no-op on the
   * server — `window` doesn't exist there) and sets `status` accordingly.
   * If a token was found, fire-and-forgets a `getMe` refresh so a
   * server-side rename is picked up; tolerates failure (offline / dead
   * token) by keeping the cached player. Call once, on mount. */
  hydrate: () => void;
  /** Applies a silently-reissued token (api-contract.md §1, past-half-expiry
   * re-issue via the `X-Refreshed-Token` header). */
  applyRefreshedToken: (token: string) => void;
  updatePlayer: (player: Player) => void;
  /** Adopts a fresh `{ token, player }` pair wholesale — the account
   * magic-link verify (`POST /auth/link/verify`) returns a NEW token (now
   * `guest:false`) plus the upgraded player; this persists both and flips the
   * device to that identity, exactly like `signIn` does for a guest. */
  adoptSession: (token: string, player: Player) => void;
  /** Drops the session on THIS device: clears the token/player, removes the
   * persisted copy, and flips `status` to `anonymous`. Used by self-service
   * account deletion (`DELETE /v1/account`) — the server can't revoke the
   * still-valid JWT, so dropping it here IS the session end. */
  signOut: () => void;
}

function readPersisted(): PersistedSession | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedSession> | null;
    if (!parsed || typeof parsed.token !== 'string' || !parsed.player) {
      return null;
    }
    return { token: parsed.token, player: parsed.player };
  } catch {
    // Corrupt JSON, or localStorage unavailable (private mode) — treat as
    // "no session" rather than crashing the bootstrap.
    return null;
  }
}

function writePersisted(session: PersistedSession): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota exceeded / private mode — the session still works in-memory for
    // this tab, it just won't survive a reload.
  }
}

function clearPersisted(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode) — the in-memory reset below is
    // still enough to end the session for this tab.
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  player: null,
  status: 'loading',

  signIn: async (displayName) => {
    const { token, player } = await apiClient.guestAuth({ displayName });
    set({ token, player, status: 'authed' });
    writePersisted({ token, player });
  },

  hydrate: () => {
    const persisted = readPersisted();
    if (!persisted) {
      set({ status: 'anonymous' });
      return;
    }

    set({ token: persisted.token, player: persisted.player, status: 'authed' });

    // Fire-and-forget: an offline reload should still land on the cached
    // player rather than blocking (or failing) the bootstrap.
    void apiClient
      .getMe()
      .then((response) => {
        get().updatePlayer(response.player);
      })
      .catch(() => {
        // Offline, or the token finally expired — keep the cached player;
        // the next authenticated call will surface `unauthorized` for real.
      });
  },

  applyRefreshedToken: (token) => {
    set({ token });
    const { player } = get();
    if (player) {
      writePersisted({ token, player });
    }
  },

  updatePlayer: (player) => {
    set({ player });
    const { token } = get();
    if (token) {
      writePersisted({ token, player });
    }
  },

  adoptSession: (token, player) => {
    set({ token, player, status: 'authed' });
    writePersisted({ token, player });
  },

  signOut: () => {
    clearPersisted();
    set({ token: null, player: null, status: 'anonymous' });
  },
}));
