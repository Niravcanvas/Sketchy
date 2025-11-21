import { beforeEach, describe, expect, it } from 'vitest';
import { useVoiceStore } from './voice-store';

describe('voice-store', () => {
  beforeEach(() => {
    useVoiceStore.getState().reset();
    useVoiceStore.setState({ mutedRoster: {} });
  });

  it('starts idle, unmuted, with no speakers or roster', () => {
    const state = useVoiceStore.getState();
    expect(state.status).toBe('idle');
    expect(state.muted).toBe(false);
    expect(state.speakingIds.size).toBe(0);
    expect(state.mutedRoster).toEqual({});
  });

  it('setStatus updates status independently of other fields', () => {
    useVoiceStore.getState().setMuted(true);
    useVoiceStore.getState().setStatus('connected');
    expect(useVoiceStore.getState().status).toBe('connected');
    expect(useVoiceStore.getState().muted).toBe(true);
  });

  it('setSpeakingIds replaces the speaking set wholesale', () => {
    useVoiceStore.getState().setSpeakingIds(new Set(['p1', 'p2']));
    expect(useVoiceStore.getState().speakingIds).toEqual(new Set(['p1', 'p2']));
    useVoiceStore.getState().setSpeakingIds(new Set());
    expect(useVoiceStore.getState().speakingIds.size).toBe(0);
  });

  it('applyRoster replaces the mutedRoster map wholesale (full-replace mirror, not a merge)', () => {
    useVoiceStore.getState().applyRoster({ p1: true });
    expect(useVoiceStore.getState().mutedRoster).toEqual({ p1: true });
    useVoiceStore.getState().applyRoster({ p2: false });
    expect(useVoiceStore.getState().mutedRoster).toEqual({ p2: false });
  });

  it('reset clears status/muted/speakingIds but NOT mutedRoster (room-socket-driven, not voice-connection-driven)', () => {
    useVoiceStore.setState({
      status: 'connected',
      muted: true,
      speakingIds: new Set(['p1']),
      mutedRoster: { p1: true },
    });
    useVoiceStore.getState().reset();
    const state = useVoiceStore.getState();
    expect(state.status).toBe('idle');
    expect(state.muted).toBe(false);
    expect(state.speakingIds.size).toBe(0);
    expect(state.mutedRoster).toEqual({ p1: true });
  });
});
