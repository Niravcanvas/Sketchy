# Raw Scraped Source Material

Unprocessed excerpts pulled from each source during the research pass on 2026-07-02, kept for
traceability and in case you want to re-derive something the synthesis docs simplified away.
Each entry: URL, then the extracted content verbatim (as returned by the fetch, occasionally
lightly reformatted for markdown).

---

## https://www.monabgames.com/undercover/quickplay/ (the sample site given)

JS-rendered app; static fetch only captured the initial setup screen:

- Recommends a minimum of 4 players.
- Player name input, then a Settings panel with dropdowns to configure quantity of Undercovers and
  Mr. Whites, then a "NEXT" button.
- Full gameplay screens (description/voting/reveal) are behind client-side state changes not
  visible to a static fetch — recommend visiting live in a browser to capture actual screen-by-screen
  UI/UX if you want to clone the flow visually.

## https://www.monabgames.com/undercover/

- Objective: "Aim of the game is to find out who are playing undercover among the citizens."
- "Citizens will be assigned the same word and undercovers will be assigned a word similar to the
  ones citizens have."
- "Each round, players must give a word or phrase as a clue to what their word is."
- "After every round, players can collectively decide if they want to guess the undercover and
  reveal a player's identity, or continue playing the next round without revealing anyone's identity."
- No Mr. White, scoring, or player-count details were present on this page.

## https://www.yanstarstudio.com/undercover-how-to-play (official Undercover™ app)

- Player count: 3–20. Modes: Pass-and-Play, Private Room, Public Room.
- Civilian: "Uncover their identity and oust the Undercover & Mr. White."
- Undercover: "Uncover their identity and survive till the end."
- Mr. White: "Survive till the end or crack the Civilians' secret word."
- "Civilians all receive the same secret word. Undercovers receive a word slightly different from
  the Civilians', and Mr. White… no word at all!"
- Three phases: Description → Discussion → Elimination.
- Elimination: most-voted player ousted; if Mr. White, one chance to guess the Civilian word.
- Win conditions: Civilians eliminate all Undercover/Mr. White; Infiltrators win when only 1
  Civilian remains; Mr. White wins by guessing correctly.
- Scoring: Civilians 2 pts, Mr. White 6 pts, Undercover 10 pts.

## https://www.yanstarstudio.com/undercover-faq

- Offline: "Pass and Play" mode works without internet if one player has the app installed.
- Online: door icon on home screen → Online Mode → Create/Join game via room code.
- Elimination priority tip: target Mr. White first — "the longer they stay, the easier for them to
  guess the Civilians' word and win!"
- Tie-vote handling: rock-paper-scissors, extra-clue-then-revote, or Goddess of Justice special role.
- "If there is only 1 Civilian left while at least 1 Undercover and 1 Mister White are still in the
  game, the Infiltrators win together!"
- Custom words: game creation screen → Words button → Personal → add your own.

## https://www.undercovergame.com/rules (branded "Infiltrator: Find the Spy" — a rules-identical clone)

- Roles renamed: Civilian / Infiltrator (=Undercover) / Spy (=Mr. White).
- "Civilian: Receives the main secret word. The goal is to eliminate all Infiltrators and Spies."
- "Infiltrator: Receives a slightly different word from the Civilians. The goal is to blend in with
  Civilians and survive until the end."
- "Spy: Receives no word... avoid being discovered." Optional house rule: "the first or even the
  first two players cannot be a Spy."
- Clue round: "Starting with the first player, everyone says a single word as a clue," and clues
  should be "specific enough to prove you know the word, but not so obvious as to reveal it to the
  Spy."
- Voting modes: real-life open vote, or anonymous phone-based vote.
- On elimination, role is revealed; if Spy, they must guess the Civilian word or lose.
- Win conditions: Civilians eliminate all Infiltrators+Spies; Infiltrators win if ≥1 survives to the
  end; Spy wins by surviving to the end OR guessing correctly on elimination.

## https://www.undercovergame.com/tips

Universal tips: listen closely to others' clues for hidden information; match natural response
timing (too slow or too fast both look suspicious); read body language; keep it light/fun.

Civilian-specific: early players benefit from "cannot be Spy" credibility if that house rule is on;
avoid clues that are too obvious ("Food" for Pizza) or too obscure; vary clue types (place/action/
feeling, not just synonyms); set traps with slightly ambiguous clues; back accusations with specific
evidence ("your clue 'round' is suspicious!").

Infiltrator/Spy-specific: stay quiet, listen, infer the general theme, give a vague clue; paraphrase
others' clues in your own words for credibility; stay confident under pressure; deflect suspicion
decisively onto someone else; vote with the majority or protect fellow impostors strategically; if
caught as Spy, recall all clues given for a best-guess at the real word.

## https://boardgamegeek.com/boardgame/180570/undercover

Blocked — HTTP 403 (BGG blocks automated scraping). Not retrieved.

## https://web.pocketparty.app/game/mr-white

