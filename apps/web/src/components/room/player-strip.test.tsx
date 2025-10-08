import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '@/copy';
import { useRoomStore } from '@/stores/room-store';
import { useVoiceStore } from '@/stores/voice-store';
import { buildFourPlayers, buildGameState, buildPlayer, buildYouSlice } from './game/__fixtures__/room';
import { PlayerStrip } from './player-strip';

vi.mock('@/lib/socket', () => ({
  emitKick: vi.fn(),
}));

function cardFor(name: string): HTMLElement {
  const card = screen
    .getAllByTestId('player-card')
    .find((el) => el.getAttribute('data-player-name') === name);
  if (!card) {
    throw new Error(`no player card for ${name}`);
  }
  return card;
}

describe('PlayerStrip — phase 7 states', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    useVoiceStore.getState().reset();
    useVoiceStore.setState({ mutedRoster: {} });
  });

  it('flips an eliminated player to the OUT row with their revealed role tag', () => {
    const players = buildFourPlayers();
    players[3] = buildPlayer({
      id: 'p4',
      name: 'Alex',
      seat: 3,
      alive: false,
      role: 'undercover',
      eliminatedRound: 1,
    });
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'reveal', pendingElimination: 'p4', players }),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    render(<PlayerStrip />);
    expect(cardFor('Alex').getAttribute('data-eliminated')).toBe('true');
    expect(
      screen.getByText(copy.reveal.outTag(copy.roles.undercover.cardTitle)),
    ).toBeTruthy();
  });

  it('badges players who have voted during the vote (never who they voted for)', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'voting', votedIds: ['p2'] }),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    render(<PlayerStrip />);
    expect(cardFor('Sam').getAttribute('data-voted')).toBe('true');
    expect(cardFor('Priya').getAttribute('data-voted')).toBe('false');
    expect(screen.getAllByTestId('has-voted')).toHaveLength(1);
  });

  it('phase 15: shows a speaking ring only for players LiveKit reports as speaking', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'discussion' }),
      you: buildYouSlice({ playerId: 'p1' }),
    });
    useVoiceStore.setState({ speakingIds: new Set(['p2']) });

    render(<PlayerStrip />);
    expect(cardFor('Sam').getAttribute('data-voice-speaking')).toBe('true');
    expect(cardFor('Priya').getAttribute('data-voice-speaking')).toBe('false');
  });

  it('phase 15: mirrors the muted roster onto player cards regardless of viewer voice status', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'discussion' }),
      you: buildYouSlice({ playerId: 'p1' }),
    });
    useVoiceStore.setState({ mutedRoster: { p3: true, p4: false } });

    render(<PlayerStrip />);
    expect(cardFor('Jo').getAttribute('data-voice-muted')).toBe('true');
    expect(cardFor('Alex').getAttribute('data-voice-muted')).toBe('false');
    expect(cardFor('Priya').getAttribute('data-voice-muted')).toBe('false');
    expect(screen.getAllByTestId('voice-muted-badge')).toHaveLength(1);
  });
});
