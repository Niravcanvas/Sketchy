import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy';
import { useRoomStore } from '@/stores/room-store';
import { buildGameState } from './__fixtures__/room';
import { GuessInterlude } from './guess-interlude';

describe('GuessInterlude', () => {
  beforeEach(() => {
    useRoomStore.getState().reset();
  });

  it('flashes the wrong-guess laugh from the public lastGuess', () => {
    useRoomStore.setState({
      snapshot: buildGameState({
        phase: 'clue',
        round: 2,
        lastGuess: { playerId: 'p3', text: 'Latte', correct: false },
      }),
    });

    render(<GuessInterlude />);
    expect(screen.getByTestId('online-guess-wrong').textContent).toBe(copy.reveal.guessWrong('Latte'));
  });

  it('stays silent for a correct guess (that is the win screen headline)', () => {
    useRoomStore.setState({
      snapshot: buildGameState({
        phase: 'game_over',
        lastGuess: { playerId: 'p3', text: 'Latte', correct: true },
      }),
    });

    render(<GuessInterlude />);
    expect(screen.queryByTestId('online-guess-wrong')).toBeNull();
  });

  it('renders nothing when there is no guess yet', () => {
    useRoomStore.setState({ snapshot: buildGameState({ phase: 'voting' }) });
    render(<GuessInterlude />);
    expect(screen.queryByTestId('online-guess-wrong')).toBeNull();
  });
});
