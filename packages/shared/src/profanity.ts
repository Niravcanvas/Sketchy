/**
 * Profanity filter applied to display names, clues, chat, and pack content
 * (conventions.md §4). Single shared word list + normalizer, English-only at
 * launch — this is a DOCUMENTED LIMITATION: the filter does not catch
 * profanity written in other languages, nor determined creative evasion
 * beyond the leetspeak substitutions and repeated-letter collapsing below.
 * It ships to the client too (bundled in `@sketchy/shared`) — accepted
 * per conventions.md §4, since server-side `containsProfanity` calls are
 * still the actual enforcement (client-side use is best-effort UX only).
 */

/** Leetspeak digit/symbol → letter substitutions checked before matching. */
const LEET_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};

const LEET_PATTERN = new RegExp(`[${Object.keys(LEET_MAP).join('')}]`, 'g');

/**
 * Collapses a run of 3-OR-MORE of the same letter down to one: "fuuuck" /
 * "fuuuuuck" → "fuck" (elongation evasion). Deliberately leaves ORDINARY
 * English double letters (2-in-a-row) untouched — collapsing those too
 * would turn "nigger" into "niger", colliding with the country name
 * Niger/Nigeria, and "piss" into "pis", colliding with "therapist" — the
 * exact Scunthorpe-style false positive this filter otherwise guards
 * against. Real elongation evasion is almost always 3+ repeats anyway.
 */
function collapseRepeats(text: string): string {
  return text.replace(/(.)\1{2,}/g, '$1');
}

/** Lowercase → strip diacritics (NFD) → un-leet. Shared by both exports below. */
function preNormalize(text: string): string {
  const lowered = text.toLowerCase();
  const deaccented = lowered.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return deaccented.replace(LEET_PATTERN, (char) => LEET_MAP[char] ?? char);
}

/**
 * Normalizes text for profanity matching: lowercase, diacritics stripped,
 * leetspeak un-mapped, every non-letter character removed (so spaced-out
 * evasion like "f u c k" collapses to "fuck"), then repeated letters
 * collapsed to one. The result has no word boundaries — it's meant for
 * substring matching against unambiguous words, not exact matching.
 */
export function normalizeForFilter(text: string): string {
  const lettersOnly = preNormalize(text).replace(/[^a-z]/g, '');
  return collapseRepeats(lettersOnly);
}

/**
 * Same pipeline as `normalizeForFilter`, but preserves word boundaries
 * (splits on runs of non-letter characters instead of deleting them) so
 * short/ambiguous words can be matched as a WHOLE token rather than as a
 * substring — see `EXACT_MATCH_PROFANITY` below.
 */
function tokenizeForFilter(text: string): string[] {
  const matches = preNormalize(text).match(/[a-z]+/g) ?? [];
  return matches.map(collapseRepeats);
}

/**
 * Slurs and strong profanity long/distinctive enough to match safely as a
 * SUBSTRING of the normalized (space-stripped) text. Listed at their most
 * distinctive root only — substring matching catches inflections for free:
 * "fuck" also flags "fucker"/"fucking"/"motherfucker"; "shit" also flags
 * "bullshit"/"dipshit"/"shitty"; "faggot" also flags "faggots"; etc.
 */
const SUBSTRING_PROFANITY = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'whore',
  'slut',
  'douchebag',
  'wanker',
  'bollocks',
  'twat',
  'piss',
  'nigger',
  'nigga',
  'faggot',
  'chink',
  'gook',
  'kike',
  'beaner',
  'towelhead',
  'raghead',
  'wetback',
  'retard',
  'tranny',
  'jackass',
  'cocksucker',
  'dickhead',
];

/**
 * Short/common words that would false-positive as a substring match — the
 * classic "Scunthorpe problem". Each of these is a real substring of
 * common, innocent English words or place names: "ass" ⊂ "class" /
 * "assassin" / "grass" / "embarrassed"; "cunt" ⊂ "Scunthorpe"; "cock" ⊂
 * "cockpit" / "peacock"; "tit" / "tits" ⊂ "title" / "constitute" /
 * "attitude"; "cum" ⊂ "cucumber" / "document" / "circumstance"; "hell" ⊂
 * "hello" / "shell"; "homo" ⊂ "homogeneous"; "rapist" ⊂ "therapist";
 * "spic" ⊂ "spice" / "despicable"; "paki" ⊂ "Pakistan" / "Pakistani".
 * Matched ONLY when the entire normalized token equals one of these.
 */
const EXACT_MATCH_PROFANITY = [
  'ass',
  'cunt',
  'cock',
  'tit',
  'tits',
  'cum',
  'hell',
  'dyke',
  'fag',
  'homo',
  'rapist',
  'spic',
  'paki',
];

const SUBSTRING_PROFANITY_NORMALIZED = SUBSTRING_PROFANITY.map(normalizeForFilter);
const EXACT_MATCH_PROFANITY_NORMALIZED = new Set(EXACT_MATCH_PROFANITY.map(normalizeForFilter));

/**
 * STRICT-only additions, applied to public-room chat/clue profanity filtering.
 * Applied ONLY when `strict` is set — public matchmaking rooms use it;
 * private/friends rooms keep the default filter, since a table of friends
 * self-polices and over-filtering inside jokes is worse there than here.
 * Milder-but-still-vulgar terms, split the same two ways as the base list:
 * distinctive substrings that can't Scunthorpe-collide (no common word
 * contains "goddamn"/"dumbass"), and whole-token exact matches for short
 * ambiguous ones. Still English-only and best-effort — the same documented
 * limitation the base filter carries.
 */
const STRICT_SUBSTRING = ['goddamn', 'dumbass'];
const STRICT_EXACT_MATCH = [
  'damn',
  'crap',
  'arse',
  'arsehole',
  'prick',
  'skank',
  'wank',
  'knob',
  'tosser',
  'bugger',
  'bloody',
];

const STRICT_SUBSTRING_NORMALIZED = STRICT_SUBSTRING.map(normalizeForFilter);
const STRICT_EXACT_MATCH_NORMALIZED = new Set(STRICT_EXACT_MATCH.map(normalizeForFilter));

/**
 * True if `text` contains profanity, checked two ways: unambiguous
 * slurs/strong profanity as a substring of the fully normalized text
 * (catches leetspeak, diacritics, spacing, and letter-elongation evasion);
 * short Scunthorpe-prone words as an exact match against a whole
 * normalized token (never a substring, so "class"/"assassin"/"hello"
 * don't false-positive on "ass"/"hell").
 *
 * `strict` layers the public-room extras on top — same two matching
 * strategies, a modestly wider net for the higher-stakes stranger context.
 */
export function containsProfanity(text: string, options?: { strict?: boolean }): boolean {
  const normalizedWhole = normalizeForFilter(text);
  if (SUBSTRING_PROFANITY_NORMALIZED.some((word) => normalizedWhole.includes(word))) {
    return true;
  }
  const tokens = tokenizeForFilter(text);
  if (tokens.some((token) => EXACT_MATCH_PROFANITY_NORMALIZED.has(token))) {
    return true;
  }
  if (options?.strict) {
    if (STRICT_SUBSTRING_NORMALIZED.some((word) => normalizedWhole.includes(word))) {
      return true;
    }
    if (tokens.some((token) => STRICT_EXACT_MATCH_NORMALIZED.has(token))) {
      return true;
    }
  }
  return false;
}
