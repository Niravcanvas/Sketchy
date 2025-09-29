import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { emitTimerExtend } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildFourPlayers, buildGameState, buildYouSlice } from './__fixtures__/room';
import { StatusStrip } from './status-strip';

vi.mock('@/lib/socket', () => ({
  emitTimerExtend: vi.fn(),
}));

const emitTimerExtendMock = vi.mocked(emitTimerExtend);

describe('StatusStrip', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitTimerExtendMock.mockReset();
  });

  it('during dealing, the label counts the players still to peek (not a phase name)', () => {
    const players = buildFourPlayers();
    players[0]!.hasSeenWord = true;
    players[1]!.hasSeenWord = true;
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'dealing', players }),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    render(<StatusStrip />);
    expect(screen.getByTestId('status-strip-label').textContent).toBe(
      copy.roles.dealChrome.waitingForPeek(2),
    );
  });

  it('shows the phase label per phase', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'clue', round: 2 }),
      you: buildYouSlice({ playerId: 'p1' }),
    });
    const { rerender } = render(<StatusStrip />);
    expect(screen.getByTestId('status-strip-label').textContent).toBe(
      copy.phases.status.roundClues(2),
    );

    useRoomStore.setState({ snapshot: buildGameState({ phase: 'discussion' }) });
    rerender(<StatusStrip />);
    expect(screen.getByTestId('status-strip-label').textContent).toBe(copy.phases.status.discussion);

    useRoomStore.setState({ snapshot: buildGameState({ phase: 'voting' }) });
    rerender(<StatusStrip />);
    expect(screen.getByTestId('status-strip-label').textContent).toBe(copy.phases.status.theVote);
  });

  it('renders the countdown ring only when there is a server deadline', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'clue', round: 1, phaseEndsAt: null }),
      you: buildYouSlice({ playerId: 'p1' }),
    });
    // Scoped to `svg circle` specifically (not just any `svg`): `StatusStrip` now also
    // renders the `<VoicePill>`, whose icon svgs use `path`/`rect`, not `circle` —
    // only `PopTimerRing`'s ring uses `<circle>` elements.
    const { container, rerender } = render(<StatusStrip />);
    expect(container.querySelector('svg circle')).toBeNull();

    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'clue', round: 1, phaseEndsAt: Date.now() + 60_000 }),
    });
    rerender(<StatusStrip />);
    expect(container.querySelector('svg circle')).not.toBeNull();
  });

  it('offers the +60s extend chip only to a host who has not extended yet', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'discussion', phaseEndsAt: Date.now() + 60_000 }),
      you: buildYouSlice({ playerId: 'p1', canAct: { extendTimer: true } }),
    });
    const { rerender } = render(<StatusStrip />);
    expect(screen.getByTestId('extend-timer').textContent).toBe(copy.glossary.extendTimer);

    useRoomStore.setState({ you: buildYouSlice({ playerId: 'p2', canAct: { extendTimer: false } }) });
    rerender(<StatusStrip />);
    expect(screen.queryByTestId('extend-timer')).toBeNull();
  });

  it('emits timer:extend on the chip, and surfaces a rejection inline', async () => {
    emitTimerExtendMock.mockResolvedValue({ ok: false, error: 'validation' } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'discussion', phaseEndsAt: Date.now() + 60_000 }),
      you: buildYouSlice({ playerId: 'p1', canAct: { extendTimer: true } }),
    });

    render(<StatusStrip />);
    fireEvent.click(screen.getByTestId('extend-timer'));

    await waitFor(() => expect(emitTimerExtendMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.errors.generic500));
  });
});
