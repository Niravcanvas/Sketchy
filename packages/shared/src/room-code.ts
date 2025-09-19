/**
 * Room-code alphabet (conventions.md §4): 31 chars, excludes 0/O/1/I/L so
 * spoken/handwritten codes never hit an ambiguous character. Codes are always
 * rendered uppercase; this constant is the single source of truth for
 * generation (server) and validation (client + server).
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Room codes are fixed-length (conventions.md §4). */
export const ROOM_CODE_LENGTH = 5;

/**
 * Custom word-pack share codes reuse `ROOM_CODE_ALPHABET`
 * above at a longer length rather than inventing a second alphabet — same
 * unambiguous character set, more combinations for a namespace that (unlike
 * room codes) never expires on a 24h TTL.
 */
export const PACK_SHARE_CODE_LENGTH = 8;

/**
 * Normalizes a user-typed room code before validation/lookup: inputs
 * normalize case per conventions.md §4 (codes are always rendered/stored
 * uppercase). Only trims whitespace and upper-cases — does NOT remap
 * visually-similar characters (e.g. '0' is never coerced to 'O'), since the
 * alphabet was chosen precisely to avoid needing that kind of guesswork.
 */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * True if `input` is a well-formed room code: exactly `ROOM_CODE_LENGTH`
 * characters, all drawn from `ROOM_CODE_ALPHABET`. Does not normalize —
 * callers should `normalizeRoomCode()` user input first (this keeps the two
 * concerns — "clean it up" vs. "is it valid" — independently testable).
 */
export function isValidRoomCode(input: string): boolean {
  if (input.length !== ROOM_CODE_LENGTH) {
    return false;
  }
  for (const char of input) {
    if (!ROOM_CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}
