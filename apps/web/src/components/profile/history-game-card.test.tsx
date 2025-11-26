import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameHistoryItem } from '@sketchy/shared/contract/players';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { HistoryGameCard } from './history-game-card';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getPlayerGameSummary: vi.fn(),
  },
}));

const getPlayerGameSummaryMock = vi.mocked(apiClient.getPlayerGameSummary);

function renderWithClient(ui: ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(ui, { wrapper: Wrapper });
}

const FINISHED_GAME: GameHistoryItem = {
  gameId: '123e4567-e89b-12d3-a456-426614174000',
  endedAt: Date.UTC(2026, 0, 15),
  mode: 'online_private',
  roomCode: 'ABCJK',
  myRole: 'undercover',
  mySpecialRole: null,
  myPoints: 10,
  won: true,
  winnerFaction: 'undercover',
  civilianWord: 'Latte',
  undercoverWord: 'Espresso',
  playerCount: 6,
  roundsPlayed: 3,
};

const ABANDONED_GAME: GameHistoryItem = {
  ...FINISHED_GAME,
  gameId: '123e4567-e89b-12d3-a456-426614174001',
  winnerFaction: null,
  won: false,
  myPoints: 0,
};

describe('HistoryGameCard', () => {
  it('shows role, points, winner faction, and the word pair for a finished game', () => {
    renderWithClient(<HistoryGameCard item={FINISHED_GAME} />);
    // "UNDERCOVER" legitimately appears twice here — this player's role AND the winning
    // faction are both Undercover in this fixture (a realistic case: you won).
    expect(screen.getAllByText(copy.roles.undercover.cardTitle)).toHaveLength(2);
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText(copy.reveal.fullReveal.pairLine('Latte', 'Espresso'))).toBeTruthy();
  });

  it('shows the abandoned line instead of a winner faction when winnerFaction is null', () => {
    renderWithClient(<HistoryGameCard item={ABANDONED_GAME} />);
    expect(screen.getByText(copy.profile.history.abandoned)).toBeTruthy();
  });

  it('fetches and renders the round summary only after the toggle is expanded', async () => {
    getPlayerGameSummaryMock.mockResolvedValue({
      gameId: FINISHED_GAME.gameId,
      rounds: [
        {
          round: 1,
          clues: [{ playerId: 'p1', playerName: 'Priya', text: 'Warm' }],
          eliminated: { playerId: 'p3', playerName: 'Jo', role: 'civilian' },
          voteTally: [{ playerId: 'p3', playerName: 'Jo', votes: 2 }],
        },
      ],
    });

    renderWithClient(<HistoryGameCard item={FINISHED_GAME} />);
    expect(getPlayerGameSummaryMock).not.toHaveBeenCalled();
    expect(screen.queryByText(copy.profile.history.roundHeading(1))).toBeNull();

    fireEvent.click(screen.getByTestId('history-round-toggle'));

    await waitFor(() =>
      expect(getPlayerGameSummaryMock).toHaveBeenCalledWith(FINISHED_GAME.gameId),
    );
    await waitFor(() =>
      expect(screen.getByText(copy.profile.history.roundHeading(1))).toBeTruthy(),
    );
    expect(screen.getByText(copy.profile.history.voteTally('Jo', 2))).toBeTruthy();
    // Aggregate tally only — no raw voter id/name ever renders.
    expect(screen.queryByText(/p1.*→.*p3/)).toBeNull();
  });
});
