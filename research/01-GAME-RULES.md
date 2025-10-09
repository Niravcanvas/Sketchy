# Undercover — Core Game Rules (Synthesized)

Compiled from ~15 sources (official app, clones, a paper/pen variant, and two open-source
implementations). Where sources disagree, the disagreement is noted rather than papered over.
See [05-SOURCES-RAW.md](05-SOURCES-RAW.md) for the raw excerpts this was built from.

## 1. Objective

A social deduction / bluffing party game, in the same family as Werewolf, Spyfall, and Codenames.
Everyone gets a secret word except one role, who gets nothing. Players describe their word one
clue at a time without saying it outright; the group votes each round to eliminate whoever seems
most suspicious. The minority factions win by surviving or by correctly guessing the majority's
word; the majority (Civilians) wins by voting out every minority player.

## 2. Roles

| Role             | Also called                        | Secret word                                                                                              | Goal                                                                                                  |
| ---------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Civilian**     | Citizen, Villager, "Normal Player" | The **majority word** — every Civilian gets the identical word                                           | Identify and eliminate all Undercovers and Mr. Whites                                                 |
| **Undercover**   | Infiltrator, Spy (in some clones)  | A **different but related word** from the same pair (e.g. Civilians get "Coffee", Undercovers get "Tea") | Blend in, survive, avoid detection                                                                    |
| **Mister White** | Mr. White, "Blank"                 | **No word at all**                                                                                       | Survive by not being caught, OR get caught and immediately guess the Civilians' word to steal the win |

Everyone's role and word are secret — even players who share a role/word don't know who else has it.
Word pairs are chosen so they're related enough to overlap (Undercover can describe theirs and sound
like a Civilian) but different enough that sharp clues expose the gap.

## 3. Setup

1. Gather players — **sources vary on the ideal range**: absolute minimum is 3 (some say 4), most
   apps cap around 20. Sweet spot most commonly cited is **6–12 players**.
2. A host/organizer (or the app) sets:
   - Total player count and names.
   - **Number of Undercovers** (typically 1–3, scaling with group size).
   - **Number of Mister Whites** (optional role; typically 0–2).
   - Word category / word pack (or custom word list).
3. Roles and the word pair are assigned randomly and secretly (in-app: tap to reveal privately;
   pass-and-play: each player privately views their word then passes the device/card on; paper
   version: folded slips of paper dealt out by the host).
4. Remaining players (players − Undercovers − Mister Whites) are all Civilians and all receive the
   identical majority word.

There's no single universal "role count table" across implementations — apps auto-suggest a
distribution based on player count (roughly: +1 Undercover per ~4 players, add a Mister White once
you have 5+ players) but always let the host override it manually.

## 4. Turn Structure (repeats every round)

### Phase 1 — Description / Clue Phase

- Starting with a random (or designated) first player, everyone goes in turn and gives **one clue**
  about their word — typically a single word or short phrase, never the word itself.
- Clues can't repeat one already given this game (no saying the same clue as a prior player).
- **Mister White has no word**, so on their turn they must bluff/improvise a plausible-sounding clue
  based only on what they've heard other players say so far.
- Good clue-craft is the core skill: too vague and you look like you don't know the word (suspicious
  if you're a Civilian); too specific/obvious and you risk exposing the Undercovers' different word
  — or, if you _are_ Undercover, revealing that your word doesn't quite match.

### Phase 2 — Discussion Phase

- After everyone has given one clue, players openly discuss: whose clue felt off, who hesitated,
  who seems to not really know the word. Civilians try to build consensus; Undercovers and Mister
  White try to deflect suspicion, blend in, or quietly redirect blame onto a Civilian.

### Phase 3 — Voting / Elimination Phase

- All remaining players vote (openly by pointing/show of hands, or anonymously via app) for one
  player to eliminate.
- The player with the most votes is eliminated and their **role is revealed**.
- **Tie votes** — no single universal rule; common house-rule options seen across sources:
  1. Rock-paper-scissors between tied players.
  2. Tied players each give one more clue, then the group re-votes.
  3. A special "Goddess of Justice" role (see variants doc) breaks the tie unilaterally.
  4. Some digital versions simply re-run the vote.
- If the eliminated player **is Mister White**, they get one immediate, single guess at the
  Civilians' secret word:
  - **Guess correct → Mister White wins instantly**, game ends right there.
  - **Guess wrong → elimination stands**, play continues.
- The round then repeats from Phase 1 with all remaining (non-eliminated) players, using the _same_
  secret word pair — the word doesn't change round to round, only the pool of remaining players
  shrinks.

## 5. Win Conditions

Checked after every elimination:

- **Civilians win** as soon as every Undercover and every Mister White has been eliminated.
- **Undercover(s) win** if the surviving players are reduced to **1 Civilian + at least 1
  Undercover, and 0 Mister Whites** (i.e., Civilians can no longer outnumber/outvote them and no
  Mister White is left to complicate the count).
- **Mister White wins** either by:
  - Correctly guessing the Civilian word immediately upon being voted out, **or**
  - Surviving down to a **1-Civilian, 0-Undercover** end state.
- **Undercover + Mister White can win together**: if exactly 1 Civilian remains while at least 1
  Undercover _and_ at least 1 Mister White both survive, the whole "Infiltrator" side wins jointly.
- If none of the above is true after an elimination, the game simply continues to the next round.

This win-condition logic is corroborated line-for-line by an actual open-source implementation's
code — see [04-REFERENCE-IMPLEMENTATIONS.md](04-REFERENCE-IMPLEMENTATIONS.md).

## 6. Scoring (per completed game, one source's point values — not universal)

| Outcome           | Points                                   |
| ----------------- | ---------------------------------------- |
| Civilians win     | **2 points** each surviving/all Civilian |
| Mister White wins | **6 points**                             |
| Undercover(s) win | **10 points**                            |

(Higher-risk roles score more. Some implementations track no persistent score at all — it's just
single-elimination bragging rights each game. If you're building a scoring system, this 2/6/10 split
is a reasonable default to start from, weighted toward "harder role to win as.")

## 7. Play Modes seen across implementations

- **Pass-and-play / offline**: one physical device or paper slips, passed around so each player can
  privately view their own word.
- **Local multiplayer**: everyone's own phone, same physical room, connected via a private room
  code (Wi-Fi/Bluetooth/P2P or a lightweight backend).
- **Online / remote**: private room via a join code, or public matchmaking with strangers.
- **Paper-and-pen (no app)**: a human "gamemaster" writes/deals word slips; works for 7–20 players
  per one paper-based source, though most digital sources put the minimum at 3–4.

## 8. Typical Game Length

10–20 minutes per round of the game (one word-pair "match" from setup to a win condition), per
multiple sources — scales with player count (more players = more elimination rounds needed).
