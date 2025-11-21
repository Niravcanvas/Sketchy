import { create } from 'zustand';

/**
 * Voice connection lifecycle (conventions.md §1 — one zustand store per domain, mirroring
 * `room-store`'s relationship with `lib/socket.ts`). `lib/voice.ts` is the ONLY writer;
 * components (the status-strip pill, the player-strip speaking ring/mute badge) subscribe
 * here, never touch `livekit-client` directly (game-design.md §10).
 *
 * - `'idle'`: never joined, or explicitly left voice.
 * - `'connecting'`: awaiting the token fetch + LiveKit `connect()` + mic permission, OR a
 *   LiveKit-driven reconnect in flight after a transient blip.
 * - `'connected'`: live in the LiveKit room, mic published (possibly self-muted).
 * - `'denied'`: the browser's mic permission prompt was declined — the game is NOT blocked;
 *   the pill offers a retry.
 * - `'unavailable'`: the voice server is unreachable / token mint failed / an unexpected
 *   LiveKit disconnect — `lib/voice.ts` retries in the background; the game is NOT blocked.
 */
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'denied' | 'unavailable';

export interface VoiceState {
  status: VoiceStatus;
  /** This device's own mic mute state (independent of `mutedRoster` below, which mirrors
   * EVERY player's mute state including this one — kept separate because `muted` must be
   * settable optimistically the instant the local toggle is pressed, before the
   * `voice:state` ack/roster round-trip lands). */
  muted: boolean;
  /** LiveKit `Participant.identity` (== playerId, api-contract.md §1) of everyone LiveKit
   * currently reports as speaking. Only ever non-empty while `status === 'connected'` — a
   * player who isn't themselves in voice never receives LiveKit's audio-level events
   * (game-design.md §10 "only clients actually connected to LiveKit see it — acceptable"). */
  speakingIds: Set<string>;
  /** The `voice:state` → `voice:roster` mirror (api-contract.md §2.2) — every player who has
   * EVER sent `voice:state` this room-session, keyed by playerId. Visible to every seated
   * player regardless of their OWN voice connection status; written by `lib/socket.ts`'s
   * `voice:roster` listener, not by `lib/voice.ts`. */
  mutedRoster: Record<string, boolean>;

  setStatus: (status: VoiceStatus) => void;
  setMuted: (muted: boolean) => void;
  setSpeakingIds: (ids: Set<string>) => void;
  applyRoster: (roster: Record<string, boolean>) => void;
  /** Full reset (leaving voice, or leaving the room entirely) — does NOT touch
   * `mutedRoster`, which is room-socket-driven and resets on its own via `room-store`'s
   * `reset()` timing (a fresh `room:join` always re-delivers the current roster). */
  reset: () => void;
}

function initialState(): Pick<VoiceState, 'status' | 'muted' | 'speakingIds' | 'mutedRoster'> {
  return { status: 'idle', muted: false, speakingIds: new Set(), mutedRoster: {} };
}

export const useVoiceStore = create<VoiceState>((set) => ({
  ...initialState(),

  setStatus: (status) => set({ status }),
  setMuted: (muted) => set({ muted }),
  setSpeakingIds: (speakingIds) => set({ speakingIds }),
  applyRoster: (mutedRoster) => set({ mutedRoster }),
  reset: () => set({ status: 'idle', muted: false, speakingIds: new Set() }),
}));
