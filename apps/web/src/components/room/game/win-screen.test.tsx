import { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { emitLeave, emitRematch } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildGameState, buildPlayer, buildYouSlice } from './__fixtures__/room';
import { OnlineWinScreen } from './win-screen';

vi.mock('@/lib/socket', () => ({
  emitRematch: vi.fn(),
  emitLeave: vi.fn(),
}));

// `OnlineWinScreen` fetches lifetime stats via `apiClient.getPlayerStats`
// — mock the whole module (same shape as the real `ApiClient`) so these tests never
// hit the network; most tests don't care about its result (the lifetime chip is additive UI),
// but it must resolve to SOMETHING or the query stays pending forever and React Query logs
// noise.
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getPlayerStats: vi.fn(),
  },
}));

const emitRematchMock = vi.mocked(emitRematch);
const emitLeaveMock = vi.mocked(emitLeave);
const getPlayerStatsMock = vi.mocked(apiClient.getPlayerStats);

/** Wraps a render in a fresh `QueryClientProvider` (conventions.md §1 — TanStack Query for
 * server-cache state) — `retry: false` so a rejected mock fails the query immediately instead
 * of retrying into the test's timeout budget. */
function renderWithClient(ui: ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(ui, { wrapper: Wrapper });
}

/** A finished game the Civilians won — roles/words/pair are all public at game_over. */
function buildCivilianWinState(overrides = {}) {
  return buildGameState({
    phase: 'game_over',
    round: 2,
    winnerFaction: 'civilian',
    pair: { civilianWord: 'Latte', undercoverWord: 'Espresso', pairId: 'pair-1' },
    scoreboard: { p1: 2, p2: 2 },
    players: [
      buildPlayer({ id: 'p1', name: 'Priya', seat: 0, role: 'civilian', word: 'Latte' }),
      buildPlayer({ id: 'p2', name: 'Sam', seat: 1, role: 'civilian', word: 'Latte' }),
      buildPlayer({
        id: 'p3',
        name: 'Jo',
        seat: 2,
        role: 'undercover',
        word: 'Espresso',
        alive: false,
        eliminatedRound: 1,
      }),
      buildPlayer({
        id: 'p4',
        name: 'Alex',
        seat: 3,
        role: 'mrwhite',
        word: null,
        alive: false,
        eliminatedRound: 2,
      }),
    ],
    ...overrides,
  });
}

describe('OnlineWinScreen', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitRematchMock.mockReset();
    emitLeaveMock.mockReset();
    getPlayerStatsMock.mockReset();
    getPlayerStatsMock.mockResolvedValue({
      totalPoints: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      byRole: {
        civilian: { played: 0, won: 0, points: 0 },
        undercover: { played: 0, won: 0, points: 0 },
        mrwhite: { played: 0, won: 0, points: 0 },
      },
    });
  });

  it('takes over full-bleed for the winning faction with the case-closed headline', () => {
    useRoomStore.setState({
      snapshot: buildCivilianWinState(),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    renderWithClient(<OnlineWinScreen />);
    expect(screen.getByTestId('online-win-screen').getAttribute('data-faction')).toBe('civilian');
    expect(screen.getByText(copy.reveal.winScreens.civilians.headline)).toBeTruthy();
    expect(screen.getByText(copy.reveal.fullReveal.pairLine('Latte', 'Espresso'))).toBeTruthy();
  });

  it('shows the session scoreboard with this-game 2/6/10 deltas', () => {
    useRoomStore.setState({
      snapshot: buildCivilianWinState(),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    renderWithClient(<OnlineWinScreen />);
    const rows = screen.getAllByTestId('online-scoreboard-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute('data-points')).toBe('2');
      expect(row.getAttribute('data-delta')).toBe('2');
    }
  });

  it('offers the host a rematch and everyone a leave-room exit', async () => {
    emitRematchMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildCivilianWinState(),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    renderWithClient(<OnlineWinScreen />);
    fireEvent.click(screen.getByTestId('online-rematch'));
    await waitFor(() => expect(emitRematchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('online-leave-room')).toBeTruthy();
  });

  it('shows a non-host the "waiting for host" state, not a rematch button', async () => {
    emitLeaveMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildCivilianWinState(),
      you: buildYouSlice({ playerId: 'p2' }),
    });

    renderWithClient(<OnlineWinScreen />);
    expect(screen.queryByTestId('online-rematch')).toBeNull();
    expect(screen.getByTestId('online-waiting-host').textContent).toBe(
      copy.reveal.endCTAs.waitingForHost('Priya'),
    );

    fireEvent.click(screen.getByTestId('online-leave-room'));
    await waitFor(() => expect(emitLeaveMock).toHaveBeenCalledTimes(1));
  });

  it('headlines the Mr. White steal with the stolen word', () => {
    useRoomStore.setState({
      snapshot: buildCivilianWinState({
        winnerFaction: 'mrwhite',
        scoreboard: { p4: 6 },
        lastGuess: { playerId: 'p4', text: 'Latte', correct: true },
      }),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    renderWithClient(<OnlineWinScreen />);
    expect(screen.getByText(copy.reveal.guessRight('Latte'))).toBeTruthy();
    const row = screen.getByTestId('online-scoreboard-row');
    expect(row.getAttribute('data-points')).toBe('6');
    expect(row.getAttribute('data-delta')).toBe('6');
  });

  it('shows the lifetime scrapbook chip once GET /players/me/stats resolves', async () => {
    getPlayerStatsMock.mockResolvedValue({
      totalPoints: 42,
      gamesPlayed: 10,
      gamesWon: 4,
      byRole: {
        civilian: { played: 4, won: 2, points: 4 },
        undercover: { played: 3, won: 1, points: 10 },
        mrwhite: { played: 3, won: 1, points: 6 },
      },
    });
    useRoomStore.setState({
      snapshot: buildCivilianWinState(),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    vi.useFakeTimers();
    try {
      renderWithClient(<OnlineWinScreen />);
      // The chip is intentionally delayed (win-screen.tsx's `LIFETIME_STATS_FETCH_DELAY_MS`)
      // to give the server's fire-and-forget persist write a head start — see that file's
      // doc comment on the constant for why.
      expect(screen.queryByTestId('lifetime-scrapbook-chip')).toBeNull();
      await vi.advanceTimersByTimeAsync(1200);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(getPlayerStatsMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('lifetime-scrapbook-chip').textContent).toBe(
        copy.reveal.scoreboard.lifetimeChip(42),
      ),
    );
  });

  it("shows tonight's standings ranked by points, with the top scorer marked MVP", () => {
    useRoomStore.setState({
      snapshot: buildCivilianWinState({ scoreboard: { p1: 8, p2: 2 } }),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    renderWithClient(<OnlineWinScreen />);
    const panel = screen.getByTestId('standings-panel');
    expect(panel.textContent).toContain(copy.profile.standings.title);
    expect(panel.textContent).toContain(copy.profile.standings.mvpLabel);
    // Priya (p1, 8 pts) outranks Sam (p2, 2 pts) — MVP badge lands on Priya's row, not Sam's.
    const priyaIndex = panel.textContent!.indexOf('Priya');
    const mvpIndex = panel.textContent!.indexOf(copy.profile.standings.mvpLabel);
    const samIndex = panel.textContent!.indexOf('Sam');
    expect(priyaIndex).toBeLessThan(mvpIndex);
    expect(mvpIndex).toBeLessThan(samIndex);
  });
});
