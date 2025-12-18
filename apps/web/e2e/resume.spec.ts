import { expect, test } from '@playwright/test';
import { attachConsoleGuard, setupGame } from './helpers';

/**
 * Kill the tab mid-game -> reopen -> Resume restores the exact
 * phase. (pnp-store.ts `hydrateFromCheckpoint` / the `/play` "Resume last game?" prompt.)
 * Uses `context.newPage()` rather than a fresh context — the checkpoint lives in
 * localStorage, which is scoped per browser context, not per page.
 */

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

test('resume restores the exact ritual position after the tab is killed', async ({ context }) => {
  const page1 = await context.newPage();
  const getErrors1 = await attachConsoleGuard(page1);
  await setupGame(page1, NAMES);

  // Ack exactly 2 of 4 players.
  for (let i = 0; i < 2; i++) {
    await expect(page1.getByTestId('pnp-interstitial')).toBeVisible();
    await page1.getByTestId('pnp-interstitial-confirm').click();
    await expect(page1.getByTestId('pnp-peek-card')).toBeVisible();
    await page1.getByTestId('pnp-ack').click();
  }

  // Note the 3rd player's name off the interstitial, then kill the tab without acking them.
  const thirdInterstitial = page1.getByTestId('pnp-interstitial');
  await expect(thirdInterstitial).toBeVisible();
  const thirdPlayerName = await thirdInterstitial.getAttribute('data-player-name');
  expect(thirdPlayerName).toBeTruthy();

  await page1.close();

  const page2 = await context.newPage();
  const getErrors2 = await attachConsoleGuard(page2);
  await page2.goto('/play');

  await expect(page2.getByTestId('pnp-resume')).toBeVisible();
  await page2.getByTestId('pnp-resume').click();

  const resumedInterstitial = page2.getByTestId('pnp-interstitial');
  await expect(resumedInterstitial).toBeVisible();
  await expect(resumedInterstitial).toHaveAttribute('data-player-name', thirdPlayerName ?? '');

  expect(getErrors1()).toEqual([]);
  expect(getErrors2()).toEqual([]);
});

test('start fresh from a mid-game checkpoint clears the roster', async ({ context }) => {
  const page1 = await context.newPage();
  const getErrors1 = await attachConsoleGuard(page1);
  await setupGame(page1, NAMES);

  // One ack is enough to establish a genuine mid-game checkpoint.
  await expect(page1.getByTestId('pnp-interstitial')).toBeVisible();
  await page1.getByTestId('pnp-interstitial-confirm').click();
  await expect(page1.getByTestId('pnp-peek-card')).toBeVisible();
  await page1.getByTestId('pnp-ack').click();

  await page1.close();

  const page2 = await context.newPage();
  const getErrors2 = await attachConsoleGuard(page2);
  await page2.goto('/play');

  await expect(page2.getByTestId('pnp-resume')).toBeVisible();
  await page2.getByTestId('pnp-start-fresh').click();

  await expect(page2.getByTestId('pnp-name-input')).toBeVisible();
  await expect(page2.locator('li')).toHaveCount(0);

  expect(getErrors1()).toEqual([]);
  expect(getErrors2()).toEqual([]);
});
