import { create } from 'zustand';
import type { RedactedGameState } from '@sketchy/engine/redact-for';
import type { ErrorCode } from '@sketchy/shared/contract/errors';
import type {
  ChatMessage,
  RoomEvent,
  RoomSnapshot,
  YouSlice,
} from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';

/**
 * Room-side connection lifecycle (conventions.md §1 — `room-store` holds the latest
 * snapshot + `you` slice; `lib/socket.ts` is the only writer). `'idle'` is the state before
 * `connectToRoom()` has ever been called; `'reconnecting'` covers a socket.io auto-reconnect
 * attempt in flight; `'superseded'` is terminal for this tab (api-contract.md §2
 * `session:superseded` — no auto-reconnect after it).
 */
export type RoomConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'superseded';

/** A transient, non-state toast derived from a `room:event` (game-design.md §8) — OR a
 * purely client-derived announcement (the Judge tie toast; the Grudge
 * drag-down toast and the Mime round toast; `voiceJoined`/`voiceLeft` — fired by
 * `lib/voice.ts` off LiveKit's own `ParticipantConnected`/`ParticipantDisconnected` events,
 * so only players ALREADY connected to voice ever see them, copy.md §4 "Voice") — all fired
 * locally off a state transition rather than a dedicated server event — see
 * `pushLocalToast`). */
export interface RoomToast {
  id: string;
  type: RoomEvent['type'] | 'judgeTiebreak' | 'grudgeDecision' | 'mimeRound' | 'voiceJoined' | 'voiceLeft';
  text: string;
}

/** Chat history cap (game-design.md §3.4 badges unread — the log itself is bounded so a
 * long-running lobby/game doesn't grow the store unbounded; chat is ephemeral by design
 * anyway, api-contract.md §2.2 "not replayed on resync"). */
const CHAT_HISTORY_CAP = 200;

/**
 * Maps a server `room:event` to its copy.md §8 display line (game-design.md §3.2/§8).
 * `viewerId` disambiguates `kicked`, which reads differently for the kicked player
 * themselves ("The host removed you...") than for everyone else watching it happen ("{name}
 * was shown the door."). Exported standalone so `room-store.test.ts` can assert the mapping
 * directly, and so `lib/socket.ts` never needs its own copy of this switch.
 */
export function roomEventText(event: RoomEvent, viewerId: string | null): string {
  switch (event.type) {
    case 'playerJoined':
      return copy.presence.playerJoined(event.name);
    case 'playerLeft':
      return copy.presence.playerLeft(event.name);
    case 'playerDisconnected':
      return copy.presence.playerDisconnected(event.name);
    case 'playerReconnected':
      return copy.presence.playerReconnected(event.name);
    case 'hostChanged':
      return copy.presence.hostChanged(event.name);
    case 'kicked':
      return event.playerId === viewerId
        ? copy.presence.kickedSelf
        : copy.presence.kickedOthers(event.name);
    case 'timerExtended':
      return copy.presence.timerExtended;
    default: {
      // Exhaustiveness guard: fails to compile if `RoomEvent`'s discriminated union ever
      // grows a variant this switch doesn't handle (mirrors the pattern the contract's own
      // `roomEventSchema` doc comment calls out — "exhaustively checked").
      const exhaustiveCheck: never = event;
      return exhaustiveCheck;
    }
  }
}

export interface RoomState {
  snapshot: RedactedGameState | null;
  you: YouSlice | null;
  ver: number;
  status: RoomConnectionStatus;
  joinError: ErrorCode | null;
  chat: ChatMessage[];
  events: RoomToast[];
  unreadChat: number;
  /** UI sets this true while the chat drawer is open (game-design.md §3.4) — while true,
   * `appendChat` stops incrementing `unreadChat`. */
  chatOpen: boolean;
  /** Estimated server-minus-client clock offset in ms (api-contract.md §2.3 rule 3): added
   * to `Date.now()` so countdowns render from the SERVER's clock, not the local one. Measured
   * once per socket connection via `time:ping` (`lib/socket.ts`); `0` until the first
   * measurement lands, which just means the very first render trusts the local clock. */
  clockOffsetMs: number;

