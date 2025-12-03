# Product Copy — the actual words

> Finished, shippable text. Phases import from here verbatim — do not rewrite in-code.
> Implementation note: all strings live in `apps/web/src/copy.ts` (and mirrored keys for
> mobile later), keyed by the §-labels used below, so localization later is a file swap.
> Tone rules at the end (§12). Where a string interpolates, `{curlies}` mark variables.

## §1 Brand

- **Name**: **Sketchy**
- **Tagline (primary)**: _Everyone's a little sketchy._
- **Tagline (alt, marketing pages)**: _One word apart. One liar among you. Draw your own conclusions._
- **One-line description (store/SEO)**: "Sketchy is a social deduction party game for 3–20
  players: everyone gets a secret word — except the players who got a slightly different
  one, and the one who got nothing at all. Describe, accuse, vote, and try not to look
  sketchy."
- Naming notes: never "Undercover™" (existing brand). The three base roles keep their
  genre-standard names (Civilian / Undercover / Mister White) for instant recognizability;
  all special-role names in §3.2 are our own.

## §2 Home screen

- Header: **Sketchy** + tagline.
- Primary buttons: `Play on this phone` (pass-and-play) · `Create a room` · `Join a room`
- Secondary: `How to play` · `Word packs` · `My scrapbook` (profile/history)
- First-visit name prompt: **"What should we call you?"** — placeholder `Your name…`,
  helper: "No account needed. You can change this anytime." Button: `Let's go`
- Footer line: "Best with 6–12 players and at least one dramatic friend."

## §3 Roles

### §3.1 Base role cards (shown on the deal, press-and-hold to peek)

**Civilian**

- Card title: `CIVILIAN`
- Word line: "Your secret word:" `{word}`
- Flavor: "Most players got this same word. Someone didn't."
- Goal line: "Describe it. Watch. Vote out everyone who doesn't quite fit."
- Reminder chip: "Don't say your word out loud. Obviously."

**Undercover**

- Card title: `UNDERCOVER`
- Word line: "Your secret word:" `{word}`
- Flavor: "Careful — your word is _almost_ everyone else's word. Almost."
- Goal line: "Blend in. Sound confident. Survive the votes."
- Reminder chip: "You don't know who's with you. Neither do they."

**Mister White**

- Card title: `MISTER WHITE`
- Word line: a blank card — "Your secret word:" `— nothing. You get nothing. —`
- Flavor: "Everyone else is describing a word. You're describing pure vibes."
- Goal line: "Bluff your way through. If they catch you, guess their word to steal the win."
- Reminder chip: "Listen hard. Every clue is a hint."

Deal-screen chrome: "Press and hold to peek 👇" / on release: "Hidden. Very sneaky." /
confirm button: `Got it` / status strip: "Waiting for {n} players to peek…"

### §3.2 Special roles (settings toggles; each has toggle-label + description + deal-card line)

| Role              | Toggle description (lobby settings)                                                            | Extra line on the deal card                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **The Judge**     | "When a vote ties, the Judge decides who's out — even after they've been eliminated."          | "Ties are yours. Rule wisely, or don't."                                                |
| **The Ghost**     | "Eliminated players keep chatting and voting from beyond. Death is not an excuse."             | (shown on elimination instead) "You're a Ghost now. You still vote. Haunt responsibly." |
| **The Jester**    | "If the Jester is the very first player voted out, they score +4 points for the drama."        | "Getting caught first would be… kind of great for you?"                                 |
| **The Lovebirds** | "Two players are secretly linked. If one goes down, so does the other."                        | "You're a Lovebird. Your fate is tied to {name}. Protect them — quietly."               |
| **The Grudge**    | "When the Grudge is eliminated, they drag one player down with them."                          | "If you go down, someone's coming with you."                                            |
| **The Mirror**    | "The first time the table votes the Mirror out, the votes bounce back at the voters. Once."    | "The first mob that comes for you will regret it."                                      |
| **The Rivals**    | "Two players are secretly feuding: first one eliminated loses 2 points, the survivor gains 2." | "You have a rival: {name}. Outlast them."                                               |
| **The Mime**      | "Each round one random player must give their clue in gestures only. In-person rooms only."    | (round toast) "{name} is the Mime this round — gestures only, not a word!"              |

Settings section header: **"Spice (optional roles)"** — helper: "All optional. Add one or
two once your table knows the basics."

## §4 Rooms & invites

- Create-room button: `Create a room` → lobby header: "Room **{CODE}**" + "Tell your
  friends the code, or just send the link."
