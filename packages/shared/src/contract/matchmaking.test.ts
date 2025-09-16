import { describe, expect, it } from 'vitest';
import {
  languageSchema,
  lobbyItemSchema,
  matchmakingQueueRequestSchema,
  matchmakingQueueResponseSchema,
  mmMatchedSchema,
} from './matchmaking.js';

describe('matchmaking contract (phase 16)', () => {
  it('normalizes and validates language codes', () => {
    expect(languageSchema.parse('EN')).toBe('en');
    expect(languageSchema.parse(' en ')).toBe('en');
    expect(languageSchema.parse('pt-br')).toBe('pt-br');
    expect(() => languageSchema.parse('english')).toThrow();
    expect(() => languageSchema.parse('e')).toThrow();
  });

  it('accepts a well-formed lobby item and queue request/response', () => {
    expect(
      lobbyItemSchema.parse({ code: 'AB2CD', hostName: 'Ada', playerCount: 3, maxPlayers: 12, language: 'en' }),
    ).toEqual({ code: 'AB2CD', hostName: 'Ada', playerCount: 3, maxPlayers: 12, language: 'en' });
    expect(matchmakingQueueRequestSchema.parse({ language: 'en' })).toEqual({ language: 'en' });
    expect(matchmakingQueueResponseSchema.parse({ status: 'queued' })).toEqual({ status: 'queued' });
    expect(() => matchmakingQueueResponseSchema.parse({ status: 'matched' })).toThrow();
  });

  it('mm:matched carries a room code', () => {
    expect(mmMatchedSchema.parse({ code: 'AB2CD' })).toEqual({ code: 'AB2CD' });
    expect(() => mmMatchedSchema.parse({ code: 'lower' })).toThrow();
  });
});
