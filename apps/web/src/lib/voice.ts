import {
  ConnectionState,
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  type Participant,
} from 'livekit-client';
import { ApiError } from '@sketchy/shared/client';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { emitVoiceState } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { useVoiceStore } from '@/stores/voice-store';
import { hasVoiceOptIn, setVoiceOptIn } from './voice-opt-in';

export { hasVoiceOptIn };

/**
 * The ONE LiveKit connection module (conventions.md §1 "socket handling lives in one
 * module", applied the same way here for voice): connects, wires LiveKit's own events into
 * `voice-store`, and is the only thing that ever touches a `livekit-client` `Room` instance.
 * Components subscribe to `voice-store`, never to `livekit-client` directly.
 *
 * Module-level singleton — one voice connection per page lifetime, mirroring `lib/socket.ts`'s
 * `socket`/`currentCode` pair exactly.
 */
let room: Room | null = null;
let currentCode: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Background reconnect cadence once voice goes `'unavailable'` unexpectedly — recovers once a
 * killed LiveKit container comes back, without a page reload. Deliberately re-fetches a FRESH
 * token every attempt (`joinVoice` always does)
 * rather than relying on LiveKit's own token-reuse reconnect, so recovery doesn't depend on
 * the original token's TTL still being valid by the time the container comes back. */
const RETRY_MS = 5000;

/** How long we let LiveKit's OWN reconnect policy sit in a reconnecting state (either
 * `ConnectionState.SignalReconnecting` — the signaling websocket dropped, a lighter-weight
 * retry LiveKit resolves on its own most of the time — or the heavier `.Reconnecting`, once
 * media/ICE needs to re-negotiate too) before we give up on it and take over ourselves
 * (below). Found empirically, not guessed: a real E2E run against a KILLED LiveKit container
 * (`apps/web/e2e-online/voice.spec.ts`) showed two things naive
 * code got wrong — (1) against a server that is simply gone, LiveKit can sit signal-
 * reconnecting for well over a minute before ever escalating to `.Reconnecting`, so gating
 * only on the latter never fires at all; (2) `RoomEvent.Disconnected` (and therefore our own
 * `'unavailable'` degradation + retry loop) never fires until that internal policy exhausts
 * itself. 8s is long enough that a normal brief blip's fast "resume" reconnect isn't cut off
 * prematurely, short enough that a truly dead server surfaces "Voice unavailable" — and
 * starts OUR OWN fresh-token retry loop — within single-digit seconds instead of an
 * effectively unbounded wait. */
const RECONNECT_STUCK_MS = 8000;

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function participantDisplayName(playerId: string): string {
  const players = useRoomStore.getState().snapshot?.players ?? [];
  return players.find((p) => p.id === playerId)?.name ?? 'Someone';
}

function isPermissionDenied(error: unknown): boolean {
  return MediaDeviceFailure.getFailure(error) === MediaDeviceFailure.PermissionDenied;
}

function wireRoomEvents(r: Room, code: string): void {
  let reconnectStuckTimer: ReturnType<typeof setTimeout> | null = null;
  // Set right before WE force `r.disconnect()` from the stuck-reconnect branch below, so the
  // `Disconnected` event that call itself triggers doesn't redundantly re-run the same
  // teardown/retry logic a second time.
  let tornDownByStuckTimer = false;

  function clearReconnectStuckTimer(): void {
    if (reconnectStuckTimer !== null) {
      clearTimeout(reconnectStuckTimer);
      reconnectStuckTimer = null;
    }
  }

  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    useVoiceStore.getState().setSpeakingIds(new Set(speakers.map((p) => p.identity)));
  });

  // Local-only join/leave toasts (copy.md §4 "Voice"): driven by LiveKit's own participant
  // events, so only players who are THEMSELVES connected to voice ever see them — no
  // dedicated server event exists (or is needed) for this (game-design.md §10 "cosmetic").
  r.on(RoomEvent.ParticipantConnected, (participant: Participant) => {
    useRoomStore
      .getState()
      .pushLocalToast(
        'voiceJoined',
        copy.rooms.voice.joinedToast(participantDisplayName(participant.identity)),
      );
  });
  r.on(RoomEvent.ParticipantDisconnected, (participant: Participant) => {
    useRoomStore
      .getState()
      .pushLocalToast(
        'voiceLeft',
        copy.rooms.voice.leftToast(participantDisplayName(participant.identity)),
      );
  });

  // `ConnectionStateChanged` (not the narrower `Reconnecting`/`Reconnected`/`SignalReconnecting`
  // events individually) is the single source of truth here — see `RECONNECT_STUCK_MS`'s doc
  // comment for why: against a genuinely dead server, LiveKit can sit in
  // `ConnectionState.SignalReconnecting` for a long time before ever escalating to the
  // heavier `.Reconnecting`, so a stuck-timer gated on `RoomEvent.Reconnecting` alone never
  // fires. Both reconnecting states get the SAME "connecting" pill + the SAME stuck-timer.
  r.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
    if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
      useVoiceStore.getState().setStatus('connecting');
      // Start the stuck-timer on the FIRST reconnecting state only — subsequent re-fires
      // (LiveKit retries internally, each with its own backoff) must NOT reset the clock, or
      // it would never reach `RECONNECT_STUCK_MS` as long as attempts keep coming. We want
      // total time spent reconnecting, not time since the LAST attempt.
      if (reconnectStuckTimer === null) {
        reconnectStuckTimer = setTimeout(() => {
          tornDownByStuckTimer = true;
          if (room === r) {
            room = null;
            currentCode = null;
          }
          r.disconnect();
          useVoiceStore.getState().setStatus('unavailable');
          useVoiceStore.getState().setSpeakingIds(new Set());
          scheduleRetry(code);
        }, RECONNECT_STUCK_MS);
      }
    } else if (state === ConnectionState.Connected) {
      clearReconnectStuckTimer();
      useVoiceStore.getState().setStatus('connected');
    }
  });

  r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
    clearReconnectStuckTimer();
    if (tornDownByStuckTimer) {
      // Already fully handled by the stuck-reconnect branch above — this event is just
      // LiveKit confirming the `disconnect()` call WE made.
      return;
    }
    if (room === r) {
      room = null;
      currentCode = null;
    }
    useVoiceStore.getState().setSpeakingIds(new Set());
    if (reason === DisconnectReason.CLIENT_INITIATED) {
      // Our own leaveVoice() call — not a failure, nothing to retry.
      useVoiceStore.getState().setStatus('idle');
      return;
    }
    // Anything else (server shutdown, a network loss LiveKit's OWN reconnect couldn't
    // recover from before we gave up on it above, ...) degrades to 'unavailable' and starts
    // the background retry loop — the game itself is completely unaffected either way.
    useVoiceStore.getState().setStatus('unavailable');
    scheduleRetry(code);
  });
}

