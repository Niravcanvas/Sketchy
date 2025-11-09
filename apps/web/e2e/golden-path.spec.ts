import { expect, test } from '@playwright/test';
import {
  attachConsoleGuard,
  castAllBallots,
  runReveal,
  runRitual,
  runSpokenClueRound,
  setupGame,
} from './helpers';

/**
 * Playwright golden path: scripted 4-player P&P game to a win
 * screen, plus the airplane-mode approximation ("full game start->win with 5 players, no
 * network, no console errors" — done here with 4, since this spec's job is the golden path
 * specifically; the 5-player airplane path is covered by mrwhite.spec.ts). API blocked via
 * `attachConsoleGuard`, so this exercises the bundled starter pack end to end.
 */
test('golden path: 4-player game, undercover eliminated, civilians win', async ({ page }) => {
  const getErrors = await attachConsoleGuard(page);

  const names = ['Alice', 'Bob', 'Carol', 'Dave'];
  await setupGame(page, names);

  const roles = await runRitual(page, names.length);
  expect(roles.size).toBe(4);

  const entries = [...roles.entries()];
  const civilians = entries.filter(([, r]) => r.role === 'civilian');
  const undercovers = entries.filter(([, r]) => r.role === 'undercover');
  expect(civilians).toHaveLength(3);
  expect(undercovers).toHaveLength(1);

  const undercoverEntry = undercovers[0];
  if (!undercoverEntry) throw new Error('expected exactly one undercover to be dealt');
  const [undercoverName, undercoverRole] = undercoverEntry;

  // Civilians share one word; the undercover's word differs from it.
  const civilianWords = new Set(civilians.map(([, r]) => r.word));
  expect(civilianWords.size).toBe(1);
  const [sharedWord] = [...civilianWords];
  expect(undercoverRole.word).not.toBe(sharedWord);
  expect(undercoverRole.word.length).toBeGreaterThan(0);

  await runSpokenClueRound(page, names.length);

  await expect(page.getByTestId('pnp-discussion-screen')).toBeVisible();
  await page.getByTestId('pnp-call-vote').click();

  // Every voter targets the undercover; the undercover votes for whoever's first in the
  // roster that isn't themselves (Alice, unless Alice IS the undercover).
  const fallbackTarget = names.find((n) => n !== undercoverName) as string;
  await castAllBallots(page, (voterName) =>
    voterName === undercoverName ? fallbackTarget : undercoverName,
  );

  await expect(page.getByTestId('pnp-reveal-screen')).toBeVisible();
  const revealedRole = await runReveal(page);
  expect(revealedRole).toBe('undercover');

  const winScreen = page.getByTestId('pnp-win-screen');
  await expect(winScreen).toBeVisible();
  await expect(winScreen).toHaveAttribute('data-faction', 'civilian');

  // Scoreboard: only the 3 surviving civilians get a row (scoring.ts only credits the
  // winning faction's own role) — every one of them positive.
  const civilianNames = civilians.map(([name]) => name);
  await expect(page.getByTestId('pnp-scoreboard-row')).toHaveCount(civilianNames.length);
  for (const name of civilianNames) {
    const row = page.locator(`[data-testid="pnp-scoreboard-row"][data-name="${name}"]`);
    await expect(row).toBeVisible();
    const points = Number(await row.getAttribute('data-points'));
    expect(points).toBeGreaterThan(0);
  }

  expect(getErrors()).toEqual([]);
});
