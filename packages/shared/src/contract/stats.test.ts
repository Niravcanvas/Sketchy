import { describe, expect, it } from 'vitest';
import { gamesTodayResponseSchema } from './stats.js';

describe('stats contract (post-launch-backlog item 4 — public games-today counter)', () => {
  it('validates a non-negative integer count', () => {
    expect(gamesTodayResponseSchema.parse({ gamesToday: 0 })).toEqual({ gamesToday: 0 });
    expect(gamesTodayResponseSchema.parse({ gamesToday: 42 })).toEqual({ gamesToday: 42 });
  });

  it('rejects a negative count', () => {
    expect(() => gamesTodayResponseSchema.parse({ gamesToday: -1 })).toThrow();
  });

  it('rejects a non-integer count', () => {
    expect(() => gamesTodayResponseSchema.parse({ gamesToday: 1.5 })).toThrow();
  });

  it('rejects a missing or wrong-typed field', () => {
    expect(() => gamesTodayResponseSchema.parse({})).toThrow();
    expect(() => gamesTodayResponseSchema.parse({ gamesToday: '5' })).toThrow();
  });
});
