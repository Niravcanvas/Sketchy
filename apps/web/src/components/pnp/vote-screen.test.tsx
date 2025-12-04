import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePlayer } from '@sketchy/engine/types';
import { bundledPairPool } from '@/lib/pair-pool';
import { copy } from '@/copy';
import { currentRitualPlayer, usePnpStore } from '@/stores/pnp-store';
import { PnpVoteScreen } from './vote-screen';

function playerNames(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Player${i}`);
}

/** Drives the deal ritual pass-around to completion via the real UI-facing actions
 * (mirrors pnp-store.test.ts's helper of the same name). */
function ackAllRitual(): void {
  let player = currentRitualPlayer(usePnpStore.getState().game!);
  while (player) {
    usePnpStore.getState().confirmPass();
    usePnpStore.getState().setPeeking(true);
    usePnpStore.getState().ackCurrent();
    player = currentRitualPlayer(usePnpStore.getState().game!);
  }
}

/** 5 players, spoken mode by default: skip every clue turn, call the vote from discussion.
 * Exactly the recipe this screen's tests need — clue content is irrelevant here.
 * `initLobby()` resets `prefs` to its defaults, so `openVote` must be set AFTER it (and
 * before `startGame`, which is where the store's checkpoint first starts persisting it). */
function reachVotingPhase(opts: { openVote?: boolean } = {}): GamePlayer[] {
  usePnpStore.getState().initLobby();
  if (opts.openVote) usePnpStore.getState().setOpenVote(true);
  for (const name of playerNames(5)) usePnpStore.getState().addPlayer(name);
  usePnpStore.getState().startGame(bundledPairPool(['easy', 'medium', 'hard']));
  ackAllRitual();
  for (let i = 0; i < 5; i += 1) usePnpStore.getState().nextSpeaker();
  usePnpStore.getState().callVote();
  const game = usePnpStore.getState().game!;
  expect(game.phase).toBe('voting');
  return game.players;
}

function findByAttr(testId: string, attr: string, value: string): HTMLElement {
  const el = screen
    .getAllByTestId(testId)
    .find((candidate) => candidate.getAttribute(attr) === value);
  if (!el) throw new Error(`no [data-testid="${testId}"] with [${attr}="${value}"]`);
  return el;
}

beforeEach(() => {
  window.localStorage.clear();
  usePnpStore.getState().initLobby();
});

describe('PnpVoteScreen — secret ballots (default prefs)', () => {
  it('shows the first voter\'s pass interstitial, then the suspect grid after "That\'s me"', () => {
    const players = reachVotingPhase();
    const firstVoter = players[0] as GamePlayer;

    render(<PnpVoteScreen />);

    const interstitial = screen.getByTestId('pnp-vote-interstitial');
    expect(interstitial.getAttribute('data-player-name')).toBe(firstVoter.name);
    expect(screen.getByText(copy.pnp.voteHandoff(firstVoter.name))).toBeTruthy();
    expect(screen.queryByTestId('pnp-vote-screen')).toBeNull();

    fireEvent.click(screen.getByTestId('pnp-interstitial-confirm'));

    expect(screen.getByTestId('pnp-vote-screen')).toBeTruthy();
    expect(screen.getAllByTestId('pnp-vote-target')).toHaveLength(players.length);
  });

  it("disables the current voter's own suspect card", () => {
    const players = reachVotingPhase();
    const firstVoter = players[0] as GamePlayer;

    render(<PnpVoteScreen />);
    fireEvent.click(screen.getByTestId('pnp-interstitial-confirm'));

    const ownCard = findByAttr('pnp-vote-target', 'data-name', firstVoter.name) as HTMLButtonElement;
    expect(ownCard.disabled).toBe(true);

    const othersCard = findByAttr(
      'pnp-vote-target',
      'data-name',
      (players[1] as GamePlayer).name,
    ) as HTMLButtonElement;
    expect(othersCard.disabled).toBe(false);
  });

  it('selecting a target and locking it in records the ballot and hands off to the next voter', () => {
    const players = reachVotingPhase();
    const firstVoter = players[0] as GamePlayer;
    const target = players[1] as GamePlayer;

    render(<PnpVoteScreen />);
    fireEvent.click(screen.getByTestId('pnp-interstitial-confirm'));

    fireEvent.click(findByAttr('pnp-vote-target', 'data-name', target.name));
    fireEvent.click(screen.getByTestId('pnp-vote-confirm'));

    expect(usePnpStore.getState().game!.votes[firstVoter.id]).toBe(target.id);

    // players[1] is next in seat order without a ballot yet (they were voted FOR, not by).
    const nextVoter = players[1] as GamePlayer;
    const interstitial = screen.getByTestId('pnp-vote-interstitial');
    expect(interstitial.getAttribute('data-player-name')).toBe(nextVoter.name);
  });
});

describe('PnpVoteScreen — open voting', () => {
  it('renders one row per eligible voter and wires castOpenVote clicks', () => {
    const players = reachVotingPhase({ openVote: true });
    const voter = players[0] as GamePlayer;
    const target = players[1] as GamePlayer;

    render(<PnpVoteScreen />);

    expect(screen.getAllByTestId('pnp-open-vote-row')).toHaveLength(players.length);
    expect(screen.getByText(copy.pnp.openVote.instruction)).toBeTruthy();

    const targetButton = screen
      .getAllByTestId('pnp-open-vote-target')
      .find(
        (el) =>
          el.getAttribute('data-voter') === voter.name && el.getAttribute('data-target') === target.name,
      ) as HTMLButtonElement;
    fireEvent.click(targetButton);

    expect(usePnpStore.getState().game!.votes[voter.id]).toBe(target.id);
  });
});

describe('PnpVoteScreen — vote closes automatically', () => {
  it('leaves phase "voting" after the last ballot instead of rendering a stale screen', () => {
    const players = reachVotingPhase();
    // Everyone but `target` votes for `target`; `target` throws a harmless vote at
    // `fallback` — guarantees a clean plurality, never a tie (mirrors engine/test-support.ts).
    const target = players[1] as GamePlayer;
    const fallback = players[0] as GamePlayer;

    render(<PnpVoteScreen />);

    for (const voter of players) {
      fireEvent.click(screen.getByTestId('pnp-interstitial-confirm'));
      const wanted = voter.id === target.id ? fallback.name : target.name;
      fireEvent.click(findByAttr('pnp-vote-target', 'data-name', wanted));
      fireEvent.click(screen.getByTestId('pnp-vote-confirm'));
    }

    expect(usePnpStore.getState().game!.phase).not.toBe('voting');
    expect(screen.queryByTestId('pnp-vote-screen')).toBeNull();
    expect(screen.queryByTestId('pnp-vote-interstitial')).toBeNull();
  });
});
