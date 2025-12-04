import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { emitDealAck } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildGameState, buildPlayer, buildYouSlice } from './__fixtures__/room';
import { DealScreen } from './deal-screen';

vi.mock('@/lib/socket', () => ({
  emitDealAck: vi.fn(),
}));

const emitDealAckMock = vi.mocked(emitDealAck);

describe('DealScreen', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitDealAckMock.mockReset();
  });

  it('reveals role/word from the `you` slice only while peeking (press-and-hold), and hides them on release', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'dealing' }),
      you: buildYouSlice({ playerId: 'p1', role: 'civilian', word: 'Ocean' }),
    });

    render(<DealScreen />);
    const card = screen.getByTestId('online-deal-card');

    // Not revealed at rest.
    expect(card.getAttribute('data-role')).toBeNull();
    expect(card.getAttribute('data-word')).toBeNull();
    expect(screen.queryByText('Ocean')).toBeNull();

    fireEvent.pointerDown(card);
    expect(card.getAttribute('data-role')).toBe('civilian');
    expect(card.getAttribute('data-word')).toBe('Ocean');
    expect(screen.getByText('Ocean')).toBeTruthy();
    expect(screen.getByText(copy.roles.civilian.cardTitle)).toBeTruthy();

    fireEvent.pointerUp(card);
    expect(card.getAttribute('data-role')).toBeNull();
    expect(card.getAttribute('data-word')).toBeNull();
  });

  it('the a11y toggle reveals the same data as press-and-hold, including Mister White\'s blank word', () => {
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'dealing' }),
      you: buildYouSlice({ playerId: 'p1', role: 'mrwhite', word: null }),
    });

    render(<DealScreen />);
    const toggle = screen.getByTestId('online-peek-toggle');
    const card = screen.getByTestId('online-deal-card');

    expect(toggle.textContent).toContain(copy.pnp.peekA11y.show);
    fireEvent.click(toggle);

    expect(card.getAttribute('data-role')).toBe('mrwhite');
    // Mr. White's word is null — the redacted marker attribute is present but empty, same
    // convention as pnp-peek-card's data-word.
    expect(card.getAttribute('data-word')).toBe('');
    expect(screen.getByText(copy.roles.mrWhite.blankLine)).toBeTruthy();
    expect(toggle.textContent).toContain(copy.pnp.peekA11y.hide);

    fireEvent.click(toggle);
    expect(card.getAttribute('data-role')).toBeNull();
  });

  it('"Got it" calls emitDealAck and then shows the acked (disabled) state', async () => {
    emitDealAckMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildGameState({
        phase: 'dealing',
        players: [buildPlayer({ id: 'p1', name: 'Priya', hasSeenWord: false })],
      }),
      you: buildYouSlice({ playerId: 'p1', role: 'civilian', word: 'Ocean' }),
    });

    render(<DealScreen />);
    const ackButton = screen.getByTestId('online-deal-ack') as HTMLButtonElement;
    expect(ackButton.disabled).toBe(false);

    fireEvent.click(ackButton);

    expect(emitDealAckMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ackButton.disabled).toBe(true));

    // The toggle keeps working after ack (game-design.md §6.1 — "you.role stays peekable
    // until phase changes").
    const toggle = screen.getByTestId('online-peek-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('online-deal-card').getAttribute('data-role')).toBe('civilian');
  });

  it('shows the mapped error copy when the ack is rejected', async () => {
    emitDealAckMock.mockResolvedValue({ ok: false, error: 'wrong_phase' } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildGameState({ phase: 'dealing' }),
      you: buildYouSlice({ playerId: 'p1', role: 'civilian', word: 'Ocean' }),
    });

    render(<DealScreen />);
    fireEvent.click(screen.getByTestId('online-deal-ack'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.errors.wrongPhase));
    // A rejected ack must NOT show the acked state — the player can still retry.
    expect((screen.getByTestId('online-deal-ack') as HTMLButtonElement).disabled).toBe(false);
  });
});
