import type { ErrorCode } from '@sketchy/shared/contract/errors';
import { copy } from '@/copy';

/**
 * The ONE place that maps every `ErrorCode` (the closed union shared by REST non-2xx
 * responses and socket ack failures, `@sketchy/shared/contract/errors`) to its
 * `copy.errors.*` line (arch/copy.md §9).
 *
 * WHY this exists: every error-surfacing component used to keep its own per-code `switch`
 * that fell through to the generic-500 line (`copy.errors.generic500`) on any code it didn't
 * happen to enumerate. That silently swallowed whole classes of error — most visibly a
 * moderation-`suspended` player, whose sanitized rejection showed up as the generic
 * "something broke on our end" message everywhere instead of the real explanation. A single
 * exhaustive table closes that fall-through class: the `satisfies Record<ErrorCode, string>`
 * makes a newly-added `ErrorCode` fail typecheck here until it's given a line, so no future
 * code can quietly regress to generic-500.
 *
 * Codes whose real copy is a FUNCTION needing runtime context the bare code can't carry
 * (`room_full`/`pair_limit` need a `max`, `name_taken_in_room` needs the taken name) map to
 * the generic fallback here. The handful of surfaces that actually hold that context keep a
 * local override on top of this baseline (e.g. the room route passes `maxPlayers` into
 * `copy.errors.roomFull(max)`) — this helper is the baseline, not a replacement for context.
 */
const COPY_BY_ERROR_CODE = {
  unauthorized: copy.errors.unauthorized,
  not_found: copy.errors.notFound,
  validation: copy.errors.validation,
  rate_limited: copy.errors.rateLimited,
  room_not_found: copy.errors.roomNotFound,
  // Parameterized (needs the room's max players) — a context-holding caller overrides.
  room_full: copy.errors.generic500,
  room_in_progress: copy.errors.roomInProgress,
  // Parameterized (needs the taken name) — a context-holding caller overrides.
  name_taken_in_room: copy.errors.generic500,
  not_host: copy.errors.notHost,
  not_your_turn: copy.errors.notYourTurn,
  wrong_phase: copy.errors.wrongPhase,
  already_voted: copy.errors.alreadyVoted,
  clue_repeated: copy.errors.clueRepeated,
  clue_is_secret_word: copy.errors.clueIsSecretWord,
  kicked: copy.errors.kicked,
  pack_forbidden: copy.errors.packForbidden,
  // Parameterized (needs the pair/pack cap) — a context-holding caller overrides.
  pair_limit: copy.errors.generic500,
  profanity: copy.errors.profanity,
  voice_disabled: copy.errors.voiceDisabled,
  account_required: copy.errors.accountRequired,
  suspended: copy.errors.suspended,
  internal: copy.errors.generic500,
} satisfies Record<ErrorCode, string>;

/**
 * Best user-facing copy for an `ErrorCode`. Every code resolves to a real line (never
 * `undefined`); parameterized/context-specific codes resolve to the generic fallback — see
 * the table's doc comment for why a caller with the missing context should override on top.
 */
export function copyForError(code: ErrorCode): string {
  return COPY_BY_ERROR_CODE[code];
}
