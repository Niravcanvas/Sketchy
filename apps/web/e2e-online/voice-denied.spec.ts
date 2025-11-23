import { expect, test } from '@playwright/test';

/**
 * Voice E2E — the mic-permission-denial path, as a REAL-browser counterpart to the
 * mocked unit coverage in `src/lib/voice.test.ts` (`joinVoice: a mic-permission denial lands
 * on denied ...`, which asserts the exact `NotAllowedError` → `'denied'` mapping this file
 * tries to reproduce in a live browser).
 *
 * Marked `test.fixme` — it does NOT run reliably in headless Chromium and is skipped in
 * automated runs. Reaching the denial needs LiveKit's `connect()` to succeed FIRST and only
 * THEN `setMicrophoneEnabled()` to hit a denied getUserMedia; but headless CI stalls at
 * `connecting` before the mic is ever requested — none of the fake-media flag combinations
 * that make `voice.spec.ts`'s *connected* path work reproduce a genuine permission *block*
 * here (fake-ui auto-ACCEPTS; no-device stalls connect; overriding getUserMedia to reject
 * wedges connect too). The denial→`'denied'` behavior itself is verified deterministically by
 * the unit test above; this spec is kept as executable documentation of the intended flow and
 * a starting point for a future non-headless / real-device CI lane.
 */

const API = 'http://localhost:4000';

interface Guest {
  token: string;
  playerId: string;
}

async function restGuest(displayName: string): Promise<Guest> {
  const res = await fetch(`${API}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`guest auth failed: ${res.status}`);
  const data = (await res.json()) as { token: string; player: { id: string } };
  return { token: data.token, playerId: data.player.id };
}

async function createRoom(token: string): Promise<string> {
  const res = await fetch(`${API}/v1/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ settings: { maxPlayers: 6 } }),
  });
  if (!res.ok) throw new Error(`room create failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { code: string }).code;
}

test.fixme('a declined mic permission lands on "denied" and never blocks the game', async ({
  page,
}) => {
  test.setTimeout(30_000);

  const host = await restGuest('DeniedHost');
  const code = await createRoom(host.token);

  // Force a hard mic denial deterministically (see this file's top comment for why headless
  // browser flags can't): reject getUserMedia with the NotAllowedError a real "Block" raises,
  // which livekit-client maps to PermissionDenied → voice.ts's 'denied' pill state.
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    });
  });

  await page.goto(`/r/${code}`);
  const gate = page.getByTestId('room-join-gate');
  await expect(gate).toBeVisible();
  await gate.getByPlaceholder('Your name…').fill('DeniedBrowser');
  await gate.getByRole('button', { name: 'Knock knock' }).click();
  await expect(page.getByTestId('room-code-hero')).toBeVisible();

  const pill = page.getByTestId('voice-pill');
  await page.getByTestId('voice-join').click();
  await expect(pill).toHaveAttribute('data-voice-status', 'denied', { timeout: 15_000 });
  // A denial is not treated as a retry-worthy outage — the pill offers a manual retry
  // instead of quietly looping.
  await expect(page.getByTestId('voice-join')).toBeEnabled();

  // The room is fully playable regardless — voice is cosmetic (game-design.md §10).
  const readyButton = page.getByRole('button', { name: "I'm ready" });
  await expect(readyButton).toBeEnabled();
  await readyButton.click();
  await expect(page.getByRole('button', { name: 'Hang on…' })).toBeVisible();
});
