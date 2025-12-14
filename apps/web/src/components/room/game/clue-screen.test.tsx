import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { emitClueSubmit, emitTurnSkip } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildGameState, buildYouSlice } from './__fixtures__/room';
import { ClueScreen } from './clue-screen';

vi.mock('@/lib/socket', () => ({
  emitClueSubmit: vi.fn(),
  emitTurnSkip: vi.fn(),
}));

const emitClueSubmitMock = vi.mocked(emitClueSubmit);
const emitTurnSkipMock = vi.mocked(emitTurnSkip);

/** `turnSeat: 1` in seat-ordered `clue` phase → Sam (seat 1) holds the floor; Priya is host
 * (seat 0) but NOT the turn-holder in this fixture, so both "host skips someone else" and
 * "non-holder sees the thinking line" read off the same state. */
function buildClueState() {
  return buildGameState({ phase: 'clue', round: 1, turnSeat: 1, hostId: 'p1' });
}

describe('ClueScreen', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitClueSubmitMock.mockReset();
    emitTurnSkipMock.mockReset();
  });

  it('shows the clue input + pin button to the turn-holder', () => {
    useRoomStore.setState({
      snapshot: buildClueState(),
      you: buildYouSlice({ playerId: 'p2', canAct: { submitClue: true } }),
    });

    render(<ClueScreen />);

    expect(screen.getByTestId('online-clue-input')).toBeTruthy();
    expect(screen.getByTestId('online-pin-clue')).toBeTruthy();
    expect(screen.queryByTestId('online-thinking')).toBeNull();
  });

  it('shows "{name} is thinking…" to everyone else, naming the actual turn-holder', () => {
    useRoomStore.setState({
      snapshot: buildClueState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { submitClue: false } }),
    });

    render(<ClueScreen />);

    const thinking = screen.getByTestId('online-thinking');
    expect(thinking.getAttribute('data-player-name')).toBe('Sam');
    expect(thinking.textContent).toBe(copy.phases.clue.thinking('Sam'));
    expect(screen.queryByTestId('online-clue-input')).toBeNull();
  });

  it('renders the mapped error copy inline when clue:submit is rejected', async () => {
    emitClueSubmitMock.mockResolvedValue({ ok: false, error: 'clue_repeated' } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildClueState(),
      you: buildYouSlice({ playerId: 'p2', canAct: { submitClue: true } }),
    });

    render(<ClueScreen />);
    fireEvent.change(screen.getByTestId('online-clue-input'), { target: { value: 'ocean' } });
    fireEvent.click(screen.getByTestId('online-pin-clue'));

    await waitFor(() =>
      expect(screen.getByTestId('online-clue-error').textContent).toBe(copy.errors.clueRepeated),
    );
    expect(emitClueSubmitMock).toHaveBeenCalledWith('ocean');
  });

  it('lets the host skip someone else\'s turn via the confirm dialog', async () => {
    emitTurnSkipMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildClueState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { submitClue: false } }),
    });

    render(<ClueScreen />);

    fireEvent.click(screen.getByTestId('online-skip-turn'));
    expect(screen.getByText(copy.phases.clue.skipConfirm('Sam'))).toBeTruthy();

    fireEvent.click(screen.getByTestId('online-skip-confirm'));
    await waitFor(() => expect(emitTurnSkipMock).toHaveBeenCalledTimes(1));
  });

  it('never offers the skip button to a non-host', () => {
    useRoomStore.setState({
      snapshot: buildClueState(),
      you: buildYouSlice({ playerId: 'p3', canAct: { submitClue: false } }),
    });

    render(<ClueScreen />);
    expect(screen.queryByTestId('online-skip-turn')).toBeNull();
  });

  it('never offers the skip button to the host on their OWN turn', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'clue', round: 1, turnSeat: 0, hostId: 'p1' }),
      you: buildYouSlice({ playerId: 'p1', canAct: { submitClue: true } }),
    });

    render(<ClueScreen />);
    expect(screen.queryByTestId('online-skip-turn')).toBeNull();
  });
});
