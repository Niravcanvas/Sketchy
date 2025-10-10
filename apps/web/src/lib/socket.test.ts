import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomStore } from '@/stores/room-store';

/**
 * Focused coverage of `connect_error` handling in `lib/socket.ts` — specifically that a
 * moderation-`suspended` handshake reaches a TERMINAL state and stops socket.io's
 * auto-reconnect (the bug: a suspended player otherwise saw an infinite "reconnecting…"
 * loop with no message). Mirrors `lib/voice.test.ts`'s approach: `socket.io-client` is mocked
 * so no real network dial happens, and the module-private singleton is torn down between
 * tests via the module's own `disconnectFromRoom()`.
 */

// Captured so a test can drive the handlers `connectToRoom` registers.
const forgetActiveRoom = vi.fn();
const rememberActiveRoom = vi.fn();

class MockSocket {
  handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  emit = vi.fn();
  disconnect = vi.fn();
  connected = false;

  on(event: string, handler: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  /** Fires whatever `connectToRoom` wired up for `event` — the test's stand-in for the server
   * (or socket.io internals) pushing that event at the client. */
  trigger(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

let lastSocket: MockSocket;
const ioMock = vi.fn(() => {
  lastSocket = new MockSocket();
  return lastSocket;
});

vi.mock('socket.io-client', () => ({
  // Args (origin/auth/transports) are irrelevant to what's under test — the handler wiring.
  io: () => ioMock(),
}));

vi.mock('./active-room', () => ({
  forgetActiveRoom: () => forgetActiveRoom(),
  rememberActiveRoom: (code: string) => rememberActiveRoom(code),
}));

vi.mock('./api-url', () => ({
  getApiUrl: () => 'http://localhost:4000/v1',
}));

// Single static import so every test shares the SAME module-private `socket` singleton
// (same rationale as voice.test.ts) — reset via the module's public `disconnectFromRoom()`.
const { connectToRoom, disconnectFromRoom } = await import('./socket');

describe('lib/socket connect_error', () => {
  beforeEach(() => {
    ioMock.mockClear();
    forgetActiveRoom.mockClear();
    rememberActiveRoom.mockClear();
    useRoomStore.getState().reset();
  });

  afterEach(() => {
    disconnectFromRoom();
  });

  it('surfaces `suspended` and stops auto-reconnect on a suspended handshake', () => {
    connectToRoom('ABCD');
    // The `/game` handshake rejects a suspended player with `new Error('suspended')`.
    lastSocket.trigger('connect_error', new Error('suspended'));

    expect(useRoomStore.getState().joinError).toBe('suspended');
    // `s.disconnect()` is what kills socket.io's auto-reconnect — without it the banner spins
    // forever. `forgetActiveRoom()` stops the rejoin nag for a room we can never re-enter.
    expect(lastSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(forgetActiveRoom).toHaveBeenCalledTimes(1);
  });

  it('surfaces `unauthorized` WITHOUT disconnecting (a stale token is recoverable)', () => {
    connectToRoom('ABCD');
    lastSocket.trigger('connect_error', new Error('unauthorized'));

    expect(useRoomStore.getState().joinError).toBe('unauthorized');
    expect(lastSocket.disconnect).not.toHaveBeenCalled();
    expect(forgetActiveRoom).not.toHaveBeenCalled();
  });
});
