import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@sketchy/shared/room-code';
import { getRedis } from '../db/client.js';

/** Room-code claim TTL matches the room TTL (data-model.md §2). */
const LOCK_TTL_SECONDS = 24 * 60 * 60;

/** Collision retries before giving up (pinned decision) — at ~28.6M
 * combinations (conventions.md §4), 5 collisions in a row is already
 * astronomically unlikely at this project's room-count scale. */
const MAX_ATTEMPTS = 5;

function lockKey(code: string): string {
  return `room:${code}:lock`;
}

/** Cryptographically-random room code drawn from the unambiguous alphabet
 * (conventions.md §4) — `Math.random()` is never used for anything
 * room-code-adjacent (that ban is enforced in `packages/engine` by eslint,
 * but the same reasoning applies here: codes gate real room access). */
function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Allocates a fresh, unclaimed room code: generates a random code and claims
 * it with `SET room:{code}:lock 1 NX EX 86400` (data-model.md §2), retrying
 * on collision up to `MAX_ATTEMPTS` times. Returns `null` if every attempt
 * collided (the route layer maps that to the `internal` error code) — this
 * module never throws, mirroring the engine's "reducers never throw" spirit
 * for I/O-adjacent code that callers must handle explicitly.
 */
export async function allocateRoomCode(): Promise<string | null> {
  const redis = getRedis();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = randomRoomCode();
    const claimed = await redis.set(lockKey(code), '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    if (claimed === 'OK') {
      return code;
    }
  }
  return null;
}
