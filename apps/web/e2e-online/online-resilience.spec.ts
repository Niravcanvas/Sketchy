import { test, expect } from '@playwright/test';
import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type { JoinAck, RoomSnapshot } from '@sketchy/shared/contract/socket';
import { io, type Socket } from 'socket.io-client';

/**
 * Online rejoin e2e (game-design.md §8 "Rejoin after full
 * close"): a real browser joins a room, navigates AWAY to the home screen (its
 * socket tears down — the "closed the tab" case), and is offered "Rejoin room
 * {CODE}?" from localStorage memory. Clicking Rejoin returns it to the room with
 * its seat intact — no re-typing a name, no lost state. Runs against the LIVE API
 * (`playwright.online.config.ts`; needs compose Postgres/Redis up + seeded).
 *
 * (The network-blip / phone-lock resync is proven server-side by rejoin.test.ts +
 * the manual 3-device Verify drill; Playwright's offline emulation doesn't reliably
 * drop an established websocket, so it isn't automated here.)
 */

const API = 'http://localhost:4000';

async function restGuest(displayName: string): Promise<{ token: string; playerId: string }> {
  const res = await fetch(`${API}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`guest auth failed: ${res.status}`);
  const data = (await res.json()) as { token: string; player: { id: string } };
  return { token: data.token, playerId: data.player.id };
}

async function officialPackId(token: string): Promise<string> {
  const res = await fetch(`${API}/v1/packs?official=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { items: Array<{ id: string }> };
  if (data.items.length === 0) throw new Error('no official packs seeded — run pnpm db:seed');
  return data.items[0]!.id;
}

async function createRoom(token: string, packId: string): Promise<string> {
  const res = await fetch(`${API}/v1/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      settings: { packIds: [packId], maxPlayers: 3, undercoverCount: 1, mrWhiteCount: 0 },
    }),
  });
  if (!res.ok) throw new Error(`room create failed: ${res.status}`);
  return ((await res.json()) as { code: string }).code;
}

function connectBot(token: string): { socket: Socket; snaps: RoomSnapshot[] } {
  const socket = io(`${API}/game`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const snaps: RoomSnapshot[] = [];
  socket.on(SERVER_EVENTS.roomSnapshot, (snap: RoomSnapshot) => snaps.push(snap));
  return { socket, snaps };
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (r: T) => resolve(r)));
}

test('a real browser can rejoin a room from the home-screen prompt after leaving the tab', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const browserName = 'Rejoinnie';

  const hostGuest = await restGuest('RejoinHost');
  const packId = await officialPackId(hostGuest.token);
  const code = await createRoom(hostGuest.token, packId);
  const host = connectBot(hostGuest.token);

  try {
    const joinAck = await emitAck<JoinAck>(host.socket, CLIENT_EVENTS.roomJoin, { code });
    if (!joinAck.ok) throw new Error(`host join failed: ${joinAck.error}`);

    // Browser joins the lobby through the real UI.
    await page.goto(`/r/${code}`);
    const gate = page.getByTestId('room-join-gate');
    await expect(gate).toBeVisible();
    await gate.getByPlaceholder('Your name…').fill(browserName);
    await gate.getByRole('button', { name: 'Knock knock' }).click();
    await expect(page.getByTestId('room-code-hero')).toBeVisible();
    await expect(page.locator('[data-testid="player-card"]')).toHaveCount(2);

    // Leave the tab: go back to the home screen (the room socket tears down).
    await page.goto('/');
    // The site-entry rejoin prompt remembers the in-progress room (copy §8).
    await expect(page.getByText(`You have a game in progress in room ${code}.`)).toBeVisible({
      timeout: 15_000,
    });

    // Rejoin → back at the room. Already authed, so the gate needs no name re-entry
    // (just a doodle confirm + knock), and the seat is restored: still 2 players,
    // no "in progress"/"full" rejection.
    await page.getByRole('button', { name: 'Rejoin' }).click();
    const rejoinGate = page.getByTestId('room-join-gate');
    await expect(rejoinGate).toBeVisible({ timeout: 15_000 });
    await rejoinGate.getByRole('button', { name: 'Knock knock' }).click();
    await expect(page.getByTestId('room-code-hero')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="player-card"]')).toHaveCount(2);
  } finally {
    host.socket.close();
  }
});
