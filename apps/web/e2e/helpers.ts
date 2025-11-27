import { expect, type Page } from '@playwright/test';

/**
 * Shared pass-and-play e2e helpers (arch/game-design.md §4 flow; testids sourced straight
 * from apps/web/src/components/pnp/*.tsx + components/game/clue-board.tsx). Every helper
 * here drives the REAL UI — no store/engine reach-around — so a helper failing is exactly as
 * meaningful as a human failing to find the button it was looking for.
 */

export type RoleName = 'civilian' | 'undercover' | 'mrwhite';

export interface RitualEntry {
  role: RoleName;
  /** Empty string for Mr. White (peek-card.tsx renders `data-word=""` for them). */
  word: string;
}

function assertRoleName(value: string | null): RoleName {
  if (value === 'civilian' || value === 'undercover' || value === 'mrwhite') return value;
  throw new Error(`unexpected/missing data-role on a peek or reveal card: ${String(value)}`);
}

/** Hosts the API is deliberately blocked on for every spec — see `attachConsoleGuard`. */
const BLOCKED_API_HOSTS = ['localhost:4000', '127.0.0.1:4000'];

/**
 * Chromium itself (not application code) logs a `console.error`-level "Failed to load
 * resource: net::ERR_FAILED" for every request a `page.route(...).abort()` cuts off — this
 * fires for ANY intercepted-and-aborted request, regardless of how gracefully the page's own
 * JS handles the rejected fetch. Since every spec deliberately aborts the :4000 API to force
 * the offline/bundled-pack path, that synthetic browser-level message is expected noise from
 * the test harness itself, not a signal about the app — filtered out here, scoped tightly to
 * the blocked host so a genuine failed resource load elsewhere still fails the assertion.
 */
function isExpectedBlockedApiNoise(msg: { text(): string; location(): { url: string } }): boolean {
  if (!/^Failed to load resource: net::ERR_/.test(msg.text())) return false;
  try {
    const host = new URL(msg.location().url).host;
    return BLOCKED_API_HOSTS.includes(host);
  } catch {
    return false;
  }
}

/**
 * Installs a console-error + pageerror collector AND blocks the :4000 API origin (both
 * localhost and 127.0.0.1) so every spec exercises pass-and-play's offline/bundled-pack
 * fallback (lib/pair-pool.ts `bundledPairPool`) rather than depending on a live API server.
 * MUST be awaited before the first `page.goto` — the route handlers have to be registered
 * before the app's first fetch fires.
 */
export async function attachConsoleGuard(page: Page): Promise<() => string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isExpectedBlockedApiNoise(msg)) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  await page.route('http://localhost:4000/**', (route) => route.abort());
  await page.route('http://127.0.0.1:4000/**', (route) => route.abort());
  return () => errors;
}

/**
 * Setup screen (`/play`): seats every name in `names` (chip-by-chip, Enter submits the
 * add-player form), starts the game, and waits for the deal ritual's first interstitial.
 */
export async function setupGame(page: Page, names: string[]): Promise<void> {
  await page.goto('/play');
  const nameInput = page.getByTestId('pnp-name-input');
  for (const name of names) {
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);
    await nameInput.press('Enter');
    await expect(page.locator('li', { hasText: name })).toBeVisible();
  }
  await page.getByTestId('pnp-start').click();
  await expect(page.getByTestId('pnp-interstitial')).toBeVisible();
}

/**
 * Runs the full deal ritual for `expectedCount` players: "That's me" -> reveal via the a11y
 * toggle (never simulated press-and-hold) -> read role/word off `pnp-peek-card` -> ack.
 * Returns name -> {role, word} in ritual (seat) order. Leaves the app on the clue screen.
 */
export async function runRitual(
  page: Page,
  expectedCount: number,
): Promise<Map<string, RitualEntry>> {
  const results = new Map<string, RitualEntry>();
  for (let i = 0; i < expectedCount; i++) {
    const interstitial = page.getByTestId('pnp-interstitial');
    await expect(interstitial).toBeVisible();
    const name = await interstitial.getAttribute('data-player-name');
    if (!name) throw new Error('pnp-interstitial is missing data-player-name');

    await page.getByTestId('pnp-interstitial-confirm').click();

    const peekCard = page.getByTestId('pnp-peek-card');
    await expect(peekCard).toBeVisible();
    await page.getByTestId('pnp-peek-toggle').click();
    await expect(peekCard).toHaveAttribute('data-role', /civilian|undercover|mrwhite/);

    const role = assertRoleName(await peekCard.getAttribute('data-role'));
    const word = (await peekCard.getAttribute('data-word')) ?? '';

    await page.getByTestId('pnp-ack').click();
    results.set(name, { role, word });
  }
  return results;
}

/**
 * Taps "Next player" `taps` times in a spoken-clue round (`clue` or `tiebreak_clue`). Waits
 * for the speaker to change between taps; the final tap is left for the caller to assert on
 * (a normal round lands on discussion, a tiebreak round drops straight into voting).
 */
export async function runSpokenClueRound(page: Page, taps: number): Promise<void> {
  for (let i = 0; i < taps; i++) {
    const clueScreen = page.getByTestId('pnp-clue-screen');
    const before = await clueScreen.getAttribute('data-player-name');
    await page.getByTestId('pnp-next-player').click();
    if (i < taps - 1) {
      await page.waitForFunction(
        (previous) => {
          const el = document.querySelector('[data-testid="pnp-clue-screen"]');
          return !!el && el.getAttribute('data-player-name') !== previous;
        },
        before,
        { timeout: 10_000 },
      );
    }
  }
}

/**
 * Casts every ballot in the current secret-ballot pass-around: reads the voter's name off
 * the handoff interstitial, confirms, picks `chooseTarget(voterName)` off the suspect grid,
 * locks it in. Stops once the interstitial stops reappearing — the engine auto-closes the
 * vote (and the phase moves on) the instant the last eligible voter locks in.
 */
export async function castAllBallots(
  page: Page,
  chooseTarget: (voterName: string) => string,
): Promise<void> {
  const interstitial = page.getByTestId('pnp-vote-interstitial');
  for (;;) {
    const shown = await interstitial
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!shown) break;

    const voterName = await interstitial.getAttribute('data-player-name');
    if (!voterName) throw new Error('pnp-vote-interstitial is missing data-player-name');

    await page.getByTestId('pnp-interstitial-confirm').click();
    await expect(page.getByTestId('pnp-vote-screen')).toBeVisible();

    const targetName = chooseTarget(voterName);
    await page.locator(`[data-testid="pnp-vote-target"][data-name="${targetName}"]`).click();
    await page.getByTestId('pnp-vote-confirm').click();
  }
}

/**
 * Runs the two-tap reveal buildup ("The table has spoken" -> "{name}, you're out" -> role
 * card), reads the revealed role, then continues. Returns the revealed role.
 */
export async function runReveal(page: Page): Promise<RoleName> {
  await page.getByTestId('pnp-reveal-next').click();
  await page.getByTestId('pnp-reveal-next').click();

  const revealScreen = page.getByTestId('pnp-reveal-screen');
  await expect(revealScreen).toHaveAttribute('data-role', /civilian|undercover|mrwhite/);
  const role = assertRoleName(await revealScreen.getAttribute('data-role'));

  await page.getByTestId('pnp-reveal-continue').click();
  return role;
}
