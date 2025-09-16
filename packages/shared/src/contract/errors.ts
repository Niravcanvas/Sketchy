import { z } from 'zod';

/**
 * The closed `ErrorCode` union shared by REST non-2xx responses and socket ack
 * failures (api-contract.md §0). UI copy per code lives in copy.md §9.
 *
 * Includes every code listed in api-contract.md §0 (including `'internal'`,
 * folded back into that doc's enumerated list during a later contract
 * audit — it originally shipped as a gap-fill for uncaught 500s
 * ahead of the doc catching up, api-contract.md §0's envelope shape having
 * always required every non-2xx response to carry a code).
 *
 * `'voice_disabled'` — the clean, closed-shape error `GET
 * /rooms/:code/voice-token` (and the `voice:state` socket ack) return when
 * the `VOICE_ENABLED` kill-switch is off; UI copy in copy.md §9.
 *
 * `'account_required'` / `'suspended'` are ADDITIVE codes (new
 * enum values, never a rename/removal — safe under the frozen-`/v1` additive
 * rule, api-contract.md §0). `account_required`: a guest tried to use a
 * public-matchmaking surface that requires a linked account (create/join a
 * public room, enqueue quick-join) — private rooms never return it.
 * `suspended`: a moderation-suspended player's REST call or socket handshake
 * is rejected with a sanitized message (copy.md §9; the reason is never
 * leaked to the client). Both have copy.md §9 rows.
 */
export const errorCodeSchema = z.enum([
  'unauthorized',
  'not_found',
  'validation',
  'rate_limited',
  'room_not_found',
  'room_full',
  'room_in_progress',
  'name_taken_in_room',
  'not_host',
  'not_your_turn',
  'wrong_phase',
  'already_voted',
  'clue_repeated',
  'clue_is_secret_word',
  'kicked',
  'pack_forbidden',
  'pair_limit',
  'profanity',
  'voice_disabled',
  'account_required',
  'suspended',
  'internal',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** The error envelope shape shared by REST and socket acks (api-contract.md §0). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
