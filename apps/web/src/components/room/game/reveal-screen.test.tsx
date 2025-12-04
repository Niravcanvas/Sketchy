import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { emitPhaseAdvance } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildFourPlayers, buildGameState, buildPlayer, buildYouSlice } from './__fixtures__/room';
import { OnlineRevealScreen } from './reveal-screen';

vi.mock('@/lib/socket', () => ({
  emitPhaseAdvance: vi.fn(),
}));

const emitPhaseAdvanceMock = vi.mocked(emitPhaseAdvance);

/** Round 1's vote eliminated Alex (seat 3), revealed Undercover. */
function buildRevealState(overrides = {}) {
  const players = buildFourPlayers();
  players[3] = buildPlayer({
    id: 'p4',
    name: 'Alex',
    seat: 3,
    alive: false,
    role: 'undercover',
    eliminatedRound: 1,
  });
  return buildGameState({
    phase: 'reveal',
    round: 1,
    phaseEndsAt: 8_000,
    pendingElimination: 'p4',
    players,
    ...overrides,
  });
}

describe('OnlineRevealScreen', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitPhaseAdvanceMock.mockReset();
  });

  it('reveals the eliminated player and their now-public role', () => {
    useRoomStore.setState({
      snapshot: buildRevealState(),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    render(<OnlineRevealScreen />);
    const screenEl = screen.getByTestId('online-reveal-screen');
    expect(screenEl.getAttribute('data-player-name')).toBe('Alex');
    expect(screenEl.getAttribute('data-role')).toBe('undercover');
    expect(screen.getByText(copy.reveal.buildup.playerIsOut('Alex'))).toBeTruthy();
    expect(screen.getByText(copy.reveal.roleReveal.undercover('Alex'))).toBeTruthy();
  });

  it('lets only the host dismiss the reveal early (phase:advance)', async () => {
    emitPhaseAdvanceMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildRevealState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { advancePhase: true } }),
    });

    render(<OnlineRevealScreen />);
    fireEvent.click(screen.getByTestId('online-reveal-continue'));
    await waitFor(() => expect(emitPhaseAdvanceMock).toHaveBeenCalledTimes(1));
  });

  it('never shows the dismiss button to a non-host', () => {
    useRoomStore.setState({
      snapshot: buildRevealState(),
      you: buildYouSlice({ playerId: 'p2', canAct: { advancePhase: false } }),
    });

    render(<OnlineRevealScreen />);
    expect(screen.queryByTestId('online-reveal-continue')).toBeNull();
  });

  it('shows the eliminated word only when settings reveal it', () => {
    const players = buildFourPlayers();
    players[3] = buildPlayer({
      id: 'p4',
      name: 'Alex',
      seat: 3,
      alive: false,
      role: 'undercover',
      word: 'Espresso',
      eliminatedRound: 1,
    });
    useRoomStore.setState({
      snapshot: buildRevealState({ players }),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    render(<OnlineRevealScreen />);
    expect(screen.getByText('Espresso')).toBeTruthy();
  });
});
