import { describe, expect, it } from 'vitest';
import { errorCodeSchema, errorEnvelopeSchema } from './errors.js';

describe('errorEnvelopeSchema', () => {
  it('round-trips a valid envelope', () => {
    const envelope = { error: { code: 'room_not_found', message: 'Room not found.' } };
    const parsed = errorEnvelopeSchema.parse(envelope);
    expect(parsed).toEqual(envelope);
  });

  it('rejects an unknown error code', () => {
    const envelope = { error: { code: 'totally_made_up', message: 'nope' } };
    expect(() => errorEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects a missing message', () => {
    expect(() => errorEnvelopeSchema.parse({ error: { code: 'internal' } })).toThrow();
  });
});

describe('errorCodeSchema', () => {
  it('accepts every code listed in api-contract.md §0, plus internal', () => {
    const codes = [
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
    ];
    for (const code of codes) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }
  });
});
