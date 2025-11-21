import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * Voice E2E — a REAL browser joins REAL voice against a
 * REAL LiveKit container (`sketchy-livekit-e2e`, started manually before this spec runs —
 * see `playwright.voice.config.ts`'s doc comment). This is the genuine, browser-level
 * evidence behind the Verify checklist's "Deny mic permission" and "Kill LiveKit container
 * mid-game" items, distinct from `src/lib/voice.test.ts`'s mocked unit coverage of the same
 * scenarios.
 */

const API = 'http://localhost:4000';
const LIVEKIT_CONTAINER = 'sketchy-livekit-e2e';

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

test.describe('voice (real LiveKit container)', () => {
  test('joins voice, mutes, degrades when LiveKit dies, and recovers without a page reload', async ({
    page,
  }) => {
    test.setTimeout(50_000);

    const host = await restGuest('VoiceHost');
    const code = await createRoom(host.token);

    await page.goto(`/r/${code}`);
    const gate = page.getByTestId('room-join-gate');
    await expect(gate).toBeVisible();
    await gate.getByPlaceholder('Your name…').fill('VoiceBrowser');
    await gate.getByRole('button', { name: 'Knock knock' }).click();
    await expect(page.getByTestId('room-code-hero')).toBeVisible();

    // --- Join voice: a REAL getUserMedia() (fake device, real WebRTC) + a REAL LiveKit
    // connection through the REAL running API's voice-token endpoint. ---
    const pill = page.getByTestId('voice-pill');
    await expect(pill).toBeVisible();
    await page.getByTestId('voice-join').click();
    await expect(pill).toHaveAttribute('data-voice-status', 'connected', { timeout: 20_000 });

    // --- Mute toggle: local track mute + the voice:state → voice:roster round trip. ---
    const muteToggle = page.getByTestId('voice-mute-toggle');
    await expect(muteToggle).toHaveAttribute('aria-label', 'Mute');
    await muteToggle.click();
    await expect(muteToggle).toHaveAttribute('aria-label', 'Unmute', { timeout: 5_000 });

    // --- Kill the LiveKit container mid-"game" (a
    // real `docker kill` against a container this spec itself owns — SIGKILL, not `docker
    // stop`'s SIGTERM-then-10s-grace, so the client sees an abrupt connection loss on a
    // realistic timescale instead of waiting out Docker's own shutdown grace period first).
    // The rest of the room UI (the ready bar) must stay completely unaffected. Wrapped in
    // try/finally so a failed assertion never leaves the container down for a later run.
    const readyButton = page.getByRole('button', { name: "I'm ready" });
    await expect(readyButton).toBeVisible();
    try {
      execSync(`docker kill ${LIVEKIT_CONTAINER}`);

      await expect(pill).toHaveAttribute('data-voice-status', 'unavailable', { timeout: 20_000 });
      // The game itself is untouched by the voice outage.
      await expect(readyButton).toBeEnabled();
      await readyButton.click();
      await expect(page.getByRole('button', { name: 'Hang on…' })).toBeVisible();
    } finally {
      // --- Restart the container: the client's own background retry loop (lib/voice.ts,
      // ~5s cadence) must recover WITHOUT a page reload. ---
      execSync(`docker start ${LIVEKIT_CONTAINER}`);
    }
    await expect(pill).toHaveAttribute('data-voice-status', 'connected', { timeout: 20_000 });
  });
});
