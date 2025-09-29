import { io, type Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type BasicAck,
  type ChatMessage,
  type JoinAck,
  type LobbySettingsPayload,
  type RoomEvent,
  type RoomSnapshot,
  type SyncAck,
  type TimePingAck,
  type VoiceRoster,
} from '@sketchy/shared/contract/socket';
import type { ErrorCode } from '@sketchy/shared/contract/errors';
import { useRoomStore } from '@/stores/room-store';
import { useSessionStore } from '@/stores/session-store';
import { useVoiceStore } from '@/stores/voice-store';
import { forgetActiveRoom, rememberActiveRoom } from './active-room';
import { getApiUrl } from './api-url';

/**
 * The ONE socket module (conventions.md §1): connects, resyncs on reconnect/visibility, and
 * writes every server push straight into `room-store`. Every other file in the app —
 * components included — subscribes to `room-store`, never to this socket directly; the only
 * things exported here are lifecycle functions (`connectToRoom`/`disconnectFromRoom`) and
 * thin promise-wrapped action emitters.
 *
 * Module-level singleton (one socket per page lifetime, per the room route being the only
 * place that ever calls `connectToRoom`). EVERY server connect — first or auto-reconnect —
 * re-emits `room:join`: server-side a reconnect is a brand-new connection with no room
 * binding, and the join handler already treats a seated player as a pure rejoin, so joining
 * is idempotent while `room:sync` alone would be rejected (and would not survive an API
 * restart). `room:sync` is only the mid-connection gap-fill (visibility regain, §2.3).
 */
let socket: Socket | null = null;
let currentCode: string | null = null;
let visibilityHandlerAttached = false;

/** The `/game` namespace origin, derived from the same `PUBLIC_API_URL` config
 * `api-url.ts`'s `getApiUrl()` reads — that helper appends the REST `/v1` prefix
 * (api-contract.md §0), which the socket namespace path doesn't want, so it's stripped back
 * off here rather than re-reading the env var a second way. */
function socketOrigin(): string {
  return getApiUrl().replace(/\/v1\/?$/, '');
}

function isUnauthorizedConnectError(error: Error): boolean {
  return error.message.toLowerCase().includes('unauthorized');
}

/** The `/game` handshake rejects a moderation-suspended player with `new Error('suspended')`
 * (sockets/index.ts), the sanitized code the server also returns from `requireAuth`. */
function isSuspendedConnectError(error: Error): boolean {
  return error.message.toLowerCase().includes('suspended');
}

/** `room:sync` (api-contract.md §2.1/§2.3 rule 2) — full-state resync on reconnect or
 * visibility regain. A no-op if there's no live socket (nothing to sync yet). */
function emitRoomSync(): void {
  if (!socket) {
    return;
  }
  const lastVer = useRoomStore.getState().ver;
  socket.emit(CLIENT_EVENTS.roomSync, { lastVer }, (ack: SyncAck) => {
    if (ack.ok) {
      useRoomStore.getState().applySnapshot(ack.snapshot);
    }
  });
}

/**
 * `time:ping` (api-contract.md §2.3 rule 3): one clock-offset measurement per CONNECTION,
 * fired alongside the connect handler's `room:join`. `offset = serverNow - (sentAt +
 * rtt/2)` estimates "how far ahead the server's clock is" assuming a symmetric round trip
 * — good enough for a countdown ring, not a sync protocol. Stored in `room-store` so every
 * countdown component (`use-clock-offset.ts`) reads the same measurement rather than each
 * computing (and racing) its own.
 */
function measureClockOffset(s: Socket): void {
  const sentAt = Date.now();
  s.emit(CLIENT_EVENTS.timePing, {}, (ack: TimePingAck) => {
    if (!ack.ok) {
      return;
    }
    const rtt = Date.now() - sentAt;
    const offset = ack.serverNow - (sentAt + rtt / 2);
    useRoomStore.getState().setClockOffsetMs(offset);
  });
}

/** api-contract.md §2.3 rule 2: "On visibility regain (mobile web tab wake): emit
 * `room:sync`." */
function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && socket?.connected) {
    emitRoomSync();
  }
}

/**
 * Connects to room `code`'s `/game` namespace socket, wiring every handler the room route
 * needs (game-design.md §8 resilience behaviors). Safe to call repeatedly with the same code
 * (e.g. React effect re-entry) — a no-op once already connected/connecting to it; calling
 * with a different code tears down the previous connection first.
 */
