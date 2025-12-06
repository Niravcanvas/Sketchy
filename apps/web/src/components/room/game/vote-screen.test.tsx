import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { emitVoteCast } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildFourPlayers, buildGameState, buildPlayer, buildYouSlice } from './__fixtures__/room';
import { OnlineVoteScreen } from './vote-screen';

vi.mock('@/lib/socket', () => ({
  emitVoteCast: vi.fn(),
}));

const emitVoteCastMock = vi.mocked(emitVoteCast);

function buildVotingState(overrides = {}) {
  return buildGameState({
    phase: 'voting',
    round: 1,
    phaseEndsAt: 1_000,
    votedIds: ['p2'],
    clues: [{ round: 1, playerId: 'p1', text: 'Ocean', mimed: false }],
    ...overrides,
  });
}

describe('OnlineVoteScreen', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitVoteCastMock.mockReset();
  });

  it('renders a suspect card per alive player, with the viewer disabled + tooltip', () => {
    useRoomStore.setState({
      snapshot: buildVotingState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { vote: true } }),
    });

    render(<OnlineVoteScreen />);
    const targets = screen.getAllByTestId('online-vote-target');
    expect(targets).toHaveLength(4);

    const self = targets.find((t) => t.getAttribute('data-name') === 'Priya');
    expect((self as HTMLButtonElement).disabled).toBe(true);
    expect(self?.getAttribute('title')).toBe(copy.phases.voting.selfVoteTooltip);
  });

  it('shows the public "{k}/{n} voted" count, never who→whom', () => {
    useRoomStore.setState({
      snapshot: buildVotingState({ votedIds: ['p2', 'p3'] }),
      you: buildYouSlice({ playerId: 'p1', canAct: { vote: true } }),
    });

    render(<OnlineVoteScreen />);
    expect(screen.getByTestId('online-vote-progress').textContent).toBe(
      copy.phases.voting.progress(2, 4),
    );
  });

  it('casts the selected ballot on "Lock it in"', async () => {
    emitVoteCastMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildVotingState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { vote: true } }),
    });

    render(<OnlineVoteScreen />);
    fireEvent.click(
      screen.getByTestId('online-vote-screen').querySelector('[data-name="Sam"]') as HTMLElement,
    );
    fireEvent.click(screen.getByTestId('online-vote-confirm'));

    await waitFor(() => expect(emitVoteCastMock).toHaveBeenCalledWith('p2'));
  });

  it('limits the grid to the tied players during a sudden-death re-vote', () => {
    useRoomStore.setState({
      snapshot: buildVotingState({ revoteCount: 1, tiedPlayerIds: ['p2', 'p3'] }),
      you: buildYouSlice({ playerId: 'p1', canAct: { vote: true } }),
    });

    render(<OnlineVoteScreen />);
    const names = screen
      .getAllByTestId('online-vote-target')
      .map((t) => t.getAttribute('data-name'))
      .sort();
    expect(names).toEqual(['Jo', 'Sam']);
  });

  it('gives an eliminated spectator the count but no ballot grid', () => {
    const players = buildFourPlayers();
    players[0] = buildPlayer({ id: 'p1', name: 'Priya', seat: 0, alive: false, role: 'civilian', eliminatedRound: 1 });
    useRoomStore.setState({
      snapshot: buildVotingState({ players, votedIds: [] }),
      you: buildYouSlice({ playerId: 'p1', canAct: { vote: false } }),
    });

    render(<OnlineVoteScreen />);
    expect(screen.queryByTestId('online-vote-target')).toBeNull();
    // The count reflects the 3 remaining alive players.
    expect(screen.getByTestId('online-vote-progress').textContent).toBe(
      copy.phases.voting.progress(0, 3),
    );
  });

  it('surfaces the mapped error copy when a ballot is rejected', async () => {
    emitVoteCastMock.mockResolvedValue({ ok: false, error: 'already_voted' } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildVotingState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { vote: true } }),
    });

    render(<OnlineVoteScreen />);
    fireEvent.click(
      screen.getByTestId('online-vote-screen').querySelector('[data-name="Sam"]') as HTMLElement,
    );
    fireEvent.click(screen.getByTestId('online-vote-confirm'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(copy.errors.alreadyVoted);
    });
  });

  it('shows the "ballot in, still changeable" line once a ballot is cast', () => {
    useRoomStore.setState({
      snapshot: buildVotingState(),
      you: buildYouSlice({ playerId: 'p1', canAct: { vote: true }, yourVote: 'p2' }),
    });

    render(<OnlineVoteScreen />);
    expect(screen.getByTestId('online-ballot-cast').textContent).toBe(copy.phases.voting.ballotCast);
  });
});
