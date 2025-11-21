import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '@/copy';
import { useRoomStore } from '@/stores/room-store';
import { useVoiceStore } from '@/stores/voice-store';
import { buildGameState, buildYouSlice } from './game/__fixtures__/room';
import { VoicePill } from './voice-pill';

const joinVoice = vi.fn();
const leaveVoice = vi.fn();
const setVoiceMuted = vi.fn();

vi.mock('@/lib/voice', () => ({
  joinVoice: (code: string) => joinVoice(code),
  leaveVoice: () => leaveVoice(),
  setVoiceMuted: (muted: boolean) => setVoiceMuted(muted),
}));

describe('VoicePill', () => {
  beforeEach(() => {
    joinVoice.mockReset().mockResolvedValue(undefined);
    leaveVoice.mockReset();
    setVoiceMuted.mockReset().mockResolvedValue(undefined);
    useRoomStore.getState().reset();
    useVoiceStore.getState().reset();
    useVoiceStore.setState({ mutedRoster: {} });
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'lobby' }),
      you: buildYouSlice({ playerId: 'p1' }),
    });
  });

  it('renders nothing without a room code', () => {
    useRoomStore.setState({ snapshot: buildGameState({ phase: 'lobby', code: null }) });
    render(<VoicePill />);
    expect(screen.queryByTestId('voice-pill')).toBeNull();
  });

  it('idle: shows the exact "Join voice" label and joins on click', () => {
    render(<VoicePill />);
    const button = screen.getByTestId('voice-join');
    expect(button.textContent).toContain(copy.rooms.voice.pill.idle);

    fireEvent.click(button);
    expect(joinVoice).toHaveBeenCalledWith('ABCJK');
  });

  it('connecting: the join button is disabled', () => {
    useVoiceStore.setState({ status: 'connecting' });
    render(<VoicePill />);
    expect((screen.getByTestId('voice-join') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('voice-join').textContent).toContain(copy.rooms.voice.pill.connecting);
  });

  it('denied: shows the mic-blocked label + graceful copy, and stays clickable to retry', () => {
    useVoiceStore.setState({ status: 'denied' });
    render(<VoicePill />);
    const button = screen.getByTestId('voice-join') as HTMLButtonElement;
    expect(button.textContent).toContain(copy.rooms.voice.pill.denied);
    expect(button.disabled).toBe(false);
    expect(screen.getByText(copy.rooms.voice.micDenied)).toBeTruthy();
  });

  it('unavailable: shows the degradation copy and stays clickable to retry', () => {
    useVoiceStore.setState({ status: 'unavailable' });
    render(<VoicePill />);
    const button = screen.getByTestId('voice-join') as HTMLButtonElement;
    expect(button.textContent).toContain(copy.rooms.voice.pill.unavailable);
    expect(button.disabled).toBe(false);
    expect(screen.getByText(copy.rooms.voice.unavailableHint)).toBeTruthy();
  });

  it('connected: shows mute/leave controls and the iOS tooltip trigger', () => {
    useVoiceStore.setState({ status: 'connected', muted: false });
    render(<VoicePill />);
    expect(screen.getByText(copy.rooms.voice.pill.connected)).toBeTruthy();
    expect(screen.getByTestId('voice-mute-toggle').getAttribute('aria-label')).toBe(
      copy.rooms.voice.mute,
    );
    expect(screen.getByTestId('voice-ios-tooltip')).toBeTruthy();

    fireEvent.click(screen.getByTestId('voice-mute-toggle'));
    expect(setVoiceMuted).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('voice-leave'));
    expect(leaveVoice).toHaveBeenCalledTimes(1);
  });

  it('connected + muted: the mute toggle offers Unmute', () => {
    useVoiceStore.setState({ status: 'connected', muted: true });
    render(<VoicePill />);
    expect(screen.getByTestId('voice-mute-toggle').getAttribute('aria-label')).toBe(
      copy.rooms.voice.unmute,
    );

    fireEvent.click(screen.getByTestId('voice-mute-toggle'));
    expect(setVoiceMuted).toHaveBeenCalledWith(false);
  });
});
