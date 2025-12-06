import { expect, test } from '@playwright/test';
import { attachConsoleGuard, castAllBallots, runRitual, runSpokenClueRound, setupGame } from './helpers';

/**
 * Tie -> tiebreak -> second tie = no elimination, verified via
 * scripted play. (reducers/vote.ts `closeVote`: first tie -> `tiebreak_clue` -> re-vote
 * among just the tied players -> a second tie resolves straight to a fresh clue round with
 * nobody eliminated, game-design.md §6.4.)
 *
 * A and B are always picked from CIVILIAN names (never undercover/Mr. White) so this test
 * can never accidentally trip a reveal/win path — a 6-player table (suggestRoleCounts: 1
 * undercover + 1 Mr. White) always deals at least 4 civilians, leaving plenty of room.
 */
test('a 3-3 tie goes to tiebreak, ties again, and eliminates nobody', async ({ page }) => {
  test.setTimeout(120_000);
  const getErrors = await attachConsoleGuard(page);

  const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank'];
  await setupGame(page, names);

  const roles = await runRitual(page, names.length);
  const civilianNames = [...roles.entries()]
    .filter(([, r]) => r.role === 'civilian')
    .map(([name]) => name);
  expect(civilianNames.length).toBeGreaterThanOrEqual(2);
  const [playerA, playerB] = civilianNames as [string, string];

  await runSpokenClueRound(page, names.length);
  await expect(page.getByTestId('pnp-discussion-screen')).toBeVisible();
  await page.getByTestId('pnp-call-vote').click();

  // A<->B cross-vote each other; every other voter alternates A/B. With exactly 4 other
  // voters (6 - the 2 tied), that's a 3-3 split no matter which seats hold A/B, the
  // undercover, or Mr. White.
  let otherVoterIndex = 0;
  const tieScript = (voterName: string): string => {
    if (voterName === playerA) return playerB;
    if (voterName === playerB) return playerA;
    const target = otherVoterIndex % 2 === 0 ? playerA : playerB;
    otherVoterIndex += 1;
    return target;
  };

  await castAllBallots(page, tieScript);

  await expect(page.getByTestId('pnp-tiebreak-banner')).toBeVisible();

  // Only the two tied players speak in the tiebreak round.
  await runSpokenClueRound(page, 2);

  // The engine drops straight into the re-vote (no discussion screen, no "call the vote"
  // tap) — targets are restricted to {A, B}, but all 6 alive players still vote.
  otherVoterIndex = 0;
  await castAllBallots(page, tieScript);

  const interlude = page.getByTestId('pnp-interlude');
  await expect(interlude).toBeVisible();
  await expect(interlude).toHaveAttribute('data-kind', 'second_tie');
  await page.getByTestId('pnp-interlude-continue').click();

  await expect(page.getByTestId('pnp-clue-screen')).toBeVisible();

  // Nobody was eliminated: round 2 still needs all 6 players to speak.
  await runSpokenClueRound(page, 6);
  await expect(page.getByTestId('pnp-discussion-screen')).toBeVisible();

  expect(getErrors()).toEqual([]);
});
