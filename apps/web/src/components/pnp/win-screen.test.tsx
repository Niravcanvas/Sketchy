import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePlayer } from '@sketchy/engine/types';
import { copy } from '../../copy';
import { bundledPairPool } from '@/lib/pair-pool';
import { currentRitualPlayer, currentVoter, usePnpStore } from '@/stores/pnp-store';
import { PnpWinScreen } from './win-screen';

/**
 * Drives the REAL pnp-store through a full 3-player game to `game_over`, eliminating the
 * lone Undercover on round 1 so Civilians win immediately (checkWin.ts priority 1: no
 * Undercover/Mr. White alive). Reads raw roles directly off the store — a test-only escape
 * hatch to script correct ballots; components under test never do this (they only ever see
 * `redactFor(...)`).
 */
function driveToCivilianWin(): {
  civilianNames: string[];
  civilianWord: string;
  undercoverWord: string;
} {
  const store = usePnpStore.getState();
  store.initLobby();
  store.addPlayer('Alice');
  store.addPlayer('Bo');
  store.addPlayer('Cara');
  store.startGame(bundledPairPool(['easy', 'medium', 'hard']));

  // Deal ritual: ack every seated player in turn (spoken-clue P&P never needs `confirmPass`
  // — `ackCurrent` dispatches for whoever `currentRitualPlayer` derives next).
  let ritualPlayer = currentRitualPlayer(usePnpStore.getState().game!);
  while (ritualPlayer) {
    usePnpStore.getState().ackCurrent();
    ritualPlayer = currentRitualPlayer(usePnpStore.getState().game!);
  }

  const dealt = usePnpStore.getState().game!;
  const players = dealt.players as GamePlayer[];
  const undercover = players.find((p) => p.role === 'undercover') as GamePlayer;
  const civilians = players.filter((p) => p.role === 'civilian');

  // Spoken-clue mode (typedClues off by default): every alive player's turn advances via
  // `nextSpeaker` until the round auto-transitions clue -> discussion.
  for (let i = 0; i < players.length; i++) {
    usePnpStore.getState().nextSpeaker();
  }
  usePnpStore.getState().callVote();

  // Secret-ballot pass-around: both Civilians vote out the Undercover; the Undercover casts
  // a harmless vote for a Civilian (can't self-vote) — plurality still eliminates them 2-1.
  let voter = currentVoter(usePnpStore.getState().game!);
  while (voter) {
    const target = voter.id === undercover.id ? (civilians[0] as GamePlayer).id : undercover.id;
    usePnpStore.getState().confirmVotePass();
    usePnpStore.getState().selectTarget(target);
    usePnpStore.getState().castBallot();
    voter = currentVoter(usePnpStore.getState().game!);
  }

  // voting -> reveal (Undercover eliminated). continueReveal resolves straight to
  // game_over: the eliminated player wasn't Mr. White, so there's no guess window, and
  // checkWin sees 0 Undercover / 0 Mr. White alive.
  usePnpStore.getState().continueReveal();

  const finished = usePnpStore.getState().game!;
  return {
    civilianNames: civilians.map((p) => p.name),
    civilianWord: finished.pair.civilianWord,
    undercoverWord: finished.pair.undercoverWord,
  };
}

describe('PnpWinScreen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePnpStore.getState().initLobby();
  });

  it('renders the winning faction headline, full reveal, and scoreboard', () => {
    const { civilianNames, civilianWord, undercoverWord } = driveToCivilianWin();
    expect(usePnpStore.getState().game?.phase).toBe('game_over');
    expect(usePnpStore.getState().game?.winnerFaction).toBe('civilian');

    render(<PnpWinScreen />);

    const screenEl = screen.getByTestId('pnp-win-screen');
    expect(screenEl.getAttribute('data-faction')).toBe('civilian');

    // Headline sits in a highlight sticker <span> inside the <h1> (design-party-pop.md §7);
    // getAllByText stays robust to that nesting.
    expect(
      screen.getAllByText(copy.reveal.winScreens.civilians.headline).length,
    ).toBeGreaterThan(0);

    // Full-table reveal: both secret words are shown, unredacted, at game_over.
    expect(
      screen.getByText(copy.reveal.fullReveal.pairLine(civilianWord, undercoverWord)),
    ).toBeTruthy();

    // Scoreboard: exactly the winning Civilians, +2 points each.
    const scoreboard = screen.getByTestId('pnp-scoreboard');
    const rows = within(scoreboard).getAllByTestId('pnp-scoreboard-row');
    expect(rows).toHaveLength(civilianNames.length);
    for (const row of rows) {
      expect(civilianNames).toContain(row.getAttribute('data-name'));
      expect(row.getAttribute('data-points')).toBe('2');
    }
  });

  it('rematch dispatches a fresh deal and carries the scoreboard/gamesPlayedInRoom forward', () => {
    driveToCivilianWin();
    const before = usePnpStore.getState().game!;
    const gamesPlayedBefore = before.gamesPlayedInRoom;

    render(<PnpWinScreen />);
    fireEvent.click(screen.getByTestId('pnp-rematch'));

    const after = usePnpStore.getState().game!;
    expect(after.phase).toBe('dealing');
    expect(after.gamesPlayedInRoom).toBe(gamesPlayedBefore + 1);
    expect(after.scoreboard).toEqual(before.scoreboard);
  });

  it('start-fresh clears the checkpoint and returns to an empty lobby', () => {
    driveToCivilianWin();

    render(<PnpWinScreen />);
    fireEvent.click(screen.getByTestId('pnp-start-fresh'));

    const after = usePnpStore.getState().game!;
    expect(after.phase).toBe('lobby');
    expect(after.players).toHaveLength(0);
  });
});
