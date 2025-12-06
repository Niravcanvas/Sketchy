# Undercover Game — Research

Scraped and compiled 2026-07-02 from ~15 live sources (apps, web clones, a paper-rules variant, and
two open-source codebases) to serve as raw material for planning your own build of the Undercover
party game.

## Files

1. **[01-GAME-RULES.md](01-GAME-RULES.md)** — the core synthesized rule set: roles, setup, turn
   structure, voting, win conditions, scoring. Start here.
2. **[02-WORD-PAIRS.md](02-WORD-PAIRS.md)** — real example word pairs by category/difficulty, the
   design principle behind a "good" pair, and the data format used by an existing implementation.
3. **[03-SPECIAL-ROLES-VARIANTS.md](03-SPECIAL-ROLES-VARIANTS.md)** — optional special roles
   (Goddess of Justice, Lovers, Mr. Meme, etc.), tie-vote resolution options, and a paper/no-app
   variant with its own house rules.
4. **[04-REFERENCE-IMPLEMENTATIONS.md](04-REFERENCE-IMPLEMENTATIONS.md)** — two open-source
   implementations examined for architecture and algorithm reference (role assignment, win-condition
   state machine, tech stack choices).
5. **[05-SOURCES-RAW.md](05-SOURCES-RAW.md)** — the raw, per-source scraped excerpts everything
   above was distilled from, with URLs, for traceability.

## Quick Orientation

- **Roles**: Civilian (majority, shares one word) / Undercover (minority, gets a related-but-
  different word) / Mister White (no word at all, can steal the win with a lucky guess).
- **Loop**: Describe your word with one clue each → discuss/accuse → vote out one player → check
  win conditions → repeat.
- **This rule set is not proprietary to one app** — it was cross-validated across an official
  commercial app, several independent clones, a paper-and-pen variant, and two unrelated
  open-source codebases, all implementing essentially the same core mechanics. Safe to build against
  without licensing concerns for the base rules (word-pair _content_, brand names, and specific
  special-role names/flavor text belong to their respective apps — treat those as inspiration, not
  copy sources).

## Open Questions Worth Deciding Before/While Planning

These are genuine forks in the road across the sources — no single "correct" answer, pick what fits
your vision:

- **Wrong-vote consequence**: most sources just move to the next round if the vote misses; one
  source (pocketparty) eliminates the wrongly-accused player instead. Which feels better for your
  game?
- **Tie-vote rule**: rock-paper-scissors vs. sudden-death re-clue-and-revote vs. a dedicated
  tie-breaker role vs. simple re-vote.
- **Play mode priority for v1**: pass-and-play (one device), same-room multiplayer (each own phone,
  local room code), or full remote/online — building all three is a lot; most competitors started
  with pass-and-play and added online later.
- **Scoring**: track persistent points (2/6/10 split seen in the market leader) or keep it purely
  single-game bragging rights?
- **Special roles**: worth planning your data model to support them later even if you don't build
  them for v1 (they all just add conditional logic on top of the core elimination loop).

Feed these five files into whatever planning process you're running next — they're written to be
self-contained and skimmable on their own.
