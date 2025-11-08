import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDevMagicLinkFor } from '../accounts/email-provider.js';
import { getDb } from '../db/client.js';
import { players, reports } from '../db/schema.js';
import { DEFAULT_AVATAR } from '../rooms/default-avatar.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp } from '../test-support.js';

/** Pulls the raw magic-link token out of the dev sink for `email`. */
function tokenFor(email: string): string {
  const entry = findDevMagicLinkFor(email);
  if (!entry) {
    throw new Error(`no dev magic link for ${email}`);
  }
  const token = new URL(entry.link).searchParams.get('token');
  if (!token) {
    throw new Error('link had no token');
  }
  return token;
}

async function requestLink(server: FastifyInstance, token: string, email: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/link/request',
    headers: { authorization: `Bearer ${token}` },
    payload: { email },
    remoteAddress: uniqueIp(),
  });
}

async function verifyLink(server: FastifyInstance, linkToken: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/link/verify',
    payload: { token: linkToken },
    remoteAddress: uniqueIp(),
  });
}

/** Full guest→linked upgrade: creates a guest, links an email, and returns the
 * UPGRADED (guest:false) token plus the stable playerId. */
async function linkAccount(
  server: FastifyInstance,
  displayName: string,
): Promise<{ token: string; playerId: string; email: string }> {
  const guest = await createGuest(server, { displayName });
  const email = `${displayName.toLowerCase()}-${guest.playerId}@example.com`;
  await requestLink(server, guest.token, email);
  const verify = await verifyLink(server, tokenFor(email));
  const body = verify.json() as { token: string; player: { id: string } };
  return { token: body.token, playerId: body.player.id, email };
}

async function fileReport(
  server: FastifyInstance,
  reporterToken: string,
  reportedPlayerId: string,
) {
  return server.inject({
    method: 'POST',
    url: '/v1/reports',
    headers: { authorization: `Bearer ${reporterToken}` },
    payload: { reportedPlayerId, reason: 'other', detail: 'audit-trail probe' },
    remoteAddress: uniqueIp(),
  });
}

function deleteAccount(server: FastifyInstance, token: string) {
  return server.inject({
    method: 'DELETE',
    url: '/v1/account',
    headers: { authorization: `Bearer ${token}` },
    remoteAddress: uniqueIp(),
  });
}

