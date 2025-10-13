import { create } from 'zustand';
import { ApiError } from '@sketchy/shared/client';
import type { ErrorCode } from '@sketchy/shared/contract/errors';
import { apiClient } from '@/lib/api-client';
import { connectMatchmaking, disconnectMatchmaking } from '@/lib/matchmaking-socket';

export type MatchmakingStatus = 'idle' | 'searching' | 'matched' | 'error';

export interface MatchmakingState {
  status: MatchmakingStatus;
  matchedCode: string | null;
  /** An `ErrorCode` from the enqueue call (e.g. `account_required`), or
   * `'network'` for a raw fetch failure. */
  error: ErrorCode | 'network' | null;
  /** When the current search began (epoch ms) — drives the 90s "host instead?"
   * fallback offer in the UI. */
  startedAt: number | null;
  startSearch: (language: string) => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Quick-join state. Owns the matchmaking socket lifecycle and the
 * REST enqueue/cancel. The socket connects first; enqueue fires only once it's
 * connected (`onConnect`) so a match can't be pushed before this player's
 * personal room exists. Resolution (`mm:matched`) flips `status` to `matched`
 * with the room `code`, which the UI navigates to.
 */
export const useMatchmakingStore = create<MatchmakingState>((set, get) => ({
  status: 'idle',
  matchedCode: null,
  error: null,
  startedAt: null,

  startSearch: (language) => {
    set({ status: 'searching', error: null, matchedCode: null, startedAt: Date.now() });
    connectMatchmaking({
      onConnect: () => {
        // Enqueue only once the socket is up, so `mm:matched` can always reach us.
        void apiClient
          .enqueueMatchmaking({ language })
          .catch((error: unknown) => {
            disconnectMatchmaking();
            const code = error instanceof ApiError ? error.code : 'network';
            // A late error only matters if we're still searching (not already matched).
            if (get().status === 'searching') {
              set({ status: 'error', error: code });
            }
          });
      },
      onMatched: (code) => {
        disconnectMatchmaking();
        set({ status: 'matched', matchedCode: code });
      },
      onError: () => {
        // Socket-level failure — surface as a generic network error unless we
        // already matched/enqueue-errored.
        if (get().status === 'searching') {
          set({ status: 'error', error: 'network' });
          disconnectMatchmaking();
        }
      },
    });
  },

  cancel: () => {
    disconnectMatchmaking();
    set({ status: 'idle', matchedCode: null, startedAt: null, error: null });
    // Best-effort dequeue (existence-hiding on the server; a failure is harmless).
    void apiClient.cancelMatchmaking().catch(() => {});
  },

  reset: () => {
    disconnectMatchmaking();
    set({ status: 'idle', matchedCode: null, error: null, startedAt: null });
  },
}));
