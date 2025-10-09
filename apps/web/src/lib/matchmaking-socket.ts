import { io, type Socket } from 'socket.io-client';
import { SERVER_EVENTS, mmMatchedSchema, type MmMatched } from '@sketchy/shared/contract/socket';
import { useSessionStore } from '@/stores/session-store';
import { getApiUrl } from './api-url';

/**
 * The quick-join matchmaking socket. Separate from the room socket
 * (`lib/socket.ts`) because matchmaking happens BEFORE the player is in any
 * game room: it connects to `/game` only to receive the server's `mm:matched`
 * push (the server auto-joins each socket to its per-player room on connect, so
 * no room-join is needed here). On a match it hands the room code back and the
 * store tears this down; the room route then opens its own room socket.
 *
 * `onConnect` fires once the handshake completes — the store enqueues ONLY
 * then, closing the race where the matcher could push `mm:matched` to a
 * personal room this socket hadn't joined yet.
 */
let socket: Socket | null = null;

function origin(): string {
  return getApiUrl().replace(/\/v1\/?$/, '');
}

export function connectMatchmaking(handlers: {
  onConnect: () => void;
  onMatched: (code: string) => void;
  onError: (message: string) => void;
}): void {
  disconnectMatchmaking();
  const token = useSessionStore.getState().token;
  const s = io(`${origin()}/game`, { auth: { token }, transports: ['websocket'] });
  socket = s;

  s.on('connect', () => handlers.onConnect());
  s.on('connect_error', (error: Error) => handlers.onError(error.message));
  s.on(SERVER_EVENTS.matched, (payload: MmMatched) => {
    const parsed = mmMatchedSchema.safeParse(payload);
    if (parsed.success) {
      handlers.onMatched(parsed.data.code);
    }
  });
}

export function disconnectMatchmaking(): void {
  socket?.disconnect();
  socket = null;
}
