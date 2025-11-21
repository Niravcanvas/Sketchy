import { ApiError } from '@sketchy/shared/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomStore } from '@/stores/room-store';
import { useVoiceStore } from '@/stores/voice-store';

const getVoiceToken = vi.fn();
const emitVoiceState = vi.fn();

// Mocked BEFORE the module under test imports it (vitest hoists vi.mock calls) — a real
// `Room` would try real WebRTC/getUserMedia, neither of which exist in jsdom.
const roomInstances: MockRoom[] = [];

class MockRoom {
  /** Set by a test right before calling `joinVoice()` to make THIS NEXT instance's mic
   * publish reject (simulating a getUserMedia denial) — consumed once, then cleared. */
  static nextMicRejection: unknown = null;

  handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  connect = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn();
  localParticipant = { setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined) };

  constructor() {
    if (MockRoom.nextMicRejection) {
      const rejection = MockRoom.nextMicRejection;
      MockRoom.nextMicRejection = null;
      this.localParticipant.setMicrophoneEnabled = vi.fn().mockRejectedValueOnce(rejection);
    }
    roomInstances.push(this);
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  return { ...actual, Room: MockRoom };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: { getVoiceToken: (code: string) => getVoiceToken(code) },
}));

vi.mock('@/lib/socket', () => ({
  emitVoiceState: (muted: boolean) => emitVoiceState(muted),
}));

// A single static import: `lib/voice.ts` keeps its live connection (`room`/`currentCode`) as
// module-private state (mirrors `lib/socket.ts`'s `socket`/`currentCode` singleton pattern),
// so every test in this file shares the SAME module instance — cleaned up via `leaveVoice()`
// in `afterEach` (the module's own public teardown path) rather than `vi.resetModules()`,
// which would instantiate a SECOND, disconnected `voice-store` module graph and silently
// desync from the `useVoiceStore` reference imported above.
const { joinVoice, leaveVoice, setVoiceMuted, hasVoiceOptIn } = await import('./voice');
const { DisconnectReason } = await import('livekit-client');

describe('lib/voice', () => {
  beforeEach(() => {
    getVoiceToken.mockReset();
    emitVoiceState.mockReset().mockResolvedValue({ ok: true });
    roomInstances.length = 0;
    MockRoom.nextMicRejection = null;
    window.localStorage.clear();
    useVoiceStore.getState().reset();
    useVoiceStore.setState({ mutedRoster: {} });
    useRoomStore.getState().reset();
  });

  afterEach(() => {
    leaveVoice();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('joinVoice: connects, publishes the mic, and lands on connected + opted-in', async () => {
    getVoiceToken.mockResolvedValueOnce({ token: 'jwt', url: 'ws://localhost:7880' });

    await joinVoice('ABCJK');

    expect(getVoiceToken).toHaveBeenCalledWith('ABCJK');
    expect(roomInstances).toHaveLength(1);
    expect(roomInstances[0]!.connect).toHaveBeenCalledWith('ws://localhost:7880', 'jwt');
    expect(roomInstances[0]!.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(useVoiceStore.getState().status).toBe('connected');
    expect(useVoiceStore.getState().muted).toBe(false);
    expect(hasVoiceOptIn()).toBe(true);
  });

  it('joinVoice: a token-fetch failure degrades to unavailable and schedules a retry', async () => {
    vi.useFakeTimers();
    getVoiceToken.mockRejectedValueOnce(new Error('network down'));
    getVoiceToken.mockResolvedValueOnce({ token: 'jwt', url: 'ws://localhost:7880' });

    await joinVoice('ABCJK');
    expect(useVoiceStore.getState().status).toBe('unavailable');
    expect(getVoiceToken).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5100);
    expect(getVoiceToken).toHaveBeenCalledTimes(2);
    expect(useVoiceStore.getState().status).toBe('connected');
  });

  it('joinVoice: a voice_disabled kill-switch error does NOT schedule a retry', async () => {
    vi.useFakeTimers();
    getVoiceToken.mockRejectedValueOnce(new ApiError(403, 'voice_disabled', 'off'));

    await joinVoice('ABCJK');
    expect(useVoiceStore.getState().status).toBe('unavailable');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(getVoiceToken).toHaveBeenCalledTimes(1);
  });

  it('joinVoice: a mic-permission denial lands on denied (never blocking the game), no retry scheduled', async () => {
    vi.useFakeTimers();
    getVoiceToken.mockResolvedValue({ token: 'jwt', url: 'ws://localhost:7880' });
    MockRoom.nextMicRejection = Object.assign(new Error('denied'), { name: 'NotAllowedError' });

    await joinVoice('ABCJK');

    expect(useVoiceStore.getState().status).toBe('denied');
    expect(roomInstances[0]!.disconnect).toHaveBeenCalledTimes(1);
    // A denial is not an opt-in, and must not schedule the unavailable-retry loop.
    expect(hasVoiceOptIn()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getVoiceToken).toHaveBeenCalledTimes(1);
  });

  it('leaveVoice: disconnects, resets the store, and clears the opt-in preference', async () => {
    getVoiceToken.mockResolvedValueOnce({ token: 'jwt', url: 'ws://localhost:7880' });

    await joinVoice('ABCJK');
    expect(hasVoiceOptIn()).toBe(true);

    leaveVoice();

    expect(roomInstances[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().status).toBe('idle');
    expect(hasVoiceOptIn()).toBe(false);
  });

  it('setVoiceMuted: toggles the local mic track and reports the state over the socket', async () => {
    getVoiceToken.mockResolvedValueOnce({ token: 'jwt', url: 'ws://localhost:7880' });
    await joinVoice('ABCJK');

    await setVoiceMuted(true);

    expect(roomInstances[0]!.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(useVoiceStore.getState().muted).toBe(true);
    expect(emitVoiceState).toHaveBeenCalledWith(true);
  });

  it('a CLIENT_INITIATED disconnect event lands on idle; any other reason lands on unavailable', async () => {
    getVoiceToken.mockResolvedValue({ token: 'jwt', url: 'ws://localhost:7880' });
    await joinVoice('ABCJK');

    roomInstances[0]!.emit('disconnected', DisconnectReason.SERVER_SHUTDOWN);
    expect(useVoiceStore.getState().status).toBe('unavailable');
  });
});