export function connectToRoom(code: string): void {
  if (socket && currentCode === code) {
    return;
  }
  disconnectFromRoom();
  currentCode = code;

  const roomStore = useRoomStore.getState();
  roomStore.reset();
  roomStore.setStatus('connecting');

  const token = useSessionStore.getState().token;
  const s = io(`${socketOrigin()}/game`, {
    auth: { token },
    transports: ['websocket'],
  });
  socket = s;

  s.on('connect', () => {
    // EVERY connect — first or reconnect — must `room:join`: a socket.io reconnect is a
    // brand-new connection server-side (fresh socket id, empty socket.data), so the server
    // has no room binding for it and `room:sync` would be rejected. The join handler
    // already treats a seated player as a rejoin (rebind + presence, no engine `join`),
    // which also makes this survive a full API restart: the room state lives in Redis, the
    // socket binding does not (Verify: "kill the API process mid-lobby... nobody re-joins
    // manually"). `room:sync` remains the mid-connection gap-fill (visibility regain).
    s.emit(CLIENT_EVENTS.roomJoin, { code }, (ack: JoinAck) => {
      if (ack.ok) {
        useRoomStore.getState().applySnapshot(ack.snapshot);
        useRoomStore.getState().setStatus('connected');
        // Remember this seat so a later site entry can offer to rejoin (§8).
        rememberActiveRoom(code);
      } else {
        useRoomStore.getState().setJoinError(ack.error);
        // A join we can never recover (room gone, in-progress, kicked) must not
        // keep nagging us to rejoin it.
        if (ack.error !== 'unauthorized') forgetActiveRoom();
      }
    });
    measureClockOffset(s);
  });

  s.on('disconnect', () => {
    // socket.io auto-reconnects on its own; this only reflects that state in the store
    // (game-design.md §8 "the you experience of a blip is: a thin reconnecting banner").
    if (useRoomStore.getState().status !== 'superseded') {
      useRoomStore.getState().setStatus('reconnecting');
    }
  });

  s.on('connect_error', (error: Error) => {
    // A suspended handshake is TERMINAL for this connection (mirrors the `kicked` precedent
    // below): the server rejects every retry with the same `suspended` code, so leaving
    // socket.io's auto-reconnect running would just spin an infinite "reconnecting…" banner
    // with no visible reason. Surface the sanitized suspended copy, stop offering to rejoin,
    // and `s.disconnect()` to kill auto-reconnect — checked before `unauthorized` since a
    // suspended player is authenticated, just barred.
    if (isSuspendedConnectError(error)) {
      useRoomStore.getState().setJoinError('suspended');
      forgetActiveRoom();
      s.disconnect();
      return;
    }
    if (isUnauthorizedConnectError(error)) {
      useRoomStore.getState().setJoinError('unauthorized');
    }
  });

  s.on(SERVER_EVENTS.roomSnapshot, (payload: RoomSnapshot) => {
    useRoomStore.getState().applySnapshot(payload);
  });

  s.on(SERVER_EVENTS.roomEvent, (payload: RoomEvent) => {
    const store = useRoomStore.getState();
    // Being kicked is TERMINAL for this connection: without disconnecting here,
    // the auto-reconnect `room:join` above would re-seat the kicked player on the
    // next blip or API restart (the lobby join handler can't tell a kicked player
    // from a fresh joiner).
    if (payload.type === 'kicked' && payload.playerId === store.you?.playerId) {
      store.setJoinError('kicked');
      forgetActiveRoom();
      s.disconnect();
      return;
    }
    store.pushEvent(payload);
  });

  s.on(SERVER_EVENTS.chatMessage, (payload: ChatMessage) => {
    useRoomStore.getState().appendChat(payload);
  });

  s.on(SERVER_EVENTS.sessionSuperseded, () => {
    useRoomStore.getState().setStatus('superseded');
    // A newer connection for the same player has taken over — this tab must NOT
    // auto-reconnect (api-contract.md §2 `session:superseded`).
    s.disconnect();
  });

  // `voice:roster` (api-contract.md §2.2): the mute mirror — delivered both as a
  // full-room broadcast on any change AND once, straight to this socket, right after
  // `room:join`/rejoin (sockets/lobby.ts `bindSocketToRoom`). Lives in `voice-store`, not
  // `room-store` — it's cosmetic to the engine and must never ride `room:snapshot`.
  s.on(SERVER_EVENTS.voiceRoster, (payload: VoiceRoster) => {
    useVoiceStore.getState().applyRoster(payload.muted);
  });

  if (typeof document !== 'undefined' && !visibilityHandlerAttached) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    visibilityHandlerAttached = true;
  }
}

