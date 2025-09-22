import { describe, expect, it } from 'vitest';
import {
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './room-code.js';

describe('ROOM_CODE_ALPHABET', () => {
  it('has 31 unique characters', () => {
    expect(ROOM_CODE_ALPHABET.length).toBe(31);
    expect(new Set(ROOM_CODE_ALPHABET.split('')).size).toBe(31);
  });

  it('excludes ambiguous characters 0/O/1/I/L', () => {
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(ROOM_CODE_ALPHABET.includes(ambiguous)).toBe(false);
    }
  });
});

describe('normalizeRoomCode', () => {
  it('trims whitespace and upper-cases', () => {
    expect(normalizeRoomCode('  ab3cd  ')).toBe('AB3CD');
  });

  it('does not remap visually-similar characters', () => {
    expect(normalizeRoomCode('0o1il')).toBe('0O1IL');
  });
});

describe('isValidRoomCode', () => {
  it('accepts a well-formed code', () => {
    expect(isValidRoomCode('AB3CD')).toBe(true);
    expect(ROOM_CODE_LENGTH).toBe(5);
  });

  it('rejects the wrong length', () => {
    expect(isValidRoomCode('AB3C')).toBe(false);
    expect(isValidRoomCode('AB3CDE')).toBe(false);
  });

  it('rejects characters outside the alphabet', () => {
    expect(isValidRoomCode('AB3C0')).toBe(false); // '0' is excluded
    expect(isValidRoomCode('ab3cd')).toBe(false); // lowercase not accepted, un-normalized
  });
});
