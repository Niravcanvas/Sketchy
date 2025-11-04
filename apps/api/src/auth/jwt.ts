import { jwtVerify, SignJWT } from 'jose';
import { getEnv } from '../env.js';

/** HS256 per system-design.md §6 — the only algorithm this app signs or accepts. */
const ALG = 'HS256';

/** 180-day expiry (system-design.md §6) — long-lived, no refresh tokens at this scale. */
const TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;

export interface PlayerTokenClaims {
  playerId: string;
  guest: boolean;
  /** Epoch ms. */
  issuedAt: number;
  /** Epoch ms. */
  expiresAt: number;
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Signs a guest/player JWT: `{sub: playerId, guest}`, HS256, 180-day expiry
 * (system-design.md §6). Always signs with the CURRENT secret (`JWT_SECRET`)
 * — `JWT_SECRET_PREVIOUS` is verify-only, for rotation windows.
 */
export async function signPlayerToken(playerId: string, isGuest: boolean): Promise<string> {
  const env = getEnv();
  if (!env.jwtSecret) {
    // Fail-fast in index.ts should have already refused to start production
    // without this; reaching here means that guard was bypassed somehow.
    throw new Error('JWT_SECRET is not set');
  }
  return new SignJWT({ guest: isGuest })
    .setProtectedHeader({ alg: ALG })
    .setSubject(playerId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(encodeSecret(env.jwtSecret));
}

/**
 * Verifies a player JWT, trying `JWT_SECRET` first and `JWT_SECRET_PREVIOUS`
 * next if it's set — the dual-secret rotation window (system-design.md §6).
 * Returns `null` on ANY failure (expired, wrong signature, malformed,
 * missing claims) — never throws, so callers can treat it as a plain
 * "valid or not" check.
 */
export async function verifyPlayerToken(token: string): Promise<PlayerTokenClaims | null> {
  const env = getEnv();
  const candidateSecrets = [env.jwtSecret, env.jwtSecretPrevious].filter(
    (secret): secret is string => Boolean(secret),
  );

  for (const secret of candidateSecrets) {
    try {
      const { payload } = await jwtVerify(token, encodeSecret(secret), { algorithms: [ALG] });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        return null;
      }
      return {
        playerId: payload.sub,
        guest: payload.guest === true,
        issuedAt: payload.iat * 1000,
        expiresAt: payload.exp * 1000,
      };
    } catch {
      // Wrong secret / expired / malformed — try the next secret, if any.
    }
  }
  return null;
}

/**
 * True once `claims` has passed the HALFWAY point of its own lifetime
 * (system-design.md §6: "silent re-issue on API use past the halfway
 * point") — derived from the token's own `iat`/`exp` rather than the
 * `TOKEN_TTL_SECONDS` constant, so it stays correct even for a token signed
 * under a different TTL in the past.
 */
export function isPastHalfLife(claims: PlayerTokenClaims, now: number = Date.now()): boolean {
  const halfLife = claims.issuedAt + (claims.expiresAt - claims.issuedAt) / 2;
  return now > halfLife;
}