/** Tears down the current room connection (route unmount). Idempotent. */
export function disconnectFromRoom(): void {
  if (typeof document !== 'undefined' && visibilityHandlerAttached) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    visibilityHandlerAttached = false;
  }
  socket?.disconnect();
  socket = null;
  currentCode = null;
}

/** Every client→server event resolves an ack rather than throwing — `{ ok: false, error }`
 * is a normal, handleable outcome (api-contract.md §2), so callers branch on `.ok` instead
 * of try/catch. No live socket resolves `{ ok: false, error: 'internal' }` defensively (this
 * should never happen in practice — every emitter below is only ever called once the room
 * route has already reached `status: 'connected'`). */
function emitWithAck<TPayload extends object, TAck extends BasicAck>(
  event: string,
  payload: TPayload,
): Promise<TAck> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve({ ok: false, error: 'internal' as ErrorCode } as TAck);
      return;
    }
    socket.emit(event, payload, (ack: TAck) => resolve(ack));
  });
}

export function emitReady(ready: boolean): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.lobbyReady, { ready });
}

export function emitSettings(patch: LobbySettingsPayload): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.lobbySettings, patch);
}

export function emitKick(playerId: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.lobbyKick, { playerId });
}

export function emitChat(text: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.chatSend, { text });
}

export function emitLeave(): Promise<BasicAck> {
  // An explicit leave is a decision to abandon the seat — stop offering to rejoin it.
  forgetActiveRoom();
  return emitWithAck(CLIENT_EVENTS.roomLeave, {});
}

/** `host:transfer` (api-contract.md §2.1) — host hands the pencil to another
 * seated player (game-design.md §8 manual hand-back). Server enforces host-only. */
export function emitHostTransfer(targetId: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.hostTransfer, { targetId });
}

/** `game:start` (api-contract.md §2.1) — host only; engine validates min players + role math. */
export function emitStartGame(): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.gameStart, {});
}

/** `deal:ack` (api-contract.md §2.1) — "I've seen my word." */
export function emitDealAck(): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.dealAck, {});
}

/** `clue:submit` (api-contract.md §2.1) — turn-holder only; server validates phase/turn/
 * length/secret-word/repeat/profanity. */
export function emitClueSubmit(text: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.clueSubmit, { text });
}

/** `turn:skip` (api-contract.md §2.1) — host-only stalled-turn escape hatch. */
export function emitTurnSkip(): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.turnSkip, {});
}

/** `phase:advance` (api-contract.md §2.1) — host only; ends discussion early or dismisses
 * reveal. */
export function emitPhaseAdvance(): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.phaseAdvance, {});
}

/** `timer:extend` (api-contract.md §2.1) — host's once-per-phase +60s. */
export function emitTimerExtend(): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.timerExtend, {});
}

/** `vote:cast` (api-contract.md §2.1) — one ballot per alive player, changeable until the
 * vote closes; the engine owns every tally/tie rule and self/target validation. */
export function emitVoteCast(targetId: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.voteCast, { targetId });
}

/** `mrwhite:guess` (api-contract.md §2.1) — the just-eliminated Mr. White's single steal
 * attempt; matching is case/diacritic-insensitive server-side. */
export function emitMrWhiteGuess(word: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.mrWhiteGuess, { word });
}

/** `game:rematch` (api-contract.md §2.1) — host only, from `game_over`: same seats/settings,
 * fresh (de-duped) pair, scoreboard carried over. */
export function emitRematch(): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.gameRematch, {});
}

/** `special:judge` (api-contract.md §2.1) — the Judge special role's
 * tie-breaking call; Judge-only, `judge_decision` phase only, server-enforced. */
export function emitSpecialJudge(targetId: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.specialJudge, { targetId });
}

/** `special:grudge` (api-contract.md §2.1) — the Grudge special role's drag-down
 * choice; Grudge-only, `grudge_decision` phase only, server-enforced. */
export function emitSpecialGrudge(targetId: string): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.specialGrudge, { targetId });
}

/** `voice:state` (api-contract.md §2.1) — mirrors this device's own LiveKit mute
 * state so non-voice-connected viewers see it too (`lib/voice.ts` is the only caller). */
export function emitVoiceState(muted: boolean): Promise<BasicAck> {
  return emitWithAck(CLIENT_EVENTS.voiceState, { muted });
}
