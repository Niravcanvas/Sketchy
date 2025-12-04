import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { copy } from '../../copy';
import { bundledPairPool } from '@/lib/pair-pool';
import { currentRitualPlayer, usePnpStore } from '@/stores/pnp-store';
import { PnpPeekCard } from './peek-card';

/** Fresh lobby, 5 players, explicit role counts (guarantees exactly one Mr. White), the
 * deal ritual under way, first player already past the "That's me" pass gate — the state
 * `PnpPeekCard` assumes it's mounted into (game-design.md §4.2; the router owns the gate). */
function setUpDealingGame(): void {
  usePnpStore.getState().initLobby();
  for (let i = 0; i < 5; i++) usePnpStore.getState().addPlayer(`Player${i}`);
  usePnpStore.getState().setRoleCounts({ undercoverCount: 1, mrWhiteCount: 1 });
  usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
  usePnpStore.getState().confirmPass();
}

beforeEach(() => {
  window.localStorage.clear();
  setUpDealingGame();
});

describe('PnpPeekCard', () => {
  it('is face-down by default: no data-role/data-word attributes, no word text', () => {
    render(<PnpPeekCard />);
    const card = screen.getByTestId('pnp-peek-card');

    expect(card.hasAttribute('data-role')).toBe(false);
    expect(card.hasAttribute('data-word')).toBe(false);
    expect(screen.getByText(copy.roles.dealChrome.pressAndHold)).toBeTruthy();
  });

  it('pointerdown reveals the card; pointerup hides it again', () => {
    render(<PnpPeekCard />);
    const card = screen.getByTestId('pnp-peek-card');

    fireEvent.pointerDown(card);
    expect(card.hasAttribute('data-role')).toBe(true);

    fireEvent.pointerUp(card);
    expect(card.hasAttribute('data-role')).toBe(false);
    expect(card.hasAttribute('data-word')).toBe(false);
  });

  it('the a11y toggle button reveals the card and flips its own label', () => {
    render(<PnpPeekCard />);
    const toggle = screen.getByTestId('pnp-peek-toggle');

    expect(toggle.textContent).toContain(copy.pnp.peekA11y.show);

    fireEvent.click(toggle);
    expect(toggle.textContent).toContain(copy.pnp.peekA11y.hide);
    expect(screen.getByTestId('pnp-peek-card').hasAttribute('data-role')).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.textContent).toContain(copy.pnp.peekA11y.show);
    expect(screen.getByTestId('pnp-peek-card').hasAttribute('data-role')).toBe(false);
  });

  it("shows Mister White's blank line and an empty data-word when the ritual player is Mr. White", () => {
    // Ack (spoken-mode: setPeeking isn't required to ack) through the pass-around until the
    // ritual reaches whoever the engine dealt Mr. White — guaranteed to exist and to be
    // reached before the ritual ends, since setUpDealingGame() fixed mrWhiteCount: 1.
    let player = currentRitualPlayer(usePnpStore.getState().game!);
    while (player && player.role !== 'mrwhite') {
      usePnpStore.getState().ackCurrent();
      usePnpStore.getState().confirmPass();
      player = currentRitualPlayer(usePnpStore.getState().game!);
    }
    expect(player?.role).toBe('mrwhite');

    render(<PnpPeekCard />);
    const card = screen.getByTestId('pnp-peek-card');
    fireEvent.pointerDown(card);

    expect(card.getAttribute('data-role')).toBe('mrwhite');
    expect(card.getAttribute('data-word')).toBe('');
    expect(screen.getByText(copy.roles.mrWhite.blankLine)).toBeTruthy();
  });

  it('ack advances the ritual to the next player', () => {
    const first = currentRitualPlayer(usePnpStore.getState().game!);
    render(<PnpPeekCard />);

    fireEvent.click(screen.getByTestId('pnp-ack'));

    const next = currentRitualPlayer(usePnpStore.getState().game!);
    expect(next?.id).not.toBe(first?.id);
  });
});
