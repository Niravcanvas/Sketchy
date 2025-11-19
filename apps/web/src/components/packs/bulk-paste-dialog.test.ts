import { describe, expect, it } from 'vitest';
import { parsePastedPairs } from './bulk-paste-dialog';

describe('parsePastedPairs', () => {
  it('parses the research-02 "word;word" portable format, one pair per line', () => {
    const parsed = parsePastedPairs('sofa;armchair\nmustache;beard', []);
    expect(parsed).toEqual([
      { raw: 'sofa;armchair', wordA: 'sofa', wordB: 'armchair', issue: null },
      { raw: 'mustache;beard', wordA: 'mustache', wordB: 'beard', issue: null },
    ]);
  });

  it('trims whitespace around words and skips blank lines', () => {
    const parsed = parsePastedPairs('\n  cat ; dog  \n\n', []);
    expect(parsed).toEqual([{ raw: 'cat ; dog', wordA: 'cat', wordB: 'dog', issue: null }]);
  });

  it('flags a line with no semicolon (or more than one) as malformed', () => {
    expect(parsePastedPairs('catdog', [])[0]?.issue).toBe('malformed');
    expect(parsePastedPairs('cat;dog;fox', [])[0]?.issue).toBe('malformed');
  });

  it('flags a line with an empty side as malformed', () => {
    expect(parsePastedPairs('cat;', [])[0]?.issue).toBe('malformed');
    expect(parsePastedPairs(';dog', [])[0]?.issue).toBe('malformed');
  });

  it('flags a word over 40 chars as too-long', () => {
    const longWord = 'x'.repeat(41);
    expect(parsePastedPairs(`${longWord};dog`, [])[0]?.issue).toBe('too-long');
  });

  it('flags a duplicate against an existing pair (case-sensitive exact match)', () => {
    const existing = [{ wordA: 'Sofa', wordB: 'Armchair' }];
    expect(parsePastedPairs('Sofa;Armchair', existing)[0]?.issue).toBe('duplicate');
    // Different case is NOT flagged as a duplicate — mirrors the DB's exact-match unique
    // constraint (data-model.md §1), not a case-insensitive one.
    expect(parsePastedPairs('sofa;armchair', existing)[0]?.issue).toBeNull();
  });

  it('flags a duplicate WITHIN the pasted batch itself, not just against existingPairs', () => {
    const parsed = parsePastedPairs('cat;dog\ncat;dog', []);
    expect(parsed[0]?.issue).toBeNull();
    expect(parsed[1]?.issue).toBe('duplicate');
  });

  it('flags near-identical words (same word on both sides, case/whitespace-insensitive)', () => {
    expect(parsePastedPairs('Cat;cat', [])[0]?.issue).toBe('near-identical');
    expect(parsePastedPairs(' Cat ; Cat', [])[0]?.issue).toBe('near-identical');
  });

  it('returns an empty array for empty/whitespace-only input', () => {
    expect(parsePastedPairs('', [])).toEqual([]);
    expect(parsePastedPairs('   \n  \n', [])).toEqual([]);
  });
});
