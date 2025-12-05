# Reference Implementations (Open Source)

Two open-source Undercover implementations were found and inspected. Notes below describe their
approach in prose/pseudocode (not verbatim copied code) — useful as architecture reference when you
design your own engine.

## 1. Pablo-Rio/undercover — terminal Python, single-device, French UI

- Repo: https://github.com/Pablo-Rio/undercover — **no license file** (all rights reserved by
  default), so treat as read-only inspiration, not a base to fork/copy from.
- Stack: 100% Python, `main.py` / `game.py` / `player.py`, runs in a terminal, French language.
- Word pairs live in a **user-supplied** `secret_words.txt` (semicolon-delimited pairs, one per
  line) — the repo ships no actual word data, players must populate it themselves. A companion
  `used_secret_words.txt` tracks consumed pairs so a pair isn't repeated within a session; consumed
  pairs are removed from the active file and appended to the used-list after each round.

**Role-assignment algorithm** (paraphrased from `role_allocation()`):

1. Shuffle the player list.
2. Pick one random word pair from the available pool; randomly decide which of the two words is
   the "Undercover" word vs. the "Civilian" word.
3. Assign the Undercover word to N random players (N = configured Undercover count) — role =
   Undercover.
4. Assign Mister White to M random players chosen from the remaining pool (re-rolling if it hits an
   already-assigned player) — role = Mister White, secret word = none.
5. Every remaining unassigned player becomes Civilian and gets the Civilian word.
6. Shuffle again before returning, so seating/turn order doesn't leak role-assignment order.

**Win-condition check** (paraphrased from `determine_winner()`, runs after every elimination):

- Count surviving Civilians / Undercovers / Mister Whites.
- If an eliminated player is Mister White **and** their (post-guess) secret word matches the real
  Civilian word → Mister White wins immediately, +6 points each Mister White.
- Else if exactly 1 Civilian remains, 0 Mister Whites remain, and ≥1 Undercover remains → Undercover
  side wins, +10 points each Undercover.
- Else if exactly 1 Civilian remains, 0 Undercovers remain, and ≥1 Mister White remains → Mister
  White wins, +6 points each Mister White.
- Else if 0 Undercovers and 0 Mister Whites remain → Civilians win, +2 points each Civilian.
- Otherwise → game continues to the next round.

This is a clean, minimal reference state machine and matches the rules described independently by
the yanstarstudio app documentation (see [01-GAME-RULES.md](01-GAME-RULES.md) §5–6) — good
cross-validation that this is the "standard" rule set, not one implementation's house rules.

## 2. antebrl/undercover-word-game — web app, MIT licensed

- Repo: https://github.com/antebrl/undercover-word-game — **MIT licensed**, free to reference or
  fork from.
- Explicitly described as a web adaptation of the popular Undercover mobile app, built for **remote
  play** (the original app's main gap being that it's designed for pass-and-play in person).
- Stack: React + TypeScript + Vite, Tailwind CSS + shadcn/ui components, **PeerJS for WebRTC
  peer-to-peer networking** — no central game server; game state syncs directly between players'
  browsers.
- Repo layout: `src/{components,config,context,hooks,i18n,lib,pages,types}`, `public/`,
  `docs/resources/` — a fairly standard modern React app structure. Includes an `i18n/` folder
  (multi-language support planned/present).
- Word-pair/category data file wasn't located in the top-level `src/` listing during this pass;
  likely nested deeper under `config/` or `lib/` — worth a closer look if you want to see their
  actual word bank and category taxonomy.

**Why this one matters for your build**: it's the closest thing to a modern, honest "how would I
build this today" reference — no backend server required, P2P via WebRTC, React/Tailwind/shadcn is a
very common, well-documented stack. If your plan leans toward a web app (vs. native mobile), this
repo's architecture is a reasonable starting point to study further or even fork (MIT permits it).

## Cross-Validation Summary

The fact that an obscure single-dev terminal game (Pablo-Rio, no license, French, clearly built
independently) implements **the exact same win conditions and scoring split** as the market-leading
app (yanstarstudio) is strong evidence this is the de facto standard rule set for "Undercover" —
not something you need to reverse-engineer from one source alone. Build against
[01-GAME-RULES.md](01-GAME-RULES.md) with confidence.