  /** api-contract.md §2.3 rule 1: any snapshot with `ver` <= the current `ver` is discarded
   * (out-of-order delivery / a stale resync racing a fresher push). */
  applySnapshot: (snapshot: RoomSnapshot) => void;
  setStatus: (status: RoomConnectionStatus) => void;
  setJoinError: (error: ErrorCode | null) => void;
  /** Records a fresh `time:ping` measurement (`lib/socket.ts`, one per connection). */
  setClockOffsetMs: (offsetMs: number) => void;
  /** Appends a transient toast for a `room:event`. Never touches `snapshot`/`ver` — events
   * are presentation-only (game-design.md §8), not part of state sync. */
  pushEvent: (event: RoomEvent) => void;
  /** A purely CLIENT-derived toast (the Judge tie announcement) — there is no
   * dedicated server `room:event` for this (it's fully derivable from the snapshot's own
   * phase transition), so this bypasses `roomEventText` and takes pre-rendered `text`
   * directly. Never touches `snapshot`/`ver`, same as `pushEvent`. */
  pushLocalToast: (type: RoomToast['type'], text: string) => void;
  /** Removes a toast once the UI (`toasts.tsx`) has auto-dismissed it. */
  dismissEvent: (id: string) => void;
  appendChat: (message: ChatMessage) => void;
  setChatOpen: (open: boolean) => void;
  /** Resets every field to its initial value (route unmount / leaving a room). */
  reset: () => void;
}

function initialState(): Omit<
  RoomState,
  | 'applySnapshot'
  | 'setStatus'
  | 'setJoinError'
  | 'setClockOffsetMs'
  | 'pushEvent'
  | 'pushLocalToast'
  | 'dismissEvent'
  | 'appendChat'
  | 'setChatOpen'
  | 'reset'
> {
  return {
    snapshot: null,
    you: null,
    ver: 0,
    status: 'idle',
    joinError: null,
    chat: [],
    events: [],
    unreadChat: 0,
    chatOpen: false,
    clockOffsetMs: 0,
  };
}

export const useRoomStore = create<RoomState>((set, get) => ({
  ...initialState(),

  applySnapshot: (snapshot) => {
    if (snapshot.ver <= get().ver) {
      return;
    }
    set({ snapshot: snapshot.state, you: snapshot.you, ver: snapshot.ver });
  },

  setStatus: (status) => set({ status }),

  setJoinError: (error) => set({ joinError: error }),

  setClockOffsetMs: (offsetMs) => set({ clockOffsetMs: offsetMs }),

  pushEvent: (event) => {
    const text = roomEventText(event, get().you?.playerId ?? null);
    const toast: RoomToast = { id: crypto.randomUUID(), type: event.type, text };
    set({ events: [...get().events, toast] });
  },

  pushLocalToast: (type, text) => {
    const toast: RoomToast = { id: crypto.randomUUID(), type, text };
    set({ events: [...get().events, toast] });
  },

  dismissEvent: (id) => {
    set({ events: get().events.filter((toast) => toast.id !== id) });
  },

  appendChat: (message) => {
    const nextChat = [...get().chat, message];
    const capped =
      nextChat.length > CHAT_HISTORY_CAP
        ? nextChat.slice(nextChat.length - CHAT_HISTORY_CAP)
        : nextChat;
    const chatOpen = get().chatOpen;
    set({ chat: capped, unreadChat: chatOpen ? get().unreadChat : get().unreadChat + 1 });
  },

  setChatOpen: (open) => {
    set({ chatOpen: open, unreadChat: open ? 0 : get().unreadChat });
  },

  reset: () => set(initialState()),
}));
