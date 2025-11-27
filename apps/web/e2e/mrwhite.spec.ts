import { expect, test, type Page } from '@playwright/test';
import {
  attachConsoleGuard,
  castAllBallots,
  runReveal,
  runRitual,
  runSpokenClueRound,
  setupGame,
} from './helpers';

/**
 * Mr. White path: correct guess steals the win; wrong guess shows
 * the guess and continues; both verified. Also doubles as the 5-player airplane-mode game
 * (game-design.md §6.6, api-contract.md §3 offline fallback) — API blocked via
 * `attachConsoleGuard` in both tests.
 */

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'];

/** Deals, runs the clue round, calls the vote, and votes every player except Mr. White
 * to eliminate them. Returns the ritual roles map (name -> {role, word}). */
async function playToMrWhiteElimination(
  page: Page,
): Promise<Map<string, { role: string; word: string }>> {
  await setupGame(page, NAMES);
  const roles = await runRitual(page, NAMES.length);

  const mrWhiteEntry = [...roles.entries()].find(([, r]) => r.role === 'mrwhite');
  if (!mrWhiteEntry) throw new Error('expected a Mr. White to be dealt among 5 players');
  const [mrWhiteName] = mrWhiteEntry;

  await runSpokenClueRound(page, NAMES.length);
  await expect(page.getByTestId('pnp-discussion-screen')).toBeVisible();
  await page.getByTestId('pnp-call-vote').click();

  const fallbackTarget = NAMES.find((n) => n !== mrWhiteName) as string;
  await castAllBallots(page, (voterName) =>
    voterName === mrWhiteName ? fallbackTarget : mrWhiteName,
  );

  await expect(page.getByTestId('pnp-reveal-screen')).toBeVisible();
  const revealedRole = await runReveal(page);
  expect(revealedRole).toBe('mrwhite');
  await expect(page.getByTestId('pnp-mrwhite-screen')).toBeVisible();

  return roles;
}

test('Mr. White steals the win with a correct guess', async ({ page }) => {
  const getErrors = await attachConsoleGuard(page);

  const roles = await playToMrWhiteElimination(page);

  const civilianEntry = [...roles.entries()].find(([, r]) => r.role === 'civilian');
  if (!civilianEntry) throw new Error('expected at least one civilian to be dealt');
  const civilianWord = civilianEntry[1].word;
  expect(civilianWord.length).toBeGreaterThan(0);

  await page.getByTestId('pnp-mrwhite-input').fill(civilianWord);
  await page.getByTestId('pnp-mrwhite-submit').click();

  const winScreen = page.getByTestId('pnp-win-screen');
  await expect(winScreen).toBeVisible();
  await expect(winScreen).toHaveAttribute('data-faction', 'mrwhite');

  expect(getErrors()).toEqual([]);
});

test('Mr. White guesses wrong and play continues', async ({ page }) => {
  const getErrors = await attachConsoleGuard(page);

  await playToMrWhiteElimination(page);

  const wrongGuess = 'xyzzy-not-the-word';
  await page.getByTestId('pnp-mrwhite-input').fill(wrongGuess);
  await page.getByTestId('pnp-mrwhite-submit').click();

  const interlude = page.getByTestId('pnp-interlude');
  await expect(interlude).toBeVisible();
  await expect(interlude).toHaveAttribute('data-kind', 'wrong_guess');
  await expect(interlude).toContainText(wrongGuess);

  await page.getByTestId('pnp-interlude-continue').click();

  // 3 civilians + 1 undercover remain alive: checkWin has no verdict yet, so play
  // continues into round 2's clue phase (game-design.md's check-win.ts priority table).
  await expect(page.getByTestId('pnp-clue-screen')).toBeVisible();

  expect(getErrors()).toEqual([]);
});