- Ideal group: "4 to 10 players for a good balance of interaction and difficulty."
- One player (Mr. White) gets a slightly different word; everyone else shares the same word.
- Clue phase: "one or two-word clue." Brief discussion period follows.
- Voting: point at who you suspect; most-pointed-at player is accused.
- If correctly identified: "Mr. White has one chance to guess what the word everybody else has is.
  If they guess it correctly, then they win!"
- If incorrectly accused: "Mr. White wins the round and the player that was incorrectly voted on is
  eliminated from the game" — notably, a **wrong accusation eliminates the accused innocent player**,
  a harsher variant than most other sources.
- Example word pair: Apple / Pear, sample clue "Crunchy."

## https://mrwhiteonline.com/ and https://mrwhiteonline.com/undercover-game/

Both blocked — HTTP 403.

## https://www.bestpartygames.net/games/undercover/undercover

- Players: 4–20, optimal 6–12. Spy count 1–3 customizable, blank cards (Mr. White) customizable,
  word category selection or custom words.
- Undercover Mode flow: same as core rules (assign words → describe → vote → eliminate → repeat
  until civilians ID all undercover OR undercover count equals civilian count).
- Mr. White Mode flow: described as if it can run as its own standalone mode variant (blank-card
  player only, no separate Undercover role) rather than always combined.
- Claims 15 word categories, 1,500+ pairs (category names captured in
  [02-WORD-PAIRS.md](02-WORD-PAIRS.md); the underlying pair list itself wasn't accessible).
- Custom word pair creation supported. Typical game duration: 10–20 minutes.

## https://play.google.com/store/apps/details?id=com.yanstarstudio.joss.undercover

Content was truncated/blocked by the store page's rendering; no usable rules text retrieved beyond
what's already covered by the yanstarstudio.com pages above.

## https://undercover.gg/words

Full word-pair library by category and difficulty (Food & Drink, Animals, Tech, Abstract, plus
Places/Sports/Music/Movies categories referenced but not fully captured). Complete pair examples are
reproduced in [02-WORD-PAIRS.md](02-WORD-PAIRS.md).

## https://github.com/Pablo-Rio/undercover

See full writeup in [04-REFERENCE-IMPLEMENTATIONS.md](04-REFERENCE-IMPLEMENTATIONS.md). Repo
contains `README.md`, `main.py`, `game.py`, `player.py` — no license file, no bundled word list
(user must supply their own `secret_words.txt`).

## https://github.com/antebrl/undercover-word-game

See full writeup in [04-REFERENCE-IMPLEMENTATIONS.md](04-REFERENCE-IMPLEMENTATIONS.md). MIT
licensed. React + TypeScript + Vite + Tailwind + shadcn/ui + PeerJS (WebRTC P2P, no backend server).

## https://pnwchords.com/undercover-game/ (paper/pen house-rule variant)

- 7–20 players, 7–15 minutes, "12+ recommended (better for adults)." Materials: paper, pen.
- Roles: Normal Players (majority word, e.g. "Handphone"), Undercover ×2–3 (similar minor word,
  e.g. "Walkie-talkie"), Mr. White ×1–2 (blank paper).
- "The identities of players are secret, even for players who are of the same identity."
- "No description of a word should be allowed more than once" — game-long clue-uniqueness rule, not
  just per-round.
- Elimination: 1–2 players voted out per round depending on player count.
- Objective as stated: "find the Undercovers and eliminate them" (this source's phrasing centers the
  Undercover hunt over Mr. White).
- Optional **Detective** role/variant: sees both words in the pair, is aligned with Normal Players,
  doesn't automatically reveal what they know.

## https://apps.apple.com/sg/app/undercover-word-party-game/id946882449

- Tagline: "Bluff & Fun with Friends."
- "Undercover is a group game you can play online or offline, with friends or with strangers! Your
  goal is to find out the other players' identities (and yours!) as fast as possible to eliminate
  your enemies."
- Positioned as an icebreaker alongside Werewolf, Codenames, Spyfall — "created to ensure active
  participation from everyone who can read and speak."
- Features: offline same-device mode, online mode, "hand-picked word database," real-time ranking
  shown at round end.
- "Civilians all receive the same word, the Undercover gets a slightly different word, and Mr. White
  gets the ^^ sign" (their in-app placeholder icon for "no word").

## https://www.yanstarstudio.com/undercover-special-roles

Full special-roles list reproduced in
[03-SPECIAL-ROLES-VARIANTS.md](03-SPECIAL-ROLES-VARIANTS.md): Goddess of Justice, The Lovers,
Mr. Meme, The Revenger, The Duelists, The Ghost, The Falafel Vendor, The Boomerang, The Joy Fool.

---

### Sources attempted but blocked (HTTP 403 / anti-scraping)

- boardgamegeek.com/boardgame/180570/undercover
- mrwhiteonline.com (both the homepage and /undercover-game/ page)

If you need these specifically, open them manually in a browser — they weren't reachable via
automated fetch in this session.
