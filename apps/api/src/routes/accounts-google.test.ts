import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { buildServer } from '../server.js';
import { createGuest, uniqueIp } from '../test-support.js';

// Mock Google's ID-token verification — the tests never reach Google. `OAuth2Client`
// is `new`ed in the route with the client ID; every instance shares one spy so a test
// controls exactly what `verifyIdToken` resolves/rejects with. Hoisted so the (hoisted)
// `vi.mock` factory can close over it.
const { verifyIdTokenMock } = vi.hoisted(() => ({ verifyIdTokenMock: vi.fn() }));
vi.mock('google-auth-library', () => ({
  // A class (not an arrow fn) so the route's `new OAuth2Client(clientId)` constructs cleanly;
  // every instance shares the one `verifyIdToken` spy.
  OAuth2Client: class {
    verifyIdToken = verifyIdTokenMock;
  },
}));

/** Make `verifyIdToken` resolve to a ticket whose `getPayload()` returns `payload`. */
function resolveGooglePayload(payload: Record<string, unknown> | undefined): void {
  verifyIdTokenMock.mockResolvedValue({ getPayload: () => payload });
}

function googleSignIn(server: FastifyInstance, token: string, idToken = 'fake.id.token') {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/google',
    headers: { authorization: `Bearer ${token}` },
    payload: { idToken },
    remoteAddress: uniqueIp(),
  });
}

// getEnv() reads process.env per request, so flipping these before an inject is enough —
// snapshot + restore so the flag never leaks into other files.
const ENV_KEYS = ['GOOGLE_SIGNIN_ENABLED', 'GOOGLE_CLIENT_ID'] as const;
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

describe('Google sign-in linking (POST /auth/google)', () => {
  let server: FastifyInstance;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.GOOGLE_SIGNIN_ENABLED = 'true';
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    verifyIdTokenMock.mockReset();
    server = await buildServer();
  });
  afterEach(async () => {
    await server.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('links the caller guest IN PLACE on a verified token — email set, isGuest false, fresh token', async () => {
    const guest = await createGuest(server, { displayName: 'Grace' });
    const email = `grace-${guest.playerId}@example.com`;
    resolveGooglePayload({ email, email_verified: true });

    const res = await googleSignIn(server, guest.token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; player: { id: string; isGuest: boolean } };
    // Same row upgraded — playerId stable, now non-guest.
    expect(body.player.id).toBe(guest.playerId);
    expect(body.player.isGuest).toBe(false);

    // players.email is the (only) linked identity — set from the Google-verified email.
    const [row] = await getDb().select().from(players).where(eq(players.id, guest.playerId));
    expect(row?.email).toBe(email);
    expect(row?.isGuest).toBe(false);

    // The fresh token reflects the upgraded identity.
    const me = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${body.token}` },
      remoteAddress: uniqueIp(),
    });
    expect((me.json() as { player: { isGuest: boolean } }).player.isGuest).toBe(false);
  });

  it('signs a returning user INTO the existing account (find-or-login) instead of erroring on a taken email', async () => {
    const first = await createGuest(server, { displayName: 'Owner' });
    const email = `shared-${first.playerId}@example.com`;
    resolveGooglePayload({ email, email_verified: true });
    expect((await googleSignIn(server, first.token)).statusCode).toBe(200);

    // A DIFFERENT guest (a returning user on a fresh device) presents a Google
    // token for the same, already-owned email → signed into the ORIGINAL account,
    // not stopped with a conflict.
    const second = await createGuest(server, { displayName: 'Returning' });
    resolveGooglePayload({ email, email_verified: true });
    const res = await googleSignIn(server, second.token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; player: { id: string; isGuest: boolean } };
    // Landed on the first account, NOT the throwaway second guest.
    expect(body.player.id).toBe(first.playerId);
    expect(body.player.id).not.toBe(second.playerId);
    expect(body.player.isGuest).toBe(false);

    // The returned token authenticates AS the original account.
    const me = await server.inject({
      method: 'GET',
      url: '/v1/players/me',
      headers: { authorization: `Bearer ${body.token}` },
      remoteAddress: uniqueIp(),
    });
    expect((me.json() as { player: { id: string } }).player.id).toBe(first.playerId);

    // The throwaway guest row is left in place (harmless, email still NULL) — not
    // merged or deleted.
    const [orphan] = await getDb().select().from(players).where(eq(players.id, second.playerId));
    expect(orphan?.email).toBeNull();
    expect(orphan?.isGuest).toBe(true);
  });

  it('rejects an unverified Google email (email_verified: false) with 400', async () => {
    const guest = await createGuest(server, { displayName: 'Unverified' });
    resolveGooglePayload({ email: `nope-${guest.playerId}@example.com`, email_verified: false });

    const res = await googleSignIn(server, guest.token);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('validation');

    // Nothing linked — the row is still a guest.
    const [row] = await getDb().select().from(players).where(eq(players.id, guest.playerId));
    expect(row?.email).toBeNull();
    expect(row?.isGuest).toBe(true);
  });

  it('rejects an invalid/forged token (verifyIdToken throws) with 400', async () => {
    const guest = await createGuest(server, { displayName: 'Forger' });
    verifyIdTokenMock.mockRejectedValue(new Error('Invalid token signature'));

    const res = await googleSignIn(server, guest.token);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('validation');
  });

  it('is inert when the feature is off — a clean 404, never a 500, and never calls Google', async () => {
    const guest = await createGuest(server, { displayName: 'Dormant' });
    // Flip the flag off for this request only (getEnv reads it per request).
    process.env.GOOGLE_SIGNIN_ENABLED = 'false';

    const res = await googleSignIn(server, guest.token);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('not_found');
    // The gate short-circuits before any token verification.
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it('requires auth (identifies the guest to upgrade)', async () => {
    resolveGooglePayload({ email: 'x@example.com', email_verified: true });
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/google',
      payload: { idToken: 'fake.id.token' },
      remoteAddress: uniqueIp(),
    });
    expect(res.statusCode).toBe(401);
  });
});
