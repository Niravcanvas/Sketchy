import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { emitPhaseAdvance } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildGameState, buildYouSlice } from './__fixtures__/room';
import { DiscussionScreen } from './discussion-screen';

vi.mock('@/lib/socket', () => ({
  emitPhaseAdvance: vi.fn(),
}));

const emitPhaseAdvanceMock = vi.mocked(emitPhaseAdvance);

/** Discussion phase with a round of clues already on the board — the argument happens over
 * the evidence (game-design.md §6.3). */
function buildDiscussionState() {
  return buildGameState({
    phase: 'discussion',
    round: 1,
    clues: [
      { round: 1, playerId: 'p1', text: 'Ocean', mimed: false },
      { round: 1, playerId: 'p2', text: 'Salt', mimed: false },
    ],
  });
}

describe('DiscussionScreen', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitPhaseAdvanceMock.mockReset();
  });

  it('shows the discussion banner and the clue board to everyone', () => {
    useRoomStore.setState({
      snapshot: buildDiscussionState(),
      you: buildYouSlice({ playerId: 'p2', canAct: { advancePhase: false } }),
    });

    render(<DiscussionScreen />);

    expect(screen.getByText(copy.phases.discussion.banner)).toBeTruthy();
    expect(screen.getByTestId('clue-board')).toBeTruthy();
    expect(screen.getAllByTestId('clue-note')).toHaveLength(2);
  });

  it('offers "Call the vote" only to the host (advancePhase)', () => {
    useRoomStore.setState({
      snapshot: buildDiscussionState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { advancePhase: true } }),
    });

    render(<DiscussionScreen />);
    expect(screen.getByTestId('online-call-vote').textContent).toBe(copy.phases.discussion.callTheVote);
  });

  it('never offers "Call the vote" to a non-host', () => {
    useRoomStore.setState({
      snapshot: buildDiscussionState(),
      you: buildYouSlice({ playerId: 'p2', canAct: { advancePhase: false } }),
    });

    render(<DiscussionScreen />);
    expect(screen.queryByTestId('online-call-vote')).toBeNull();
  });

  it('emits phase:advance when the host calls the vote', async () => {
    emitPhaseAdvanceMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildDiscussionState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { advancePhase: true } }),
    });

    render(<DiscussionScreen />);
    fireEvent.click(screen.getByTestId('online-call-vote'));

    await waitFor(() => expect(emitPhaseAdvanceMock).toHaveBeenCalledTimes(1));
  });

  it('renders the mapped error copy inline when phase:advance is rejected', async () => {
    emitPhaseAdvanceMock.mockResolvedValue({ ok: false, error: 'not_host' } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildDiscussionState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { advancePhase: true } }),
    });

    render(<DiscussionScreen />);
    fireEvent.click(screen.getByTestId('online-call-vote'));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(copy.errors.notHost);
    });
  });
});
