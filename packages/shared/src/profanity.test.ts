import { describe, expect, it } from 'vitest';
import { containsProfanity, normalizeForFilter } from './profanity.js';

describe('normalizeForFilter', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeForFilter('CAFÉ')).toBe('cafe');
  });

  it('un-leets common digit/symbol substitutions', () => {
    expect(normalizeForFilter('sh1t')).toBe('shit');
    expect(normalizeForFilter('@ss')).toBe('ass'); // double letters are left alone
    expect(normalizeForFilter('f0rty')).toBe('forty');
  });

  it('removes non-letters, collapsing spaced-out evasion', () => {
    expect(normalizeForFilter('f u c k')).toBe('fuck');
    expect(normalizeForFilter('f.u.c.k.')).toBe('fuck');
  });

  it('collapses repeated letters', () => {
    expect(normalizeForFilter('fuuuuuck')).toBe('fuck');
    expect(normalizeForFilter('heeeellllooo')).toBe('helo');
  });
});

describe('containsProfanity — unambiguous slurs/strong profanity', () => {
  it('flags a clean match', () => {
    expect(containsProfanity('fuck')).toBe(true);
    expect(containsProfanity('shit')).toBe(true);
  });

  it('flags inflections via substring matching', () => {
    expect(containsProfanity('motherfucker')).toBe(true);
    expect(containsProfanity('bullshit')).toBe(true);
    expect(containsProfanity('dipshit')).toBe(true);
  });

  it('flags leetspeak bypass attempts', () => {
    expect(containsProfanity('sh1t')).toBe(true);
    expect(containsProfanity('a55hole')).toBe(true);
    expect(containsProfanity('f u c k')).toBe(true);
    expect(containsProfanity('fuuuuuck')).toBe(true);
  });

  it('does not flag clean text', () => {
    expect(containsProfanity('SketchMaster')).toBe(false);
    expect(containsProfanity('Sunny Afternoon')).toBe(false);
  });
});

describe('containsProfanity — Scunthorpe-prone exact-match words', () => {
  it('does not flag innocent words containing the short word as a substring', () => {
    expect(containsProfanity('class')).toBe(false);
    expect(containsProfanity('assassin')).toBe(false);
    expect(containsProfanity('hello')).toBe(false);
    expect(containsProfanity('Scunthorpe')).toBe(false);
    expect(containsProfanity('cockpit')).toBe(false);
    expect(containsProfanity('title')).toBe(false);
    expect(containsProfanity('document')).toBe(false);
    expect(containsProfanity('therapist')).toBe(false);
    expect(containsProfanity('Mississippi')).toBe(false);
  });

  it('does not flag legitimate place names that collapse-would-collide (Niger/Nigeria)', () => {
    // "nigger" only differs from "niger"/"nigeria" by a doubled letter — collapsing
    // double letters (not just 3+ runs) would make these indistinguishable.
    expect(containsProfanity('Niger')).toBe(false);
    expect(containsProfanity('Nigeria')).toBe(false);
  });

  it('still flags the slur itself and its plural via substring', () => {
    expect(containsProfanity('nigger')).toBe(true);
    expect(containsProfanity('niggers')).toBe(true);
  });

  it('flags the exact short word on its own', () => {
    expect(containsProfanity('ass')).toBe(true);
    expect(containsProfanity('hell')).toBe(true);
    expect(containsProfanity('cunt')).toBe(true);
  });

  it('flags a leetspeak-disguised exact-match word', () => {
    expect(containsProfanity('a55')).toBe(true);
    expect(containsProfanity('@ss')).toBe(true);
  });

  it('flags the exact word even amid other clean words (space-separated tokens)', () => {
    expect(containsProfanity('you ass here')).toBe(true);
  });
});

describe('containsProfanity — strict mode (phase 16 public rooms)', () => {
  it('catches milder terms only when strict is set', () => {
    for (const word of ['damn', 'crap', 'goddamn', 'dumbass', 'wank', 'bugger']) {
      expect(containsProfanity(word)).toBe(false);
      expect(containsProfanity(word, { strict: true })).toBe(true);
    }
  });

  it('still lets clean words through in strict mode (no new Scunthorpe collisions)', () => {
    for (const clean of ['class', 'hello', 'assassin', 'grass', 'therapist', 'document']) {
      expect(containsProfanity(clean, { strict: true })).toBe(false);
    }
  });

  it('strong profanity is caught regardless of strict', () => {
    expect(containsProfanity('fuck', { strict: true })).toBe(true);
    expect(containsProfanity('fuck')).toBe(true);
  });
});
