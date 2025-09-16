import { z } from 'zod';
import { okResponseSchema } from './packs.js';
import { playerSchema } from './players.js';

/**
 * Email magic-link account-linking wire contract (system-design.md
 * §6; api-contract.md §1 "Accounts/auth").
 * ADDITIVE to `/v1`. The flow upgrades the caller's EXISTING guest row in
 * place — `playerId` never changes, history is preserved (system-design.md
 * §6): a guest links an email, clicks the link, and their row flips to
 * `is_guest = false`.
 *
 * Both endpoints are deliberately enumeration-safe: `request` always returns
 * the same `{ ok: true }` regardless of whether the email is free, already
 * linked, or malformed-but-parseable, so an attacker can't probe which emails
 * have accounts; `verify` returns a generic error for any bad/expired/consumed
 * token without distinguishing the cases.
 */

/**
 * `POST /v1/auth/link/request` request body — the authenticated guest asks for
 * a magic link to `email`. Sent (or, with no transactional-email provider
 * configured, dev-logged) to the
 * address; nothing about the account changes until the link is verified.
 */
export const linkRequestSchema = z.object({
  email: z.email().max(200),
});

export type LinkRequest = z.infer<typeof linkRequestSchema>;

/** `POST /v1/auth/link/request` response — the enumeration-safe constant ack.
 * Its own shape (rather than the shared `{ ok: true }`) so the honest copy
 * ("if that email can be linked, a link is on its way") reads as intentional. */
export const linkRequestResponseSchema = z.object({
  ok: z.literal(true),
});

export type LinkRequestResponse = z.infer<typeof linkRequestResponseSchema>;

/**
 * `POST /v1/auth/link/verify` request body — consumes a single-use magic-link
 * token (from the emailed/dev-logged link). The token itself is the proof of
 * email control, so this endpoint needs NO session auth: whoever holds the
 * token (the person who received the email) is the one linking. On success the
 * bound guest row is upgraded and a FRESH JWT (now `guest: false`) is returned
 * so the clicking device becomes that account.
 */
export const linkVerifyRequestSchema = z.object({
  token: z.string().min(1).max(200),
});

export type LinkVerifyRequest = z.infer<typeof linkVerifyRequestSchema>;

/** `POST /v1/auth/link/verify` response — same `{ token, player }` shape as
 * `POST /auth/guest`, so the client adopts the upgraded identity through the
 * exact same code path it already uses for guest sign-in. `player.isGuest` is
 * now `false`. */
export const linkVerifyResponseSchema = z.object({
  token: z.string(),
  player: playerSchema,
});

export type LinkVerifyResponse = z.infer<typeof linkVerifyResponseSchema>;

/**
 * `POST /v1/auth/google` request body — an ADDITIONAL identity-link method
 * alongside the magic link (system-design.md §6). `idToken` is the Google ID
 * token (a JWT) minted by Google Identity Services in the browser; the server
 * verifies it against the configured OAuth client ID and, on success, upgrades
 * the CALLER's guest row in place using the Google-verified email — the exact
 * same `players.email` linked-identity the magic link sets, so there is no
 * separate identity store to keep in sync (and account deletion's PII scrub
 * already covers Google-linked accounts unchanged).
 *
 * Ships flag-gated and DORMANT: with `GOOGLE_SIGNIN_ENABLED` off (the default)
 * or no `GOOGLE_CLIENT_ID` provisioned, the endpoint returns a clean
 * `not_found` — it never 500s — and the web never renders the button.
 */
export const googleSignInRequestSchema = z.object({
  // A Google ID token is a compact JWT; a generous ceiling accepts real tokens
  // (typically well under 2 KB) while still bounding the body.
  idToken: z.string().min(1).max(8192),
});

export type GoogleSignInRequest = z.infer<typeof googleSignInRequestSchema>;

/** `POST /v1/auth/google` response — the SAME `{ token, player }` shape as the
 * magic-link verify, so the client adopts the upgraded (now `guest: false`)
 * identity through the exact same session-store path. Reuses
 * `linkVerifyResponseSchema` rather than redeclaring it — the two responses are
 * deliberately identical (both are "guest row upgraded, here's the fresh JWT"). */
export const googleSignInResponseSchema = linkVerifyResponseSchema;

export type GoogleSignInResponse = z.infer<typeof googleSignInResponseSchema>;

/**
 * `DELETE /v1/account` response — the self-service account-deletion the
 * privacy policy promises. Authenticated, NO request body; reuses the shared
 * `{ ok: true }` envelope. Additive to `/v1`.
 *
 * The server SOFT-ANONYMIZES rather than hard-deletes: it scrubs the PII
 * columns (`email → NULL`, `displayName → 'Deleted player'`, `avatar →` the
 * neutral default doodle) and flips `isGuest` back to `true`, but KEEPS the row and its id. That's a
 * deliberate design choice, not a shortcut — a hard delete would CASCADE-erase
 * the account's `reports` and `player_blocks` (including open reports filed
 * AGAINST them), destroying the moderation audit trail. Keeping the row leaves
 * every FK intact, so the safety record survives the account.
 *
 * Only a LINKED account has an identity to delete — a guest row carries no
 * linked email, so `DELETE /account` from a guest is rejected with
 * `validation` rather than anonymizing a throwaway identity.
 */
export const deleteAccountResponseSchema = okResponseSchema;

export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;
