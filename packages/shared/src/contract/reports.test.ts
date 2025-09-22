import { describe, expect, it } from 'vitest';
import { createReportRequestSchema, reportReasonSchema } from './reports.js';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('reports contract (phase 16)', () => {
  it('accepts the four documented reasons and rejects others', () => {
    for (const reason of ['name', 'chat', 'clue', 'other']) {
      expect(reportReasonSchema.parse(reason)).toBe(reason);
    }
    expect(() => reportReasonSchema.parse('spam')).toThrow();
  });

  it('accepts a minimal and a full report body', () => {
    expect(createReportRequestSchema.parse({ reportedPlayerId: UUID, reason: 'other' })).toEqual({
      reportedPlayerId: UUID,
      reason: 'other',
    });
    const full = createReportRequestSchema.parse({
      reportedPlayerId: UUID,
      roomCode: 'AB2CD',
      reason: 'chat',
      detail: '  rude  ',
    });
    expect(full.roomCode).toBe('AB2CD');
    expect(full.detail).toBe('rude'); // trimmed
  });

  it('rejects a bad player id and an over-long detail', () => {
    expect(() => createReportRequestSchema.parse({ reportedPlayerId: 'nope', reason: 'other' })).toThrow();
    expect(() =>
      createReportRequestSchema.parse({ reportedPlayerId: UUID, reason: 'other', detail: 'x'.repeat(501) }),
    ).toThrow();
  });
});
