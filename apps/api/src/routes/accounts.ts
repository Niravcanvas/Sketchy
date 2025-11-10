import {
  deleteAccountResponseSchema,
  googleSignInRequestSchema,
  googleSignInResponseSchema,
  linkRequestResponseSchema,
  linkRequestSchema,
  linkVerifyRequestSchema,
  linkVerifyResponseSchema,
} from '@sketchy/shared/contract/accounts';
import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import type { Player } from '@sketchy/shared/contract/players';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { getEmailProvider, getRecentDevMagicLinks } from '../accounts/email-provider.js';
import { consumeLinkToken, createLinkToken } from '../accounts/link-store.js';
import { signPlayerToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/plugin.js';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { getEnv } from '../env.js';
import { sendError } from '../error-envelope.js';
import { accountDeleteRateLimit, accountLinkRateLimit, authRateLimit } from '../rate-limit.js';
import { DEFAULT_AVATAR } from '../rooms/default-avatar.js';
import { mapPlayer } from './mappers.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";

/** The enumeration-safe constant response for `POST /auth/link/request` — the
 * SAME body whether or not a link was actually minted, so an attacker can't
 * probe which emails already have accounts. */
const LINK_REQUEST_OK = { ok: true } as const;

/**
 * Turn PROVEN control of an email into a session, find-or-login style
 * (system-design.md §6). The caller reaches here only AFTER proving they control
 * `email` — via a consumed single-use magic-link token or a Google-verified ID
 * token — so this decides WHICH account that proof signs into:
 *
 * - If an account already owns `email`, issue a session for THAT account and
 *   leave it untouched. This is the returning-user login path — a fresh guest on
 *   a new device signs back into their original account instead of hitting the
 *   old "that email is already in use" wall. The `requesterId` guest row is left
 *   as a harmless throwaway (email NULL); it's not merged or deleted.
 * - Otherwise `email` is unclaimed: upgrade the requester's OWN row in place
 *   (`playerId` stable, history preserved) to own it — the first-time link.
 *
 * Safe because `players.email` is the sole account key and reaching here already
 * required proof of control of that address, so "sign into the owner of this
 * email" is exactly what both proofs authorize. Returns `{ kind: 'gone' }` only
 * when the requester's row vanished mid-flow AND the email is unclaimed — i.e.
 * there is genuinely no account to land on.
 */
async function loginOrLinkEmail(
  email: string,
  requesterId: string,
  log: FastifyBaseLogger,
): Promise<{ kind: 'ok'; token: string; player: Player } | { kind: 'gone' }> {
  const db = getDb();

  const [existing] = await db.select().from(players).where(eq(players.email, email)).limit(1);
  if (existing) {
    const token = await signPlayerToken(existing.id, false);
    return { kind: 'ok', token, player: mapPlayer(existing) };
  }

  let updated;
  try {
    [updated] = await db
      .update(players)
      .set({ email, isGuest: false })
      .where(eq(players.id, requesterId))
      .returning();
  } catch (error) {
    // Lost the citext-unique race: another verify claimed `email` between the
    // lookup above and this update. Re-resolve and sign into the winner rather
    // than erroring — the requester still proved control of the address.
    log.warn({ err: error }, 'email claimed mid-link; signing into the winner');
    const [winner] = await db.select().from(players).where(eq(players.email, email)).limit(1);
    if (winner) {
      const token = await signPlayerToken(winner.id, false);
      return { kind: 'ok', token, player: mapPlayer(winner) };
    }
    throw error;
  }
  if (!updated) {
    return { kind: 'gone' };
  }
  const token = await signPlayerToken(updated.id, false);
  return { kind: 'ok', token, player: mapPlayer(updated) };
}

/**
 * Email magic-link account linking (system-design.md §6,
 * api-contract.md §1 "Accounts/auth"). Find-or-login: an unclaimed email upgrades
 * the guest's EXISTING row in place (`playerId` stable, history preserved), while
 * an email another account already owns signs the caller back into THAT account
 * (returning user on a new device). Enumeration-safe and rate-limited; with no
 * transactional-email provider configured the dev `'log'` provider writes the
 * link to the log + dev sink instead of sending — never claims an email was sent.
 */
export const accountRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/auth/link/request',
    {
      preHandler: [requireAuth, accountLinkRateLimit],
      schema: {
        body: linkRequestSchema,
        response: {
          200: linkRequestResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }
      const email = request.body.email.trim();

      // Always mint + send — whether the address is free (first-time link) or an
      // account already owns it (a returning user signing back in on a new
      // device). The old code deliberately sent NOTHING for an owned address,
      // which is exactly what left returning users stranded: "check your inbox"
      // and then no email. Sending is safe because the link only ever lands in
      // the address owner's inbox, and verify (`loginOrLinkEmail`) signs them
      // into whichever account already owns it. The constant response below keeps
      // this enumeration-safe — it's identical whether or not an account existed.
      const token = await createLinkToken(caller.id, email);
      const link = `${getEnv().publicWebUrl}/link?token=${encodeURIComponent(token)}`;
      try {
        await getEmailProvider(request.log).sendMagicLink(email, link);
      } catch (error) {
        // A real-provider misconfig (e.g. EMAIL_PROVIDER=resend with no key)
        // is a server error, not an enumeration signal.
        request.log.error({ err: error }, 'magic-link send failed');
        sendError(reply, 500, 'internal', 'Could not send the link right now. Try again shortly.');
        return undefined;
      }

      return LINK_REQUEST_OK;
    },
  );

  fastify.post(
    '/auth/link/verify',
    {
      // No `requireAuth` — the single-use token IS the proof of email control,
      // so the link works from any device/session (system-design.md §6). Rate
      // limited per-IP like `POST /auth/guest`.
      preHandler: authRateLimit,
      schema: {
        body: linkVerifyRequestSchema,
        response: {
          200: linkVerifyResponseSchema,
          400: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const pending = await consumeLinkToken(request.body.token);
      if (!pending) {
        sendError(reply, 400, 'validation', 'That link is invalid or has expired. Request a fresh one.');
        return undefined;
      }

      // The consumed single-use token proves control of `pending.email`, so
      // find-or-login: sign into the account that already owns the email (a
      // returning user on a fresh device), else upgrade the requesting guest row
      // to claim it (first-time link). The fresh JWT carries `guest:false`, so
      // the clicking device adopts the identity through the same session-store
      // path as guest sign-in.
      const outcome = await loginOrLinkEmail(pending.email, pending.playerId, request.log);
      if (outcome.kind === 'gone') {
        // The requesting row was deleted between request and verify AND the email
        // is unclaimed — there is no account to land on.
        sendError(reply, 400, 'validation', 'That link is invalid or has expired. Request a fresh one.');
        return undefined;
      }
      return { token: outcome.token, player: outcome.player };
    },
  );

  fastify.post(
    '/auth/google',
    {
      // `requireAuth` identifies the guest to upgrade (same as the magic-link
      // REQUEST leg — the caller's session, not the token, says WHO is linking).
      // `accountLinkRateLimit` is the same 3/min-per-player limiter the magic
      // link uses, blunting link-spam from one identity.
      preHandler: [requireAuth, accountLinkRateLimit],
      schema: {
        body: googleSignInRequestSchema,
        response: {
          200: googleSignInResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const env = getEnv();
      // FEATURE GATE: the feature ships dormant. With the flag off or no client
      // ID provisioned, the endpoint is inert — a clean `not_found`, never a
      // 500 — so nothing about it is exercisable until an operator turns it on
      // (deploy/RUNBOOK.md's Google section). The web renders no button either,
      // so this is defense-in-depth against a direct call.
      if (!env.googleSigninEnabled || !env.googleClientId) {
        sendError(reply, 404, 'not_found', "Sign-in with Google isn't available.");
        return undefined;
      }

      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      // Verify the ID token SERVER-SIDE against our own client ID as the
      // audience — a token minted for a different app (or a forged one) fails
      // signature/audience/expiry checks here. Require a Google-VERIFIED email:
      // an unverified `email` must not become a linked identity (someone could
      // sign up to Google with an address they don't control). Any failure is a
      // single generic `validation` — no oracle for which check tripped.
      let email: string;
      try {
        const client = new OAuth2Client(env.googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: request.body.idToken,
          audience: env.googleClientId,
        });
        const payload = ticket.getPayload();
        if (!payload?.email || payload.email_verified !== true) {
          throw new Error('missing or unverified Google email');
        }
        email = payload.email.trim();
      } catch (error) {
        request.log.warn({ err: error }, 'google id-token verification failed');
        sendError(reply, 400, 'validation', "We couldn't verify that Google sign-in. Try again.");
        return undefined;
      }

      // From here this MIRRORS the magic-link verify: the Google-VERIFIED email
      // is proof of email control, so find-or-login — sign into the account that
      // already owns the email (a returning user on a fresh device, the case that
      // used to hit a hard "already in use" wall), else upgrade the current guest
      // row to claim it (first-time sign-up). The fresh JWT carries `guest:false`,
      // so the browser adopts the identity through the same session-store path.
      const outcome = await loginOrLinkEmail(email, caller.id, request.log);
      if (outcome.kind === 'gone') {
        // The caller's row was deleted between auth and the update AND the email
        // is unclaimed — there is no account to land on.
        sendError(reply, 400, 'validation', STALE_SESSION_MESSAGE);
        return undefined;
      }
      return { token: outcome.token, player: outcome.player };
    },
  );

  fastify.delete(
    '/account',
    {
      // Deletion is a sensitive, irreversible write — auth first, then a
      // dedicated tight rate limiter (3/min per player) on top of the global.
      preHandler: [requireAuth, accountDeleteRateLimit],
      schema: {
        response: {
          200: deleteAccountResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      // A guest row has no linked identity (email is NULL, `isGuest` already
      // true), so there is nothing to anonymize — reject cleanly rather than
      // scrubbing a throwaway guest. The UI only offers deletion to linked
      // accounts anyway, so this is the belt-and-suspenders server guard.
      if (caller.guest) {
        sendError(reply, 400, 'validation', 'No linked account to delete.');
        return undefined;
      }

      // SOFT-ANONYMIZE: scrub the PII columns and drop back to a guest-shaped
      // row, but KEEP the row and its id. A hard delete would CASCADE-erase the
      // account's `reports` / `player_blocks` (reporter AND reported sides) —
      // including open reports filed AGAINST this player — so keeping the row is
      // what preserves the moderation audit trail. `email → NULL` is fine under
      // the UNIQUE index (Postgres allows many NULLs). Owned word packs, games,
      // reports, and blocks are intentionally left in place, now owned by the
      // anonymized row. One UPDATE, columns only — no schema change.
      const db = getDb();
      await db
        .update(players)
        .set({
          email: null,
          displayName: 'Deleted player',
          // Reset to the same neutral default doodle guest creation uses (NOT
          // the jsonb `{}` default, which is not a well-formed `AvatarConfig`
          // and would fail `avatarConfigSchema` serialization anywhere the
          // scrubbed row is later read — e.g. a residual-token `GET
          // /players/me` or an admin/report view).
          avatar: DEFAULT_AVATAR,
          isGuest: true,
        })
        .where(eq(players.id, caller.id));

      // The still-valid JWT is NOT revoked here — there is no server-side
      // session-revocation infra today (auth verifies the JWT + a Redis
      // suspension check only, never a per-request DB load). The client drops
      // its token to end the session; the token lapses at natural expiry.
      return { ok: true } as const;
    },
  );

  // Dev-only magic-link inbox. Registered ONLY outside production
  // with the credential-free `'log'` provider, and hidden from the OpenAPI doc
  // — it exposes link tokens, so it must never exist in a real deployment. Lets
  // integration/e2e tests (and a developer) retrieve the link a real email
  // would have carried. Guarded twice: provider === 'log' AND not production.
  const env = getEnv();
  if (env.emailProvider === 'log' && process.env.NODE_ENV !== 'production') {
    fastify.get(
      '/auth/link/dev-inbox',
      {
        schema: {
          hide: true,
          response: {
            200: z.object({
              items: z.array(z.object({ to: z.string(), link: z.string(), at: z.number() })),
            }),
          },
        },
      },
      async () => ({ items: getRecentDevMagicLinks(20) }),
    );
  }
};
