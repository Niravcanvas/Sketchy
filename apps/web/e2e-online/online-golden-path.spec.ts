import { test, expect } from '@playwright/test';
import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type { BasicAck, JoinAck, RoomSnapshot } from '@sketchy/shared/contract/socket';
import { io, type Socket } from 'socket.io-client';

/**
 * Online golden path: a 3-player online game driven and OBSERVED
 * through a real browser, played to a win screen against a LIVE API (`playwright.online.config.ts`
 * boots the API + web; needs compose Postgres/Redis up + seeded).
 *
 * Shape: two players are socket.io "bots" (driven from the Node test — the host bot creates
 * the room via REST with a seeded official pack + role math for a fast civilian win); the
 * THIRD player is the real browser, which joins by invite link, peeks its word, gives its
 * clue, casts its ballot, and reaches `online-win-screen` — all through the actual UI. This
 * exercises the full online loop end-to-end in a browser without the flakiness of
 * orchestrating three separate browser contexts through the settings/pack-picker UI.
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

async function officialPackId(token: string): Promise<string> {
  const res = await fetch(`${API}/v1/packs?official=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`packs list failed: ${res.status}`);
  const data = (await res.json()) as { items: Array<{ id: string }> };
  if (data.items.length === 0) throw new Error('no official packs seeded — run pnpm db:seed');
  return data.items[0]!.id;
}

async function createRoom(token: string, packId: string): Promise<string> {
  const res = await fetch(`${API}/v1/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      settings: {
        packIds: [packId],
        difficulties: ['easy', 'medium', 'hard'],
        maxPlayers: 3,
        undercoverCount: 1,
        mrWhiteCount: 0,
        clueTimerSec: null,
        discussionTimerSec: null,
        voteTimerSec: null,
      },
    }),
  });
  if (!res.ok) throw new Error(`room create failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { code: string }).code;
}

interface Bot {
  playerId: string;
  socket: Socket;
  snaps: RoomSnapshot[];
}

function connectBot(guest: Guest): Bot {
  const socket = io(`${API}/game`, {
    auth: { token: guest.token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const bot: Bot = { playerId: guest.playerId, socket, snaps: [] };
  socket.on(SERVER_EVENTS.roomSnapshot, (snap: RoomSnapshot) => bot.snaps.push(snap));
  return bot;
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (r: T) => resolve(r)));
}

function botLatest(bot: Bot): RoomSnapshot | undefined {
  return bot.snaps.at(-1);
}

async function pollUntil(predicate: () => boolean, description: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${description}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('online golden path: 3-player game (1 real browser + 2 bots) reaches a civilian win', async ({
  page,
}) => {
  test.setTimeout(75_000);
  const browserName = 'Browsy';

  // --- Host + one more player as socket bots; host creates the room via REST. ---
  const hostGuest = await restGuest('Hostie');
  const botGuest = await restGuest('Botly');
  const packId = await officialPackId(hostGuest.token);
  const code = await createRoom(hostGuest.token, packId);

  const host = connectBot(hostGuest);
  const bot = connectBot(botGuest);
  const bots = [host, bot];
  try {
    for (const b of bots) {
      const joinAck = await emitAck<JoinAck>(b.socket, CLIENT_EVENTS.roomJoin, { code });
      if (!joinAck.ok) throw new Error(`bot join failed: ${joinAck.error}`);
    }

    // --- The real browser joins the room as the 3rd player through the UI. ---
    await page.goto(`/r/${code}`);
    const gate = page.getByTestId('room-join-gate');
    await expect(gate).toBeVisible();
    await gate.getByPlaceholder('Your name…').fill(browserName);
    await gate.getByRole('button', { name: 'Knock knock' }).click();
    await expect(page.getByTestId('room-code-hero')).toBeVisible();

    // Host waits until all three are seated, then starts.
    await pollUntil(() => (botLatest(host)?.state.players.length ?? 0) === 3, '3 players seated');
    const browserPlayerId = botLatest(host)!.state.players.find((p) => p.name === browserName)?.id;
    if (!browserPlayerId) throw new Error('browser player not seated in the room');
    const startAck = await emitAck<BasicAck>(host.socket, CLIENT_EVENTS.gameStart, {});
    if (!startAck.ok) throw new Error(`start failed: ${startAck.error}`);

    // --- Deal: bots ack over the socket; the browser peeks + acks through the UI. ---
    for (const b of bots) {
      await pollUntil(() => botLatest(b)?.state.phase === 'dealing', 'bot dealing');
      const ackResult = await emitAck<BasicAck>(b.socket, CLIENT_EVENTS.dealAck, {});
      if (!ackResult.ok) throw new Error(`bot deal ack failed: ${ackResult.error}`);
    }
    const dealCard = page.getByTestId('online-deal-card');
    await expect(dealCard).toBeVisible();
    await page.getByTestId('online-peek-toggle').click();
    await expect(dealCard).toHaveAttribute('data-role', /civilian|undercover|mrwhite/);
    const browserRole = await dealCard.getAttribute('data-role');
    await page.getByTestId('online-deal-ack').click();

    // --- Clue round: whoever holds the turn gives a clue (bot over socket, browser via UI). ---
    let clueN = 0;
    await pollUntil(() => botLatest(host)?.state.phase === 'clue', 'clue phase');
    for (;;) {
      const phase = botLatest(host)?.state.phase;
      if (phase !== 'clue') break;
      if (await page.getByTestId('online-clue-input').isVisible().catch(() => false)) {
        await page.getByTestId('online-clue-input').fill(`browserclue${(clueN += 1)}`);
        await page.getByTestId('online-pin-clue').click();
        await page.getByTestId('online-clue-input').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
        continue;
      }
      const turnBot = bots.find((b) => botLatest(b)?.you.canAct.submitClue === true);
      if (turnBot) {
        const ack = await emitAck<BasicAck>(turnBot.socket, CLIENT_EVENTS.clueSubmit, {
          text: `clue${(clueN += 1)}`,
        });
        if (!ack.ok) throw new Error(`bot clue failed: ${ack.error}`);
        const holder = turnBot;
        await pollUntil(
          () => holder.snaps.at(-1)?.you.canAct.submitClue !== true || botLatest(host)?.state.phase !== 'clue',
          'clue turn to advance',
        );
      } else {
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    // --- Discussion → host calls the vote. ---
    await pollUntil(() => botLatest(host)?.state.phase === 'discussion', 'discussion');
    const advanceAck = await emitAck<BasicAck>(host.socket, CLIENT_EVENTS.phaseAdvance, {});
    if (!advanceAck.ok) throw new Error(`advance to vote failed: ${advanceAck.error}`);
    await pollUntil(() => botLatest(host)?.state.phase === 'voting', 'voting');

    // --- Everyone votes the undercover out (civilian win in one round). ---
    const roster = botLatest(host)!.state.players.map((p) => ({ id: p.id, name: p.name }));
    const roleById = new Map<string, string | null>([
      [host.playerId, botLatest(host)!.you.role],
      [bot.playerId, botLatest(bot)!.you.role],
      [browserPlayerId, browserRole],
    ]);
    const uc = roster.find((p) => roleById.get(p.id) === 'undercover');
    if (!uc) throw new Error('no undercover found');
    const scapegoat = roster.find((p) => p.id !== uc.id)!; // the UC casts a throwaway ballot here

    for (const b of bots) {
      const targetId = b.playerId === uc.id ? scapegoat.id : uc.id;
      const ack = await emitAck<BasicAck>(b.socket, CLIENT_EVENTS.voteCast, { targetId });
      if (!ack.ok) throw new Error(`bot vote failed: ${ack.error}`);
    }
    await expect(page.getByTestId('online-vote-screen')).toBeVisible();
    const browserTargetName = browserPlayerId === uc.id ? scapegoat.name : uc.name;
    await page.locator(`[data-testid="online-vote-target"][data-name="${browserTargetName}"]`).click();
    await page.getByTestId('online-vote-confirm').click();

    // --- Reveal → host dismisses → win. ---
    await pollUntil(() => botLatest(host)?.state.phase === 'reveal', 'reveal');
    // The reveal auto-advances after 8s, but the host cuts it short.
    await emitAck<BasicAck>(host.socket, CLIENT_EVENTS.phaseAdvance, {});

    const winScreen = page.getByTestId('online-win-screen');
    await expect(winScreen).toBeVisible({ timeout: 15_000 });
    await expect(winScreen).toHaveAttribute('data-faction', 'civilian');
    await expect(page.getByTestId('online-scoreboard-row').first()).toBeVisible();
  } finally {
    for (const b of bots) b.socket.close();
  }
});
