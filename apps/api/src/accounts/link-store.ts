import { createHash, randomBytes } from 'node:crypto';
import { getRedis } from '../db/client.js';

/**
 * Pending magic-link tokens. A link token is short-lived
 * operational state — exactly what Redis is for (system-design.md §4.6) — so
 * it lives here, not in Postgres: `link:{sha256(token)}` → JSON
 * `{ playerId, email }`, `EX 900` (15 min). The DURABLE result of a successful
 * link (`players.email` + `is_guest=false`) is what lands in Postgres.
 *
 * Only the token's SHA-256 is used as the key — the raw token exists only in
 * the emailed/dev-logged URL and in the verifying request, never at rest, so a
 * Redis dump can't be replayed into account takeovers. `consume` is a single
 * atomic `GETDEL`, making every token strictly single-use (a double-click on
 * the link can't link twice, and a leaked-then-used token is immediately dead).
 */
const LINK_TTL_SECONDS = 15 * 60;

export interface PendingLink {
  playerId: string;
  email: string;
}

function linkKey(token: string): string {
  return `link:${createHash('sha256').update(token).digest('hex')}`;
}

/** Mints a fresh single-use token bound to `(playerId, email)` and stores it
 * with a 15-minute TTL. Returns the RAW token to embed in the magic-link URL. */
export async function createLinkToken(playerId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const payload: PendingLink = { playerId, email };
  await getRedis().set(linkKey(token), JSON.stringify(payload), 'EX', LINK_TTL_SECONDS);
  return token;
}

/** Atomically consumes a token (single-use): returns its `{ playerId, email }`
 * and deletes it, or `null` if it never existed / already expired / already
 * consumed. Uses `GETDEL` so two concurrent verifies can never both succeed. */
export async function consumeLinkToken(token: string): Promise<PendingLink | null> {
  const raw = await getRedis().getdel(linkKey(token));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PendingLink;
  } catch {
    return null;
  }
}