describe('account linking (phase 16)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('upgrades the guest row IN PLACE — playerId stable, isGuest flips to false', async () => {
    const alice = await createGuest(server, { displayName: 'Alice' });
    const email = `alice-${alice.playerId}@example.com`;

    const req = await requestLink(server, alice.token, email);
    expect(req.statusCode).toBe(200);
    expect(req.json()).toEqual({ ok: true });

    const verify = await verifyLink(server, tokenFor(email));
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { token: string; player: { id: string; isGuest: boolean } };
    // playerId is stable across the upgrade (system-design.md §6).
    expect(body.player.id).toBe(alice.playerId);
    expect(body.player.isGuest).toBe(false);

    // The fresh token works and reflects the upgraded identity.
    const me = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${body.token}` },
      remoteAddress: uniqueIp(),
    });
    expect((me.json() as { player: { isGuest: boolean } }).player.isGuest).toBe(false);
  });

  it('is enumeration-safe: requesting a link for an email owned by another account still returns { ok: true }', async () => {
    const bob = await createGuest(server, { displayName: 'Bob' });
    const email = `taken-${bob.playerId}@example.com`;
    await requestLink(server, bob.token, email);
    await verifyLink(server, tokenFor(email)); // Bob now owns the email.

    const carol = await createGuest(server, { displayName: 'Carol' });
    const res = await requestLink(server, carol.token, email);
    // Identical response whether the email was free or taken — no enumeration signal.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('signs a returning user INTO their existing account when they verify on a fresh device', async () => {
    // Bea links her email on device #1 — now the owner of the address.
    const bea = await createGuest(server, { displayName: 'Bea' });
    const email = `bea-${bea.playerId}@example.com`;
    await requestLink(server, bea.token, email);
    await verifyLink(server, tokenFor(email));

    // On a fresh device she's a brand-new guest. She requests a link for the same
    // email (now owned) — the request DOES send (no longer a silent no-op)…
    const freshGuest = await createGuest(server, { displayName: 'Beanewphone' });
    const req = await requestLink(server, freshGuest.token, email);
    expect(req.statusCode).toBe(200);

    // …and verifying it signs her back into her ORIGINAL account, not the new guest.
    const verify = await verifyLink(server, tokenFor(email));
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { token: string; player: { id: string; isGuest: boolean } };
    expect(body.player.id).toBe(bea.playerId);
    expect(body.player.id).not.toBe(freshGuest.playerId);
    expect(body.player.isGuest).toBe(false);

    // The fresh guest row is left untouched (harmless throwaway, email still NULL).
    const [orphan] = await getDb()
      .select()
      .from(players)
      .where(eq(players.id, freshGuest.playerId));
    expect(orphan?.email).toBeNull();
    expect(orphan?.isGuest).toBe(true);
  });

  it('rejects an invalid link token, and a token is single-use', async () => {
    const dave = await createGuest(server, { displayName: 'Dave' });
    const email = `dave-${dave.playerId}@example.com`;
    await requestLink(server, dave.token, email);
    const linkToken = tokenFor(email);

    const bad = await verifyLink(server, 'not-a-real-token');
    expect(bad.statusCode).toBe(400);

    const first = await verifyLink(server, linkToken);
    expect(first.statusCode).toBe(200);
    const second = await verifyLink(server, linkToken);
    expect(second.statusCode).toBe(400); // consumed
  });

  it('gates public matchmaking behind a linked account (account_required for guests)', async () => {
    const guest = await createGuest(server, { displayName: 'Guesty' });

    const publicRoom = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { visibility: 'public' },
      remoteAddress: uniqueIp(),
    });
    expect(publicRoom.statusCode).toBe(403);
    expect((publicRoom.json() as { error: { code: string } }).error.code).toBe('account_required');

    const queue = await server.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { language: 'en' },
      remoteAddress: uniqueIp(),
    });
    expect(queue.statusCode).toBe(403);
    expect((queue.json() as { error: { code: string } }).error.code).toBe('account_required');

    // A PRIVATE room stays 100% guest-accessible.
    const privateRoom = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: {},
      remoteAddress: uniqueIp(),
    });
    expect(privateRoom.statusCode).toBe(200);
  });

  it('lets a linked account create a public room', async () => {
    const account = await createGuest(server, { displayName: 'Hosty' });
    const email = `hosty-${account.playerId}@example.com`;
    await requestLink(server, account.token, email);
    const upgraded = (await verifyLink(server, tokenFor(email))).json() as { token: string };

    const publicRoom = await server.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { authorization: `Bearer ${upgraded.token}` },
      payload: { visibility: 'public' },
      remoteAddress: uniqueIp(),
    });
    expect(publicRoom.statusCode).toBe(200);
    expect((publicRoom.json() as { code: string }).code).toMatch(/^[A-Z2-9]{5}$/);
  });
});

describe('account deletion — soft-anonymize (phase 16)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('soft-anonymizes a linked account: PII scrubbed, row kept, moderation audit trail survives', async () => {
    // A linked account that both FILES a report and is REPORTED against — the
    // exact case a hard delete would CASCADE-erase.
    const target = await linkAccount(server, 'Target');
    const other = await createGuest(server, { displayName: 'Otherplayer' });

    // Report AGAINST the target (someone else reports them)…
    const against = await fileReport(server, other.token, target.playerId);
    expect(against.statusCode).toBe(200);
    // …and a report FILED BY the target (they reported someone).
    const byThem = await fileReport(server, target.token, other.playerId);
    expect(byThem.statusCode).toBe(200);

    const del = await deleteAccount(server, target.token);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    // The row is KEPT (same id) with the PII scrubbed and dropped back to guest.
    const [row] = await getDb().select().from(players).where(eq(players.id, target.playerId));
    expect(row).toBeTruthy();
    expect(row?.email).toBeNull();
    expect(row?.displayName).toBe('Deleted player');
    expect(row?.isGuest).toBe(true);
    // A valid, neutral default doodle (NOT `{}`) so the scrubbed row still
    // satisfies `avatarConfigSchema` wherever it's read.
    expect(row?.avatar).toEqual(DEFAULT_AVATAR);

    // Direct proof the scrubbed row serializes cleanly: a read through the
    // response schema (which runs `avatarConfigSchema` on `avatar`) on the
    // still-valid token succeeds — with `{}` this would 500 on serialization.
    const me = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${target.token}` },
      remoteAddress: uniqueIp(),
    });
    expect(me.statusCode).toBe(200);
    const mePlayer = (
      me.json() as { player: { displayName: string; isGuest: boolean; avatar: unknown } }
    ).player;
    expect(mePlayer.displayName).toBe('Deleted player');
    expect(mePlayer.isGuest).toBe(true);
    expect(mePlayer.avatar).toEqual(DEFAULT_AVATAR);

    // Both reports survive — this is the whole point of soft-anonymize.
    const reportsAgainst = await getDb()
      .select()
      .from(reports)
      .where(eq(reports.reportedId, target.playerId));
    expect(reportsAgainst).toHaveLength(1);
    const reportsBy = await getDb()
      .select()
      .from(reports)
      .where(eq(reports.reporterId, target.playerId));
    expect(reportsBy).toHaveLength(1);
  });

  it('frees the email for reuse (UNIQUE index allows multiple NULLs)', async () => {
    // Two accounts anonymized back-to-back both land at email = NULL without a
    // unique-violation, and a fresh account can re-link the freed address.
    const first = await linkAccount(server, 'Firstacct');
    const freedEmail = first.email;
    expect((await deleteAccount(server, first.token)).statusCode).toBe(200);

    const second = await linkAccount(server, 'Secondacct');
    expect((await deleteAccount(server, second.token)).statusCode).toBe(200);

    const reclaimer = await createGuest(server, { displayName: 'Reclaimer' });
    const req = await requestLink(server, reclaimer.token, freedEmail);
    expect(req.statusCode).toBe(200);
    const verify = await verifyLink(server, tokenFor(freedEmail));
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as { player: { isGuest: boolean } }).player.isGuest).toBe(false);
  });

  it('rejects a guest with a clean validation error — nothing to delete', async () => {
    const guest = await createGuest(server, { displayName: 'Guesty' });
    const del = await deleteAccount(server, guest.token);
    expect(del.statusCode).toBe(400);
    expect((del.json() as { error: { code: string } }).error.code).toBe('validation');
  });

  it('requires auth', async () => {
    const del = await server.inject({
      method: 'DELETE',
      url: '/v1/account',
      remoteAddress: uniqueIp(),
    });
    expect(del.statusCode).toBe(401);
  });
});