- Copy actions: `Copy code` / `Copy link` / `Copy invite message`
- **Invite message** (the paste-into-Discord blurb):
  > 🕵️ Get in here — we're playing **Sketchy**.
  > Room code: **{CODE}**
  > {joinUrl}
  > (3 minutes to learn. Nobody trusts anybody. It's great.)
- Lobby call hint (remote rooms) — **REPLACED at phase 15** by the `Join voice 🎙️` pill
  (below); the line below is kept struck through for history, not shown in-product anymore:
  ~~"Playing from your couches? Hop on a voice call — Sketchy is best played arguing out
  loud."~~
- Join screen: title "Join a room" — input placeholder `ROOM CODE` — button `Knock knock`
- Ready flow: `I'm ready` / un-ready `Hang on…` — host button: `Start game` — host
  force-start confirm: "Not everyone's ready. Start anyway?" `Start` / `Wait`
- Waiting-for-players empty state: "It's quiet in here… too quiet. Invite some suspects."
- Avatar picker (lobby, `<AvatarPicker>` — phase 5): heading **"Your doodle"** — helper:
  "This is how the table sees you." — part-row labels: `Head` / `Face` / `Extras` — ink
  swatch accessible names (screen-reader only, the swatches themselves are the palette
  tokens): `Civilian blue` / `Undercover red` / `Mister White violet` / `Success green` /
  `Highlight yellow`.
- Copy-confirmation (phase 5, `<RoomCodeHero>`): after `Copy code` / `Copy link` /
  `Copy invite message`, a transient "Copied." state (icon swap to a checkmark + `aria-live`
  announcement) — not a creative line, just the a11y confirmation text.
- **The clock** (settings drawer timer presets, phase 5): section header **"The clock"** —
  helper: "Untimed is best on a voice call." — preset buttons: `Untimed — we're on a call`
  (all three timers null) / `Standard` (60s clue / 120s discussion / 45s vote) / `Speedy`
  (30s / 60s / 30s).
- Kick confirmation (host tapping another player's card, phase 5 — not previously scripted):
  title "Kick player?" — "Kick {name}? They can knock again anytime." — `Kick them` /
  `Keep them`.
- Chat drawer chrome (phase 5, game-design.md §3.4 — the drawer's own input/send, distinct
  from the §8 presence toasts): input label/placeholder `Message` / "Say something…" — send
  button `Send`.
- **Voice (phase 15, new)** — the status-strip pill (lobby AND in-game, game-design.md §10),
  its states, and everything that hangs off it:
  - Pill label per state: idle `Join voice 🎙️` (also the exact replacement text for the
    struck-through call hint above) / connecting `Connecting…` / connected `Voice on` /
    unavailable `Voice unavailable` / mic blocked `Mic blocked`.
  - Mic-permission denial (graceful — the game is never blocked on this): "Mic's blocked. The
    game doesn't need it — fix it in your browser's site settings if you change your mind, or
    just keep playing." Retry button reuses `Join voice 🎙️` verbatim.
  - Voice-server-down degradation (pill tooltip/subtext when `unavailable`): "Voice is down for
    a moment. Nothing about the game depends on it — we'll quietly reconnect when it's back."
  - iOS/background-tab honesty tooltip (help icon next to the pill once connected): "Voice
    works best with this tab open and awake — iOS pauses your mic the second you switch apps
    or lock the screen."
  - Mute control (once connected, player-strip-adjacent): `Mute` / `Unmute` (reuses the same
    toggle-label pattern as §14's sound mute) — `aria-label` doubles as the label.
  - Leave control: `Leave voice`.
  - Join/leave toasts (local-only — game-design.md §10 "cosmetic to the engine"; only players
    already connected to voice see these, since they come from LiveKit's own participant
    events, not a server broadcast): "{name} joined voice." / "{name} left voice."

## §5 Pass-and-play

- Setup title: "Who's playing?" — add-player placeholder `Add a name…`
- Player-count warning (<4): "Playable with 3, properly fun with 6+."
- Role steppers header: "The cast" — helper: "We've suggested a mix for {n} players. Meddle
  at your own risk."
- Pass interstitial: **"Pass the phone to {name}"** — button: `That's me` — small print:
  "Everyone else, look away. Yes, you."
- After peek: `Pass it on ➡️` — last player: `Everyone's in. Start round 1`
- Clue tracker: "**{name}**, describe your word out loud. One word or a short phrase."
  → `Next player`
- Vote handoff: "Pass to {name} to vote — no peeking at the last ballot."
- Resume prompt: "Pick up where you left off? Your last game is still on the table."
  `Resume` / `Start fresh`
- Pack picker header: **"The words"** — helper: "Pick a pack or three. We'll shuffle."
- Difficulty filter labels: `Easy` / `Medium` / `Hard` (chip labels, all on by default)
- Typed-clues toggle label: "Write clues on the board" — helper: "Off: clues are spoken out
  loud. On: each player also pins a one-word note."
- Open-vote toggle label: "Open voting" — helper: "One screen, the table points, one person
  records. Less passing, more arguing."
- Open-vote screen instruction: "Record each vote as the table calls it out."
- Peek a11y toggle (alternative to press-and-hold, conventions.md §4): `Show my card` /
  `Hide my card`
- Role-math inline error (steppers, when civilians wouldn't outnumber the rest): "Too many
  impostors — civilians must outnumber the sketchy side."
- Offline packs line (setup, when GET /packs fails): "Offline — the built-in starter pack is
  on the table."

## §6 In-game phases (online)

- Phase labels (status strip): `Round {n} — Clues` · `Discussion` · `The Vote` ·
  `Tiebreaker` · `The Reveal`
- Clue phase, your turn: "**Your turn.** One word or a short phrase about your secret word."
  — input placeholder `Your clue…` — button `Pin it to the board`
- Clue phase, not your turn: "✏️ {name} is thinking…"
- Skipped-turn note (crumpled): `skipped`
- Host skip button: `Skip their turn` — confirm: "Skip {name}? They can still rejoin and
  play next round."
- Discussion phase banner: "Talk it out. Who sounded a little… off?" — host buttons:
  `+60s` · `Call the vote`
- Voting phase: "Vote to eliminate. Choose carefully — the majority rules."
  — own card disabled with tooltip "You can't vote for yourself. Bold, though."
  — after casting: "Ballot in. You can still change it until the vote closes."
  — progress: "{k}/{n} have voted"
- Tiebreaker: "It's a tie between {names}. Each of them gives one more clue — then we vote
  again. No pressure."
- Second tie: "The table can't decide. Nobody goes home this round — but nobody's off the
  hook either."
- All-abstain: "Nobody voted?! Fine. Everyone survives. For now."
- **Judge decision phase (phase 12, new)** — when the Judge role is enabled, a tie routes
  here instead of the tiebreaker above. The Judge's own screen reuses §3.2's deal-card line
  verbatim as the headline: "Ties are yours. Rule wisely, or don't." Everyone else sees:
  "The Judge is deciding…" Announcement toast (fires every time a tie routes here, not just
  the first): "It's a tie. The Judge gets the final say this time."

## §7 Reveals, wins & scoring

- Reveal buildup (full screen): "The table has spoken." → "{name}, you're out."
- Role reveal lines:
  - Civilian: "**{name} was… a Civilian.** Well. That's awkward for everyone who pointed."
  - Undercover: "**{name} was… UNDERCOVER.** Got one!"
  - Mister White: "**{name} was… MISTER WHITE.** But wait — they get one guess…"
- Mr. White guess screen (them): "**One shot.** What's the Civilians' word?" — input
  placeholder `Say the word…` — button `Steal the win`
- Mr. White guess screen (everyone else): "Mister White is guessing… hold your breath."
- Guess wrong: "**'{guess}'** — nope. Not even close. (Okay, maybe close.) They're out for real."
- Guess right → win screen: "**MISTER WHITE STEALS IT.** The word was '{word}' and they
  plucked it out of thin air. +6 points."
- Win screens (headline + subline + points chip):
  - Civilians: "**CASE CLOSED.** The Civilians sniffed out every impostor. +2 points each."
  - Undercover: "**THEY NEVER SAW IT COMING.** The Undercover walked among you the whole
    time. +10 points."
  - Infiltrators (joint): "**FULL INFILTRATION.** Undercover and Mister White split the
    table's trust — and the win. +10 / +6 points."
- Eliminated strip tag (player strip / vote & reveal screens, design-party-pop.md §11 — the
  `bg-undercover` "OUT" row's ink chip): "OUT · {ROLE}" (role = the §3.1 card title).
- Full-table reveal header: "The whole truth:" — pair line: "Civilians had **{word}**,
  Undercover had **{word2}**."
- Session scoreboard title: "Tonight's scoreboard" — lifetime chip: "scrapbook total: {points}"
  — per-player this-game delta bump (design-party-pop.md §11 "score bumps"): "+{points}"
- **Jester first-out bonus line (phase 12, new)** — shown on the win screen only when the
  very first player eliminated this game held the Jester: "{name} was the Jester. Getting
  caught first paid off — +4 points."
- End CTAs: host `Rematch — same crew, new word` / `Back to lobby` — non-host: "Waiting for
  {host} to deal the next one…" `Leave room`

## §8 Presence & system events (toasts / banners)

- playerJoined: "{name} slid into the room."
- playerLeft: "{name} left. Suspicious? Probably fine."
- playerDisconnected: "{name} lost connection — holding their seat…"
- playerReconnected: "{name} is back. Act natural."
- hostChanged: "{name} holds the pencil now (new host)."
- kicked (to the kicked player): "The host removed you from the room. Rooms are like that
  sometimes."
- kicked (to others): "{name} was shown the door."
- timerExtended: "The host added a minute. Use it wisely."
- reconnecting (self, banner): "Reconnecting… your seat is safe."
- eliminated (self, banner): "You're out — but stick around. Heckling from the afterlife is
  encouraged." (Ghost role active: "You're a Ghost. You still vote. Haunt responsibly.")
- rejoin prompt (site revisit): "You have a game in progress in room {CODE}." `Rejoin` /
  `Abandon`
- host hand-back (player-card action, host only — game-design.md §8, phase 8): button
  `Make host` — confirm: "Hand the pencil to {name}? You'll be a regular player."
- sessionSuperseded (banner, phase 5): "You opened this room somewhere else — this tab is
  paused." (api-contract.md §2 `session:superseded` — the socket that just got replaced by a
  newer connection for the same player; no auto-reconnect after this).

## §9 Errors & empty states (keyed by ErrorCode — api-contract §0)

| Code                          | User-facing copy                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `room_not_found`              | "No room with that code. Check it with whoever invited you — codes expire after a day."            |
| `room_full`                   | "That room is packed ({max} players). Someone has to leave before you can squeeze in."             |
| `room_in_progress`            | "They've already started this game. You can wait for the next round — ask them to rematch you in." |
| `name_taken_in_room`          | "Someone in this room already claimed that name. Pick a variant — {name}² has a ring to it."       |
| `not_host`                    | "Only the host can do that. Flattering that you tried."                                            |
| `not_your_turn`               | "Not your turn yet — the suspense is the point."                                                   |
| `wrong_phase`                 | "Too late (or too early) for that. The game moved on."                                             |
| `already_voted`               | "Your ballot's already in. You can change it until the vote closes."                               |
| `clue_repeated`               | "Someone already used that clue this game. Original thoughts only."                                |
| `clue_is_secret_word`         | "That's… the word. You can't just say the word."                                                   |
| `profanity`                   | "Let's keep it printable. Try different words."                                                    |
| `rate_limited`                | "Easy there. Give it a few seconds and try again."                                                 |
| `validation`                  | "That didn't look right — check it and try again."                                                 |
| `unauthorized`                | "Your session went stale. Refresh and you'll be back in."                                          |
| `not_found`                   | "We couldn't find that. It may have been deleted — or never existed. Spooky."                      |
| `kicked`                      | (see §8)                                                                                           |
| `pack_forbidden`              | "You don't have access to that word pack."                                                         |
| `pair_limit`                  | "That's the limit for this pack ({max} pairs). Quality over quantity."                             |
| `pair_limit` (packs-per-player, phase 11) | "That's the limit for packs on your account ({max} packs). Retire one to make room."   |
| `voice_disabled` (phase 15)   | "Voice chat is turned off right now — the game itself is unaffected."                              |
| `account_required` (phase 16) | "Playing with strangers needs a quick account. Link your email — private rooms never need it."     |
| `suspended` (phase 16)        | "Your access to Sketchy has been suspended. If you think this is a mistake, get in touch."         |
| network offline (client-side) | "You're offline. Pass-and-play still works — online rooms will reconnect when you're back."        |
| room expired                  | "This room has expired. Start a fresh one — it takes five seconds."                                |
| generic 500                   | "Something broke on our end. It's not you, it's us. Try again in a moment."                        |

- Empty states: packs — "No packs of your own yet. Build one — inside jokes make the best
  words." · history — "No games in the scrapbook yet. Go get suspected of something." ·
  public lobbies (phase 16) — "Nobody's hosting right now. Be the somebody." · pack pairs
  (phase 11, empty editor) — "No pairs yet. Paste a batch or add your first one below." ·
  imported packs (phase 11, none yet) — "Nothing imported yet. Got a code from a friend? Drop
  it in above."
- **404 (page not found, phase 14, new)**: headline "This page doesn't exist. Suspicious." —
  body "Maybe it moved. Maybe you're the impostor here." — CTA `Back to home`.

## §10 How to play (onboarding, 4 cards + cheat sheet)

1. **"Everyone gets a word. Almost."** — "Civilians share one secret word. Undercovers get a
   near-miss copy. Mister White gets absolutely nothing and has to fake it."
2. **"Describe it — carefully."** — "One clue each, out loud, every round. Too obvious helps
   the fakers. Too vague makes YOU look fake."
3. **"Vote somebody out."** — "Argue, accuse, then vote. The eliminated player's role is
   revealed. Caught Mister White? They get one desperate guess at the word."
4. **"Last side standing wins."** — "Civilians win by clearing out the impostors. Impostors
   win by surviving to the end. Points: Civilians +2, Mister White +6, Undercover +10."

- Cheat-sheet card (lobby): "Clue → Argue → Vote → Reveal. Repeat until somebody wins."

### Onboarding chrome (phase 14, new)

- `/how-to-play` nav (the four cards above as a swipeable, skippable sequence): `Skip` ·
  `Back` · `Next` — the final card's forward button reuses `Got it` (§3.1 dealChrome,
  verbatim) instead of `Next`. Screen-reader-only progress announcement on each card change:
  "Card {n} of {total}."
- First-game contextual hints (dismissible, one-time per device — localStorage): a small
  callout above the peek card, the clue input, and the vote grid, each dismissed with the
  same `Got it` line (§3.1, verbatim) and an icon-only close button
  (`aria-label` "Dismiss hint"):
  - Peek card: **"Peek — carefully."** — "Press and hold to see your word. Let go and it's
    gone again."
  - Clue input: **"One clue, no leaks."** — "A word or a short phrase about your secret
    word. Never the word itself."
  - Vote grid: **"Point the finger."** — "Tap a suspect, then lock it in. You can change
    your mind until the vote closes."

### Sound (phase 14, new)

- Persistent mute control (every in-game screen, sound defaults on): icon-free toggle chip,
  label `Mute` / `Unmute` depending on current state (also doubles as the `aria-label`).

## §11 Button & label glossary (use these exact strings)

`Play on this phone` · `Create a room` · `Join a room` · `Knock knock` · `I'm ready` ·
`Hang on…` · `Start game` · `Got it` · `Pin it to the board` · `Call the vote` · `Lock it in` ·
`+60s` · `Skip their turn` · `Steal the win` · `Rematch — same crew, new word` ·
`Back to lobby` · `Leave room` · `Rejoin` · `Copy code` · `Copy link` · `Copy invite message` ·
`How to play` · `Word packs` · `My scrapbook` · `Save` · `Cancel` · `Delete` (destructive
confirm: "Delete '{name}'? This can't be undone." `Delete it` / `Keep it`)

Phase 11 additions (pack manager & pair editor — §14): `Create a pack` · `Add pairs` ·
`Paste pairs` · `Share this pack` · `Import a pack` · `Import`

## §12 Voice & tone rules (for any copy a phase must add)

1. Conspiratorial, dry, a little theatrical — a friend narrating a heist, not a system
   reporting status. Never corporate ("An error has occurred" is banned).
2. Short first, joke second: the functional half of the sentence always comes first.
3. Jokes never obscure state: every error names the fix; every wait names who/what it waits on.
4. Punch up or sideways, never at the losing player — elimination copy teases the table,
   not the victim.
5. No exclamation-point pileups; one per string, max.
6. Words to prefer: table, suspect, sketchy, the pencil (host), scrapbook (history).
   Words to avoid: user, session, lobby-speak in-game ("instance", "queue"), "oops".

## §13 Official word packs (phase 3)

The 8 official packs shown on the **Word packs** screen (§2, §11), one per category. Source
of truth for these strings — `apps/api/seed/packs/*.json` must match verbatim.

| Pack               | Description                                                              |
| ------------------ | -------------------------------------------------------------------------- |
| Food & Drink        | Delicious words, dangerously similar orders.                              |
| Animals             | Same habitat, one word that doesn't quite fit the pack.                   |
| Objects             | Ordinary stuff, one suspiciously specific difference.                     |
| Jobs                | Same job title, one career that doesn't quite check out.                  |
| Screens & Series    | Everyone's watching something — not everyone's watching the same thing.   |
| Tech                | Same gadget energy, one suspiciously different spec sheet.                |
| Travel & Places     | Same trip, one wrong turn nobody's admitting to.                          |
| Feelings            | Everyone's feeling something — try describing it without giving it away.  |

- The **offline starter pack** (`apps/web/src/data/starter-pack.json`, pass-and-play's
  default word source) has no in-product blurb of its own today — if one is ever surfaced
  in the UI, use: "The 60 pairs worth trusting when you're offline."

## §14 Profile & scrapbook (phase 10)

- Screen title: **"My scrapbook"** (already scripted at §2/§11) — identity card up top:
  doodle avatar + name, editable inline (`Save` / `Cancel` from §11's glossary). Edit
  affordance aria-label: "Edit your name and doodle".
- Headline totals (three stat chips): `Scrapbook total` · `Games played` · `Games won`.
- Per-role breakdown header: **"By role"** — one win-rate bar per base role (labels from
  §3.1's card titles). Stat line: "{won}/{played} won". A role never played: "Haven't played
  this one yet."
- Points-over-time header: **"Points over time"** — helper: "Your last {n} games." Fewer
  than two finished games to plot: "Play a couple more and this'll start to look like
  something."
- History list header: **"Past games"** — empty state (already scripted, §9): "No games in
  the scrapbook yet. Go get suspected of something." Pagination button: `Load more`.
- Game card mode labels: `Pass & play` · `Private room` · `Public room`. Abandoned game (no
  winner — `winnerFaction: null`): "Abandoned — nobody finished this one." shown where the
  winner faction would otherwise go.
- Round-by-round expand toggle: `Round-by-round` — round heading: "Round {n}" — sub-labels
  `Clues` / `Votes` — no elimination that round: "Nobody went home this round." — vote tally
  line: "{name} — {n} vote(s)" (aggregate count only — see conventions.md §1's redaction
  rule; never a per-voter breakdown, even here, even after the game is long over).
- Between-games standings screen title: **"Tonight's standings"** — top-scorer callout
  label: **"Tonight's MVP"**.
- Guest-identity footer (profile page, honest no-dark-patterns caveat per §12): "This
  scrapbook lives on your browser, not an account — nobody's built those yet. New device or
  a wiped cache means a clean slate."

## §15 Word pack manager & editor (phase 11)

`/packs` — the pack manager screen (§11 `Word packs`).

- Screen title: "Your word packs"
- Tabs: `Mine` · `Official` (§3.13's 8 official packs live under `Official`; `Mine` shows
  packs the player owns AND packs they've imported, owner-attributed per below)
- Create flow: `Create a pack` button opens a small form — name field label "Pack name",
  placeholder "The Johnson Family Reunion, Vol. 3"; description field label "What's it
  about? (optional)", placeholder "Inside jokes only the cousins will get."
- Pack card meta line: "{pairCount} pairs" · imported-pack attribution line: "Imported from
  {ownerName}" (owner's display name; falls back to "a friend" if somehow unresolved)
- Cover placeholder (no `coverUrl` set): no copy of its own — an auto-generated Party Pop
  shape (design-party-pop.md §4/§14: solid ink-bordered shape, no photo, no Rough.js)
- Cover upload button (pack detail, owner only): `Add a cover` (already has one: `Change
  cover`)

Pair editor (opened from a pack card, owner only):

- Section label: "The pairs" · helper: "Same category, one meaningful difference — that's
  the whole trick."
- Row fields: word A / word B (labels "Word A" / "Word B") + a difficulty chip per row
  (reuses `pnp.difficulty` — `Easy` / `Medium` / `Hard`)
- `Add pairs` opens the bulk-paste panel: label "Paste pairs", helper "One pair per line —
  `word;word`. We'll sort the difficulty later.", placeholder:
  ```
  sofa;armchair
  mustache;beard
  apartment;house
  ```
- Inline validation (never blocks paste, flags per row): duplicate — "Already in this pack."
  · near-identical — "These look like the same word. Try a sharper difference." · too long —
  "Keep it under 40 characters."
- The "good pair" helper card (quotes research/02-WORD-PAIRS.md's design principle):
  headline "What makes a good pair?" · body: "Same category, one meaningful difference — close
  enough that the sketchy one can survive a few rounds, different enough that a sharp table
  catches them." · difficulty examples line: "Easy: Cat / Dog. Medium: Coffee / Tea. Hard:
  River / Canal."
- Pagination: `Load more pairs` button under the row list (only shown while a next page
  exists — pack sizes top out at 500, so this is a plain "load more", not infinite scroll).
- Row delete uses the existing `Delete` glossary entry (icon-only, `aria-label`); pack delete
  reuses the same destructive-confirm pattern as §11 — title "Delete pack?", body "Delete
  '{name}'? This can't be undone." `Delete it` / `Keep it`.

Sharing (pack detail / editor header):

- Private pack: `Share this pack` button — confirm dialog title "Share this pack?", body
  "Sharing turns on a code anyone can use to add this pack to their own table. They still
  can't edit it." `Share it` / `Not yet`
- Once shared: share-code chip label "Share code" next to the code itself, with the existing
  `Copy code` action (§11) — reused verbatim, same tone as the room-code copy button.
- `/packs/import` entry field: label "Got a code?", placeholder "SHARECODE", submit `Import`
- Import outcomes: success toast — "Added to your table. Find it under Mine." · not
  found/wrong code — reuses `not_found`'s §9 line ("We couldn't find that. It may have been
  deleted — or never existed. Spooky.")

Make public (pack detail / editor header, alongside `Share this pack`; making a pack public
is self-service and takes effect immediately — the pack joins the public catalog for anyone
to find and use):

- `Make public` button — confirm dialog title "Add to the public catalog?", body "This adds
  your pack to the public catalog — anyone can find and use it. You can make it private
  again anytime." `Make it public` / `Not yet`
- Public-pack indicator (owner-only, card badge in the manager grid + pack-detail banner
  label): "Public" · pack-detail helper line: "This pack is in the public catalog — anyone
  can find and use it."

Browse public packs (`/packs/browse`, reached from a link on the `/packs` manager; the
discovery counterpart to `Make public` — find packs other players opened up and add them to
your own set so they show under `Mine` and in the room pack picker):

- Screen title: "Browse public packs" (also the manager's link label) · subtitle: "Packs the
  community opened up. Add one and it lands under Mine."
- Search: field label "Search packs", placeholder "Search by name…", submit `Search`
- Per-pack action: `Add to my packs` — once added it becomes a disabled `Added` state
- Pagination: `Load more packs` button (only while a next page exists — cursor-paginated,
  a plain "load more" like the pair editor and the lobby browser)
- Empty state: "No public packs to add right now. Check back — or make one of yours public."
- Fetch error (surfaced, never silent): "Couldn't load the catalog just now. Give it a
  moment and try again."

Game integration (lobby settings drawer / pass-and-play setup, pack picker chips):

- Imported/owned pack chips carry the same visual treatment as official ones; no extra copy
  beyond the pack name itself (owner attribution lives on the pack manager screen, not
  repeated inline in every picker to avoid clutter).

## §16 Marketing site (phase 14)

Copy for the server-rendered marketing surface: `/` (landing), `/about`, `/faq`,
`/privacy`, `/terms`, the shared site nav + footer, and the SEO surface (metadata, OG
images, the social-proof counter). Voice rules: §12. Mirrored verbatim in
`apps/web/src/copy.ts` under a single `marketing` key.

### §16.1 Site nav & footer (all marketing pages + reachable from the app shell)

- Skip link (a11y, first focusable element): "Skip to main content"
- Nav landmark label (`<nav aria-label>`, not itself visible): "Main"
- Nav links: `About` · `FAQ` · `How to play` — the hero's own CTAs (§16.2, already
  scripted) cover navigation into the app, so the nav bar itself carries no separate CTA
  button (see phase14-handoff for the reasoning).
- Footer column headings: **"Product"** · **"Legal"** · **"Credits"**
- Footer product links: `How to play` · `About` · `FAQ`
- Footer legal links: `Privacy` · `Terms`
- Footer credits line (self-hosted assets, no ad-network attribution needed — Lucide/OFL
  fonts need no footer credit per their licenses, listed anyway for transparency):
  "Illustrations: Open Doodles (CC0). Icons: Lucide (ISC). Fonts: Archivo Black & Space
  Grotesk (OFL 1.1)."
- Footer GitHub link label: `GitHub` (only rendered when a real repo URL is configured —
  never a placeholder link)
- Footer tagline: reuses §2's existing footer line verbatim ("Best with 6–12 players and
  at least one dramatic friend.")
- Footer copyright line: "© {year} Sketchy."

### §16.2 Landing (`/`)

The existing home screen's guest-identity flow (name prompt, `Play on this phone` /
`Create a room` / `Join a room`, rejoin prompt) is preserved as-is inside this page —
only the surrounding marketing chrome is new.

- **Hero eyebrow** (small chip above the headline): "A party game for 3–20 players"
- **Hero headline** (the ONE `<h1>` on this page; the brand name gets the
  highlight-sticker treatment from design-party-pop.md §7's highlight-block span, split
  into three parts for that markup):
  - Prefix: "Everyone's a little"
  - Highlighted word: "sketchy"
  - Suffix (trailing punctuation, rendered right after the highlighted word): "."
- **Hero subhead**: reuses §1's marketing-page alt tagline verbatim — "One word apart.
  One liar among you. Draw your own conclusions."
- **How it works** section heading: "How it actually works"
- **How it works** (three steps, non-cliché — each pairs an Open Doodles scene with a
  short beat; deliberately NOT a "1-2-3 numbered icon row"):
  1. Eyebrow "Step 1" · title "Get your word" · body: "Everyone at the table gets the
     same secret word — except the impostors, who get something close but not quite
     right. One poor soul gets nothing at all."
  2. Eyebrow "Step 2" · title "Describe, don't confess" · body: "One clue at a time, out
     loud. Too obvious and you help the impostors blend in. Too vague and you start
     looking like one yourself."
  3. Eyebrow "Step 3" · title "Vote out the sketchy one" · body: "Argue, accuse, vote.
     Guess wrong and the impostors walk away with it. Catch Mister White and they still
     get one last, desperate guess to steal the win anyway."
  - Doodle alt text (descriptive, not decorative — conventions.md §4 `alt` rule):
    "Hand-drawn doodle of a person excitedly unboxing a package" (step 1) · "Hand-drawn
    doodle of a person striking a self-conscious selfie pose" (step 2) · "Hand-drawn
    doodle of a person dancing mid-celebration" (step 3).
- **Social proof counter** (admin-stats-derived, `gamesToday` ONLY — see phase14-handoff
  for the honesty framing rationale):
  - Caption (small label under/beside the number): "Tables started today"
  - Supporting line: "Grab a few friends — yours could be next."
  - This section renders NOTHING when the count isn't available (unset admin token, API
    down, or a failed fetch) — no placeholder number, no error state.
- **Secondary CTA band** (before the footer): eyebrow "Already know the rules?" ·
  restates the `How to play` / `Word packs` / `My scrapbook` secondary actions (§2,
  already scripted — no new copy needed, just new placement).
- **Entry-panel reassurance** (two small muted captions in the right-hand action card,
  next to `Create a room`, so the honest reality reaches a host BEFORE they commit to a
  room instead of only in the FAQ):
  - Clue-trust line: "Clues are free text — play with people you trust."
  - Voice line: "Voice chat's built into private rooms — or pair with a Discord or video
    call." (Voice shipped in phase 15 (§16.4 Q9 / §16.5 / §16.6); this caption reflects
    that reality — voice is a built-in private-room option — rather than the pre-phase-15
    "not built in" framing.)
- **"Got questions?" link** (a quiet inline link in the secondary CTA band, lighter visual
  weight than the CTAs, pointing to `/faq` so the FAQ isn't reachable only from the
  footer): "Got questions? Read the FAQ."
- **Identity panel heading** (the name-prompt card's own context label, since the page's
  `<h1>` moved to the hero): "Your seat at the table" — sits directly above
  `NamePromptCard` so the guest-identity flow still reads as a distinct, findable step
  rather than losing its heading entirely.

### §16.3 About (`/about`)

- Page title (visible `<h1>`): "So, what is Sketchy?"
- Body (voice: §12 — conspiratorial, dry, a little theatrical):
  1. "Every group has one. The friend who can describe 'lighthouse' for ninety seconds
     without ever quite saying what it does. Sketchy is built for that friend — and for
     the rest of the table figuring out whether they're bluffing or just bad at charades."
  2. "The rules are old — this style of social deduction has been a party-game staple for
     years. What we changed is the friction: no app store, no sign-up wall, no fumbling
     for a deck of cards. Open a link, get a name, get a word. The game starts in under a
     minute."
  3. "Pass-and-play works on one phone, no internet required, for the couch. Private
     rooms work over a room code, for everyone else — pair it with a Discord call and
     it's basically a séance with scoring."
  4. "We're not chasing an app-store ranking. We're chasing the moment your table goes
     dead silent because someone just realized their best friend has been lying to them
     for four rounds straight. That's the whole product."
- Closing line (small, sign-off tone): "Built by people who kept losing at this game and
  got suspicious about why."

### §16.4 FAQ (`/faq`)

- Page title (visible `<h1>`): "Questions people actually ask"
- Intro line: "The short, honest answers — not a wall of legal text pretending to be
  helpful."
- Q&A pairs (rendered as a plain server-rendered list, not an accordion — every answer
  visible to a first-time visitor AND a crawler; also feeds the `FAQPage` JSON-LD
  verbatim):
  1. Q: "What is Sketchy?" A: "A social deduction party game for 3–20 players. Everyone
     gets a secret word — except the players who got a slightly different one, and the
     one who got nothing at all. Describe, accuse, vote, and try not to look sketchy."
  2. Q: "How many players do I need?" A: "Three is the floor, twenty is the ceiling. It's
     genuinely fun from six players up, and best with at least one dramatic friend."
  3. Q: "Do I need to download anything?" A: "No. It runs in your browser. Pass-and-play
     works offline on one phone; private rooms need everyone online, but nobody installs
     an app."
  4. Q: "Do I need an account?" A: "No. Tell us a name and you're in. No email, no
     password. If you play online games, a lightweight scrapbook of your history lives
     on that browser — see our privacy page for exactly what that means."
  5. Q: "What's the difference between pass-and-play and a private room?" A:
     "Pass-and-play is one device passed around the table, fully offline. A private room
     is a room code you share — everyone joins from their own phone, from anywhere."
  6. Q: "What happens if someone catches Mister White?" A: "They're not out yet — Mister
     White gets one last guess at the Civilians' secret word. Guess right, and they steal
     the win on the spot."
  7. Q: "Can we use our own words instead of the built-in packs?" A: "Yes — build a word
     pack with your own pairs (inside jokes encouraged) and bring it to the table
     alongside the official packs."
  8. Q: "Is it free?" A: "Yes. No tiers, no paywalled packs at launch."
  9. Q: "Is there voice chat?" A: "Yes — tap Join voice once you're in a room and you're
     talking to the table, no extra app. Still prefer a Discord or FaceTime call? That works
     exactly as well — plenty of tables stick with it."
  10. Q: "Do you sell my data?" A: "No. See our privacy page — the short version is we
      collect the minimum to run the game and never sell or trade it."
  11. Q: "Is there any moderation?" A: "Clues, names, and chat are free text, so we lean on
      the table and a few shared tools more than an auto-filter. Anyone playing online can
      report or block, hosts can kick, and public rooms hold a stricter line." — this is the
      one FAQ answer that carries a trailing inline link: a `Community expectations` anchor
      to `/community` (label matches the public-flow `/community` links, §17.5), rendered
      after the plain-text answer. `FaqJsonLd` keeps using the link-free `answer`, so the
      structured data never drifts from the visible text.

### §16.5 Privacy (`/privacy`) — DRAFT

- Draft banner (rendered prominently at the top of the page): "DRAFT — the product owner
  must review this page before public launch."
- Page title (visible `<h1>`): "Privacy"
- Intro: "Sketchy is guest-first: you can play with just a name — no email, no password.
  You can optionally link an email to keep your scrapbook across devices. Here's exactly
  what that means for your data, in plain language."
- Section "What we collect": "Your display name (2–20 characters) and the doodle avatar
  you build from a handful of preset shapes — never a photo, never real-world identity
  info. That's the whole guest profile. If you choose to link an account, we also store the
  email address you link — and nothing else. You can link that email two ways: an email
  magic link, or Sign in with Google (below); either way, the email address is all we keep."
- Section "Linking an email (optional)": "You can link an email to your guest identity so
  your scrapbook survives a new device or a cleared browser. We store that email, send it a
  one-time sign-in link when you ask, and use it for nothing else — no marketing, no
  newsletters, no sharing. You can play forever without linking one; public matchmaking with
  strangers is the only thing that requires it."
- Section "Sign in with Google": "Sign in with Google is an optional, alternative way to
  link an account — you never have to use it. If you choose it, all we receive from Google is
  your verified email address, used only to create or link your account exactly like the
  email option — we don't receive your Google password, contacts, or profile beyond that
  email, never post anything to your Google account, and never sell or share what we receive.
  Google runs its own sign-in flow to hand us that verified email, so Google may set its own
  cookies during it — governed by Google's privacy policy, not ours."
- Section "How your identity works": "Signing in with just a name creates a guest
  identity and a long-lived login token stored in your browser's local storage — Sketchy's
  own login is never stored in a cookie. There's no password to lose, but there's also no
  recovery flow yet: a wiped browser or a new device means a clean slate unless you'd linked
  an email (by magic link or Google) first."
- Section "Pass-and-play stays on your device": "Playing pass-and-play on one phone never
  touches our servers — the whole game (players, words, scores) lives in that browser's
  local storage until you clear it."
- Section "Online rooms": "Live online games run on our servers temporarily so everyone
  can stay in sync, and that room data expires automatically about a day after the room
  goes quiet. Once an online game finishes, we keep a summary (who played, roles, scores,
  clues, votes) tied to your guest identity so it can show up in your scrapbook —
  abandoned games get cleaned up instead of kept forever."
- Section "Word packs you create": "If you build a custom word pack, its words and pairs
  are stored so you — and anyone you share it with — can use them."
- Section "Cookies": "Sketchy sets no cookies of its own, uses no ad trackers, and does no
  cross-site tracking. Your login token and preferences live in local storage instead. The
  one exception is optional: if you choose Sign in with Google, Google may set its own
  cookies to run that sign-in (see Google's privacy policy) — you only encounter that if you
  use the Google button. We also use a crash-reporting tool for technical errors only, tagged
  with your anonymous player ID — never your words, clues, or votes."
- Section "Who we share data with": "Nobody. No selling, no ad networks, no marketing
  lists. The infrastructure providers that host the game and log crash reports process
  data only to keep the service running. If you choose Sign in with Google, Google acts as
  the identity provider for that one flow (it verifies your email and hands it to us); we
  don't send Google anything about your games."
- Section "Your control over your data": "You can delete your account any time from your
  profile: we anonymize your record on the spot — your display name, linked email, and doodle
  are scrubbed — and keep only the moderation history (reports and blocks) required to keep
  the game safe for everyone. It takes effect immediately and can't be undone. Clearing your
  browser's local storage ends your local session too, but only deleting your account removes
  the linked-account data on our side. Questions, or want a hand? Email [CONTACT_EMAIL]."
- Section "Children": "Sketchy isn't directed at children under 13, and we don't
  knowingly collect data from them."
- Section "Changes": "This policy will change as the product does — especially once named
  accounts ship. We'll update this page when it does."
- Section "Contact": "Questions about this policy: [CONTACT_EMAIL]"

### §16.6 Terms (`/terms`) — DRAFT

- Draft banner (same treatment as privacy): "DRAFT — the product owner must review this
  page before public launch."
- Page title (visible `<h1>`): "Terms"
- Intro: "The plain-language rules for playing Sketchy. Using the game means you're
  agreeing to these."
- Section "The service": "Sketchy is a social deduction party game played pass-and-play
  on one device or in private, room-code-based online rooms. It's an actively evolving
  product — features described on this site reflect what's shipped today, not a roadmap
  promise."
- Section "Your guest identity": "You play under a name you choose, without a password.
  You're responsible for the device and browser that identity lives in — we have no way
  to recover it if local storage is cleared. You can link an account two optional ways — an
  email magic link or Sign in with Google — and either upgrades your same identity in place;
  linking is required only for public matchmaking. Using Sign in with Google is also subject
  to Google's own terms."
- Section "Playing nicely": "Names, clues, chat, and word packs run through a profanity
  filter and length limits, and actions are rate-limited to keep the game fair and the
  servers healthy. Don't try to break, flood, or scrape the service."
- Section "Your content": "Custom word packs, names, and clues you submit are yours — you
  're responsible for them. We can remove content that violates the acceptable-use rule
  above."
- Section "No warranty": "Sketchy is provided as-is, actively being built, and can change
  or break without notice. We'll do our best to keep your games running smoothly, but we
  can't promise perfection."
- Section "Limitation of liability": "To the extent the law allows it, we're not liable
  for damages arising from your use of a free party game. Play at your own (very low)
  risk."
- Section "Changes": "We may update these terms as the product changes; continuing to
  play after an update means you accept the new terms."
- Section "Contact": "Questions about these terms: [CONTACT_EMAIL]"

### §16.7 SEO metadata & OG images

Titles use a site-wide template ("{page} · Sketchy"); the landing page sets its own full
title instead of using the template.

| Page       | Title                                       | Meta description                                                                                                   |
| ---------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`        | "Sketchy — the social deduction party game" | "A social deduction party game for 3–20 players. Everyone gets a secret word — except the impostors. Free pass-and-play, no app required, or host a private room." |
| `/about`   | "About"                                      | "Why we built Sketchy, what makes it different, and who it's for. No corporate mission statement." |
| `/faq`     | "FAQ"                                        | "Real answers for first-time hosts and players: player counts, accounts, pricing, voice chat, and how pass-and-play actually works." |
| `/privacy` | "Privacy"                                    | "How Sketchy handles your name, your games, and your data — in plain language." |
| `/terms`   | "Terms"                                      | "The plain-language rules for playing Sketchy: your guest identity, your content, and what we promise." |

- OG image copy (one shared card layout, per-page eyebrow/title/subtitle — never renders
  page-specific user data):
  - `/`: eyebrow "A party game for 3–20 players" · title "Sketchy" · subtitle "Everyone's
    a little sketchy."
  - `/about`: eyebrow "About" · title "So, what is Sketchy?" · subtitle "The friend who
    describes 'lighthouse' for ninety seconds."
  - `/faq`: eyebrow "FAQ" · title "Questions people actually ask" · subtitle "Player
    counts, accounts, pricing, voice chat — answered."
  - `/privacy`: eyebrow "Legal" · title "Privacy" · subtitle "Your data, in plain
    language."
  - `/terms`: eyebrow "Legal" · title "Terms" · subtitle "The plain-language rules."
  - `/r/[code]` (generic — see phase14-handoff for the noindex/no-leak rationale): eyebrow
    "Private room" · title "You're invited to a game" · subtitle "Join the table — no
    spoilers here."
- Room route metadata (never includes the room code or player names): title "Private
  room", meta description "A private Sketchy room. Ask whoever invited you for the code."

## §17 Public matchmaking, accounts & moderation (phase 16)

Tone: §12. All strings mirrored verbatim in `apps/web/src/copy.ts` under a single
`matchmaking` top-level key (with `account`, `moderation`, and `community` sub-blocks).

### §17.1 Account linking (the scrapbook upsell)

- Upsell card heading (profile + public-flow gate): **"Claim your scrapbook"**
- Upsell body: "Link an email and your games follow you to any device. No password, no
  spam — just a one-time link when you want back in. Guests keep playing private rooms
  forever without it."
- Link button: `Link my email`
- Email field: label "Email", placeholder `you@example.com`
- Send button: `Send me a link`
- Sent confirmation (enumeration-safe — same whether or not the email was free): "Check
  your email. If it can be linked, a one-time link is on its way. (No email? It happens —
  request another in a minute.)"
- Optional Google link method (rendered in the same dialog ONLY when a Google client ID is
  configured — `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; with the feature off there is no button and
  the Google script never loads): divider `or`; button label / aria "Sign in with Google"
  (Google's own branded button); disclosure line beneath it: "We only receive your verified
  email to create or link your account — nothing is posted anywhere, and we never sell or
  share it. Google may set its own cookies as part of signing in."
- 13+ age disclosure (shown in the link dialog itself, beneath both link methods, since the
  dialog is where an account is actually created — the privacy policy + terms state it too):
  "You must be 13 or older to create a Sketchy account."
- Link-verify page (`/link`) — loading: "Linking your scrapbook…" · success: "You're
  linked. Your scrapbook is safe now." `Back to the table` · failure (expired/used/bad):
  "That link's expired or already used. Request a fresh one from your profile." `Back to home`
- Public-flow gate (shown when a guest taps a public action): heading "Accounts unlock
  strangers" — body: "Playing with people you haven't met needs a linked email — it's how
  reports and blocks actually mean something. Private rooms never do." — `Link my email` /
  `Keep it private`
- Guest-caveat REPLACEMENT (profile `guest-caveat.tsx`, replaces the "nobody's built those
  yet" line): "This scrapbook lives on this browser. Link an email to keep it across
  devices — or keep playing as a guest, your call."
- Delete-account section (profile `delete-account-card.tsx`, shown ONLY for a linked
  account — guests have nothing to delete). Danger styling, type-to-confirm guarded:
  - Heading **"Delete account"** — blurb: "Anonymize your record and unlink your email. This
    is the danger zone — it can't be undone." — trigger button: `Delete account`
  - Confirm dialog warning: "This scrubs your name, linked email, and doodle for good, and
    logs you out here. We keep an anonymized record only where it's needed to keep the game
    safe — the moderation history tied to any reports or blocks. There's no undo."
  - Type-to-confirm: label "Type DELETE to confirm"; the destructive button stays disabled
    until the field exactly matches the word `DELETE`.
  - Buttons: `Delete my account` (destructive) / `Keep my account` (cancel); in-flight:
    "Deleting…"; success: "Your account has been deleted. Thanks for playing."

### §17.2 Public rooms & the browser

- Visibility toggle (lobby settings / create-room, linked-account hosts only): label **"Make
  this room public"** — helper: "Public rooms show up in the browser and quick-join. Timers
  on, spice roles off, voice off — the stranger-safe defaults." — guest-disabled helper:
  "Link an email to host a public room."
- Public-room chip (lobby header, when public): "Public table"
- Browser screen (`/lobbies`) title: **"Find a table"** — subtitle: "Public rooms looking
  for players right now."
- Browser row: "{hostName}'s table" · "{playerCount}/{maxPlayers} players" · `Join`
- Browser empty state (reuses §9): "Nobody's hosting right now. Be the somebody." — with a
  `Host a public room` action.
- Browser refresh: `Refresh` · load-more: `Load more tables`
- Browser sign-in gate (visitor without a session yet — browsing the list needs an account,
  same rule the server enforces): "Sign in to browse public tables." with the `Link my email`
  affordance (the §17.1 gate dialog).

### §17.3 Quick join

- Entry button (home, linked accounts): `Quick join` — helper: "Drop into a game with
  whoever's around."
- Searching state: heading **"Finding you a table…"** — body: "Matching you with players
  looking for a game. Hang tight — this is usually quick." — `Cancel`
- 90-second no-match fallback: "Still quiet out there. Want to start a table of your own and
  let others find you?" — `Host a public room` / `Keep waiting`
- Matched toast (right before the room loads): "Found one. Taking you in…"
- Error state (enqueue rejected — rate-limit / suspension / validation — or the socket/network
  drops): heading **"Couldn't join a table"** with the mapped `errors.*` line as body (e.g.
  `rateLimited`, `suspended`, or offline → `networkOffline`) — `Try again` / `Cancel`

### §17.4 Reporting & blocking

- Player-card menu actions (tap another player's card): `Report` · `Block` · host-only:
  `Kick & report`
- Report/block affordance screen-reader label (the visible control reads "Report · Block"
  identically for every player): "Report or block {name}"
- Report/block menu dialog description (screen-reader only — no room for a visible line above
  the action buttons): "Choose what to do about {name}."
- Report dialog title: "Report {name}?" — body: "Tell us what's off. This goes to a human,
  with the room's recent chat and clues for context." — reason labels: `Their name` /
  `Chat` / `Clues` / `Something else` — detail field label "Anything to add? (optional)",
  placeholder "What happened…" — `Send report` / `Never mind`
- Report sent toast: "Thanks — we're on it. They won't know who reported them."
- Block dialog title: "Block {name}?" — body: "You won't be matched with them again, and
  their messages get hidden for you. You can undo this anytime." — `Block them` / `Cancel`
- Blocked toast: "Blocked. You won't cross paths in matchmaking again."
- Unblock (profile / block list): `Unblock` — list header **"Blocked players"** — empty:
  "You haven't blocked anyone. A peaceful existence."
- Kick & report confirm (host): "Kick and report {name}? They're out of this room, and a
  human reviews the report." — `Kick & report` / `Cancel`
- Blocked-in-room chat note (where a blocked player's message would show): "Message hidden
  (blocked)."

### §17.5 Community expectations (`/community`, one-pager linked from public flows)

- Page title (visible `<h1>`): "How we play nice"
- Intro: "Sketchy is bluffing, accusing, and dramatic betrayal — all in good fun. Here's the
  short version of keeping it fun for everyone at the table."
- Do list heading: **"The vibe"** — items: "Play to win, not to wound — tease the table,
  not the person." · "Keep names, clues, and chat printable. Public rooms hold a stricter
  line." · "Assume good faith. Everyone's new at some point." · "Lost? Ask. Winning by
  confusion is a Mister White move, not a house rule."
- Not-cool heading: **"Not cool anywhere"** — items: "Slurs, harassment, or targeting
  someone — instant exit." · "Sharing anyone's real-world info." · "Trying to break, flood,
  or scrape the game."
- Tools heading: **"You've got tools"** — body: "See something off? **Report** it (a human
  reviews it, with context) or **Block** the player (you won't be matched again). Hosts can
  kick, and repeat offenders get warned or suspended."
- Closing: "That's it. Be the friend people want at the table." — CTA `Back`
- Public-flow footer link (lobby/browser/quick-join): `Community expectations`
