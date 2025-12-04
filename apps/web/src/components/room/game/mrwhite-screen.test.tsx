import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAck } from '@sketchy/shared/contract/socket';
import { copy } from '@/copy';
import { emitMrWhiteGuess } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { buildGameState, buildYouSlice } from './__fixtures__/room';
import { OnlineMrWhiteScreen } from './mrwhite-screen';

vi.mock('@/lib/socket', () => ({
  emitMrWhiteGuess: vi.fn(),
}));

const emitMrWhiteGuessMock = vi.mocked(emitMrWhiteGuess);

function buildGuessState() {
  return buildGameState({
    phase: 'mrwhite_guess',
    round: 1,
    phaseEndsAt: 30_000,
    pendingElimination: 'p3',
  });
}

describe('OnlineMrWhiteScreen', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
    emitMrWhiteGuessMock.mockReset();
  });

  it('gives the just-eliminated Mr. White the one-shot guess input', () => {
    useRoomStore.setState({
      snapshot: buildGuessState(),
      you: buildYouSlice({ playerId: 'p3', role: 'mrwhite' }),
    });

    render(<OnlineMrWhiteScreen />);
    expect(screen.getByTestId('online-mrwhite-screen')).toBeTruthy();
    expect(screen.getByTestId('online-mrwhite-input')).toBeTruthy();
    expect(screen.queryByTestId('online-mrwhite-waiting')).toBeNull();
  });

  it('shows everyone else the "hold your breath" watch screen', () => {
    useRoomStore.setState({
      snapshot: buildGuessState(),
      you: buildYouSlice({ playerId: 'p1' }),
    });

    render(<OnlineMrWhiteScreen />);
    expect(screen.getByTestId('online-mrwhite-waiting').textContent).toBe(
      copy.reveal.mrWhiteGuess.othersWaiting,
    );
    expect(screen.queryByTestId('online-mrwhite-input')).toBeNull();
  });

  it('submits the trimmed guess word', async () => {
    emitMrWhiteGuessMock.mockResolvedValue({ ok: true } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildGuessState(),
      you: buildYouSlice({ playerId: 'p3', role: 'mrwhite' }),
    });

    render(<OnlineMrWhiteScreen />);
    fireEvent.change(screen.getByTestId('online-mrwhite-input'), {
      target: { value: '  Espresso  ' },
    });
    fireEvent.click(screen.getByTestId('online-mrwhite-submit'));

    await waitFor(() => expect(emitMrWhiteGuessMock).toHaveBeenCalledWith('Espresso'));
  });

  it('maps a rejected guess to inline error copy', async () => {
    emitMrWhiteGuessMock.mockResolvedValue({ ok: false, error: 'wrong_phase' } satisfies BasicAck);
    useRoomStore.setState({
      snapshot: buildGuessState(),
      you: buildYouSlice({ playerId: 'p3', role: 'mrwhite' }),
    });

    render(<OnlineMrWhiteScreen />);
    fireEvent.change(screen.getByTestId('online-mrwhite-input'), { target: { value: 'Latte' } });
    fireEvent.click(screen.getByTestId('online-mrwhite-submit'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.errors.wrongPhase));
  });
});