function scheduleRetry(code: string): void {
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    // Only retry if we're still supposed to be in voice for THIS room (not superseded by a
    // newer joinVoice/leaveVoice call in the meantime) and the tab is actually visible —
    // no point burning reconnect attempts against a backgrounded tab.
    if (currentCode === null && document.visibilityState !== 'hidden') {
      void joinVoice(code, { isRetry: true });
    }
  }, RETRY_MS);
}

/**
 * Joins voice for `code`: fetches a fresh LiveKit token
 * (`GET /rooms/:code/voice-token`), connects, and publishes the microphone — this is also
 * what triggers the browser's mic-permission prompt. Safe to call repeatedly; a no-op while
 * already connecting/connected to the SAME room.
 */
export async function joinVoice(code: string, options: { isRetry?: boolean } = {}): Promise<void> {
  if (room && currentCode === code) {
    return;
  }
  clearRetryTimer();
  const store = useVoiceStore.getState();
  store.setStatus('connecting');

  let tokenResponse;
  try {
    tokenResponse = await apiClient.getVoiceToken(code);
  } catch (error) {
    store.setStatus('unavailable');
    // A deliberate VOICE_ENABLED=false kill-switch isn't a transient outage — don't burn a
    // retry loop against an operator decision.
    if (!(error instanceof ApiError && error.code === 'voice_disabled')) {
      scheduleRetry(code);
    }
    return;
  }

  const r = new Room();
  wireRoomEvents(r, code);

  // The server-returned `url` is the primary, mobile-ready source of truth (api-contract.md
  // §1 — a non-Next.js client never needs its own LiveKit config at all). `NEXT_PUBLIC_LIVEKIT_URL`
  // is only a same-origin-dev fallback for the rare case the response omits it.
  const serverUrl = tokenResponse.url || process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!serverUrl) {
    useVoiceStore.getState().setStatus('unavailable');
    return;
  }

  try {
    await r.connect(serverUrl, tokenResponse.token);
    await r.localParticipant.setMicrophoneEnabled(true);
  } catch (error) {
    r.disconnect();
    if (isPermissionDenied(error)) {
      useVoiceStore.getState().setStatus('denied');
      // A denial is not "voice is broken" — no retry loop; the pill offers a manual retry.
      return;
    }
    useVoiceStore.getState().setStatus('unavailable');
    scheduleRetry(code);
    return;
  }

  room = r;
  currentCode = code;
  useVoiceStore.getState().setStatus('connected');
  useVoiceStore.getState().setMuted(false);
  if (!options.isRetry) {
    setVoiceOptIn(true);
  }
}

/** Explicit "Leave voice" — turns OFF the auto-rejoin
 * preference, since an explicit leave is a decision, not a blip. */
export function leaveVoice(): void {
  clearRetryTimer();
  setVoiceOptIn(false);
  room?.disconnect();
  room = null;
  currentCode = null;
  useVoiceStore.getState().reset();
}

/** Tears down any live voice connection WITHOUT touching the opt-in preference — used when
 * the game room itself disconnects (`disconnectFromRoom`), so a later rejoin of the SAME
 * room still auto-rejoins voice per the opted-in preference. */
export function disconnectVoice(): void {
  clearRetryTimer();
  room?.disconnect();
  room = null;
  currentCode = null;
  useVoiceStore.getState().reset();
}

/** Mic mute/unmute (game-design.md §10 "push-to-mute"; copy.md §4 `Mute`/`Unmute`): toggles
 * the LOCAL LiveKit track AND reports the new state to the server so non-voice-connected
 * viewers see it too (`voice:state`, api-contract.md §2.1). A no-op if not connected. */
export async function setVoiceMuted(muted: boolean): Promise<void> {
  if (!room) {
    return;
  }
  await room.localParticipant.setMicrophoneEnabled(!muted);
  useVoiceStore.getState().setMuted(muted);
  await emitVoiceState(muted);
}
