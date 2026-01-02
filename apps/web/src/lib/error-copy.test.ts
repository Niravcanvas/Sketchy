import { errorCodeSchema, type ErrorCode } from '@sketchy/shared/contract/errors';
import { describe, expect, it } from 'vitest';
import { copy } from '@/copy';
import { copyForError } from './error-copy';

describe('copyForError', () => {
  it('maps `suspended` to the real suspended copy, never the generic-500 fallback', () => {
    // The whole reason this helper exists: a moderation-suspended player used to fall through
    // every per-component switch to `generic500`. Guard against that exact regression.
    expect(copyForError('suspended')).toBe(copy.errors.suspended);
    expect(copyForError('suspended')).not.toBe(copy.errors.generic500);
  });

  it('maps `account_required` to the account copy', () => {
    expect(copyForError('account_required')).toBe(copy.errors.accountRequired);
    expect(copyForError('account_required')).not.toBe(copy.errors.generic500);
  });

  it('maps `internal` to the generic fallback', () => {
    expect(copyForError('internal')).toBe(copy.errors.generic500);
  });

  it('returns a non-empty string for EVERY ErrorCode (no code resolves to undefined)', () => {
    for (const code of errorCodeSchema.options as readonly ErrorCode[]) {
      const line = copyForError(code);
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
