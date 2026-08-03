# Game Design — screens, flow, and real-time behavior

> The moment-to-moment experience for both modes. All user-facing text lives in
> [copy.md](copy.md) (referenced as `copy §n`); visual treatment lives in
> [design-party-pop.md](design-party-pop.md); state/redaction in [data-model.md](data-model.md);
> events in [api-contract.md](api-contract.md). Rules follow `research/01-GAME-RULES.md`
> with the decisions in §7 locked here.

## 1. Design pillars

1. **Glanceable state, always.** At any second, any player can answer: what phase is it, who
   are we waiting on, how long is left. One persistent status strip owns this (§3.1). This is
   also the Discord-friendliness requirement — remote groups talk on a call; the screen must
   never _require_ audio narration.
2. **Privacy is a physical ritual.** Secret words are revealed behind a deliberate
   press-and-hold interaction ("peek"), never printed on an idle screen — in both modes.
   Release = hidden again. This protects pass-and-play handoffs and screen-sharers alike.
3. **Drama gets rendered.** The three spikes — role deal, elimination reveal, Mr. White's
   guess — get full-screen sequences with Party Pop motion (design-party-pop.md §7), not
   toasts. Everything else stays quick and quiet.
4. **Never block on a ghost.** Every wait ("X is typing their clue…") has a visible timer and
   a host escape hatch. A disconnected player can stall nothing for more than the grace window.

## 2. Screen map

```
Home ─┬─ Pass & Play setup ── P&P game loop (§4)
      ├─ Create room ──┐
      ├─ Join room ────┴─ Lobby (§5) ── Deal (§6.1) ── ┌────────────────────────┐
      │      ▲                                         │ Clue → Discussion →     │
      │      └── invite link /r/CODE                   │ Vote → Reveal ─┬─ round │
      ├─ How to play (tutorial, phase 14)              │      Mr.White guess?    │
      ├─ Word packs (mine / official, phase 11)        └───────┬────────────────┘
      └─ Profile & history (phase 10)                     Game over ── Rematch ↺ lobby
```

Routes (web): `/` home · `/play` pass-and-play · `/r/[code]` room (lobby+game, one route —
the phase drives the view) · `/packs`, `/profile`, `/how-to-play`. The room route is a
client component fed exclusively by socket snapshots.

## 3. Shared in-game chrome

### 3.1 Status strip (persistent, top)

Phase name + timer ring (PopTimerRing, from `phaseEndsAt`) + round number + "waiting on" avatars.
In lobby: room code, huge, with copy button and **Copy invite message** (paste-ready blurb for
Discord — copy §4).

### 3.2 Player strip

All players as avatar cards in seat order: name, connection dot ( when live / faded +
"reconnecting…" spinner when in grace, copy §8), elimination state (row flips to a
`bg-undercover` "OUT" row with an ink role tag — design-party-pop.md §11), current-turn
highlight (row flips to a tilted `bg-civilian` card — §11), "has voted" checkmark during
voting, mute/speaking ring when voice lands (phase 15). Host gets an `IconCrown` chip.
Tapping a card (host only) opens kick/transfer-host actions.

### 3.3 Clue board

The heart of deduction: a board of clue cards, grouped by round, each card signed with the
author's avatar. Skipped turns render as a muted "skipped" card (copy §6). The board is
scrollable history — during voting it stays visible side-by-side
(desktop) or one swipe away (mobile web) so votes are cast against evidence.

### 3.4 Chat drawer

Text chat (socket `chat:send`) — secondary to Discord but essential for eliminated players
and quiet groups. Badge on unread. Ghosts' messages get a wavy "from beyond" style.

## 4. Pass-and-play flow (one device, fully offline — engine in browser)

1. **Setup** (`/play`): add player names (chips, 3–20; warn under 4 — copy §5), pick packs +
   difficulty, role counts pre-filled from `suggestRoleCounts()` with steppers (validation:
   civilians must outnumber others at start), optional special-role toggles (phase 12+).
2. **Pass ritual** per player: full-screen "Pass to **{name}**" interstitial (copy §5) → they
   tap "That's me" → press-and-hold card flip reveals _their_ word (or Mr. White's blank
   card, copy §3) → release hides → "Pass on" → next. `hasSeenWord` gates progression.
3. **Clue rounds**: the app is the _tracker_, clues are spoken aloud. It shows whose turn it
   is in seat order; "next" advances. (Optionally the holder types a 1-word note onto the
   clue board — default off, setting on.)
4. **Vote**: device passes around once more for secret ballots (tap a suspect card,
   confirm, "pass to next voter"), or host uses "open vote" mode: one screen, tally steppers
   while the table points fingers. Default: secret ballots.
5. **Reveal / Mr. White guess / win**: identical dramatic sequences to online (§6.4–6.6),
   driven by the same engine reducer locally. Scoreboard persists across rematches in
   localStorage; "Play again" reuses names/settings with a fresh pair.
6. **Resume**: an interrupted game (tab closed) offers "Resume last game?" on `/play` from
   the localStorage snapshot.

## 5. Online: create → join → lobby

- **Create**: one tap from Home → `POST /rooms` → land in lobby as host. Settings live in a
  drawer (packs, difficulties, role counts auto-suggested per player count, timers with an
  "untimed / we're on a call" preset, special roles later). Every settings change broadcasts
  a snapshot; non-hosts see settings read-only, live.
- **Join**: enter code (5-char, unambiguous alphabet, auto-uppercased) or open invite link
  `/r/CODE`. `GET /rooms/:code` pre-validates and routes to friendly errors (full /
  in-progress / not found — copy §9) _before_ the socket join. First-time players get the
  displayName prompt inline (guest auth happens here, invisibly).
- **Lobby**: player strip fills live; ready checks (host can start when all ready, or
  force-start after a confirm); avatar doodle picker; chat open; "how to play" cheat-sheet
  card for newcomers. Host can kick. Room code is the hero element of the screen.
- Lobby idles >24h → room expires (Redis TTL); anyone left sees "room expired" (copy §9).

## 6. Online: the loop

### 6.1 Deal ("dealing" phase)

Full-screen face-down card. Press-and-hold to flip: role + word (or
Mr. White's blank — copy §3 role cards, including "civilians vs undercovers count is public,
who's who isn't"). Release → face down. "Got it" button = `deal:ack`. Status strip shows
"waiting on N players to peek". Timer (45 s) auto-acks laggards; host can extend once.
Seat 0 is guaranteed non-Mr.-White by default (`mrWhiteFirstClueBan`, research 05).

### 6.2 Clue phase

Turn spotlight walks the player strip in seat order (alive players only). Turn-holder gets
the input ("one word or short phrase", 40-char cap); everyone else sees "️ {name} is
writing…". Submit → the clue card pops onto the board (Pop-in, design-party-pop.md §7). Server rejects
repeats/secret word with inline errors (copy §9: `clue_repeated`, `clue_is_secret_word`).
Timer per turn (default 60 s; untimed preset for call-based groups); expiry or host
`turn:skip` → a muted "skipped" card. Round ends when every alive player has a card.

### 6.3 Discussion phase

Timer (default 120 s), clue board front and center, chat open, no structured actions —
this phase exists for the call/table argument. Host can `phase:advance` to voting early
(button: copy §6) or extend the timer once by 60 s.

### 6.4 Voting phase

Suspect grid of alive players (self disabled). Tap → confirm → ballot cast; you can change
it until the vote closes. Others see only the "voted" checkmark + running count ("6/8 have
voted"), never who→whom. Vote closes when all alive have voted or the timer ends
(non-voters abstain). Tally logic (engine):

- Clear plurality → `reveal` with `pendingElimination` — UNLESS the sole top-voted player
  holds the Mirror role and hasn't used their one-shot power yet (phase 13): the vote
  bounces (every ballot against them redirects onto its own caster) and the ADJUSTED
  tally's top scorer is eliminated instead, Mirror survives. If the bounce itself ties,
  it falls into the same tie handling below (never a second bounce).
- **Tie** → `tiebreak_clue`: tied players (flagged with a highlight tag) each give one
  extra clue, then a re-vote **among tied players only**. Second tie → nobody eliminated
  this round (copy §6 defuses it: "The table can't decide…"). If the Judge role is enabled,
  the tie instead routes to the Judge (`special:judge`) — announced to all (phase 12). The
  Judge's decision (and its own timeout/host-escape default) is NEVER subject to the
  Mirror's bounce — that mechanic only ever fires on a genuine vote plurality (phase 13).
- All abstain → nobody eliminated, next round.

### 6.5 Reveal

Full-screen sequence: the accused's card flips with a beat of suspense → role revealed
(copy §7: distinct lines per role — the "not sus after all" civilian gut-punch included).
Word reveal follows `settings.eliminationReveal` (default: role only — keeps the pair
guessable across rematches). Eliminated player's card flips to the `bg-undercover` "OUT" row
in the strip; they become a spectator (or Ghost if enabled — keeps voting/chat rights,
phase 12). Host (or 8-s
auto-advance) continues → win check → next round or game over.

**Chained reveals (phase 13):** if the eliminated player holds the Lovebirds role, their
still-alive partner falls too, in the SAME reveal sequence — a second card flips right
after the first (a Mr. White partner still gets their own guess window). If the eliminated
player holds the Grudge role, once THEIR card is shown the game pauses on a `grudge_decision`
screen ("who's coming with you?", 30s) before continuing; picking nobody is a valid outcome.
Either mechanic can chain into the other (a Grudge-dragged Lovebird still pulls their
partner). The win check only ever runs ONCE, after the whole chain — however long — finishes
resolving, never after an intermediate card.

### 6.6 Mr. White's guess

If the eliminated player is Mr. White: interrupt sequence, spotlight on them, 30-s timer,
single text input ("one shot", copy §7). Everyone else watches a "Mr. White is
guessing…" screen — deliberately tense. Match = case/diacritic-insensitive exact (engine).
Correct → instant Mr. White win screen. Wrong → elimination stands, the wrong guess is shown
to everyone (always a laugh), play continues.

### 6.7 Game over & rematch

Winner splash per faction (copy §7): a full-bleed winning-faction color takeover
(design-party-pop.md §10) with flat sticker confetti; full table reveal (everyone's
role + both words); points awarded (2/6/10 — engine/copy §7) onto the session scoreboard;
lifetime stats persist (phase 10). Host CTA: "Rematch" (same seats/settings, fresh pair,
scoreboard carries) or "Back to lobby" (reshuffle players/settings). Non-hosts see "waiting
for host" + leave option.

## 7. Locked rule decisions (the research doc's open questions, answered)

| Question (research/README) | Decision                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Wrong-vote consequence     | Standard: eliminated civilian is simply out; no extra penalty (pocketparty's harsher variant rejected — feels bad with friends). |
| Tie rule                   | Sudden-death extra clue + re-vote among tied; second tie = no elimination. Judge role supersedes when enabled.                   |
| Mode priority              | Pass-and-play first playable (phase 4), online rooms immediately after (phases 5–8), public matchmaking phase 16.                |
| Scoring                    | Persistent 2/6/10 (civilian/mr.white/undercover) + session scoreboard across rematches.                                          |
| Special roles              | Data model supports from day one (`specialRole` field); shipped in waves (phases 12–13).                                         |
| Clue uniqueness            | No repeats across the whole game (stricter pnwchords rule) — engine-enforced online, honor-system prompt in pass-and-play.       |
| Eliminations per round     | Always 1 (the 2-per-round large-group variant is a possible future setting, not in roadmap).                                     |

## 8. Real-time resilience (the part that makes it feel production-grade)

**Loading states.** Room route renders instantly with a skeleton (placeholder cards)
until the first snapshot; every action button goes into a pressed-in pending state
until its ack; failed acks toast the mapped error copy. No spinner ever blocks the whole
screen after the first snapshot.

**Disconnects (someone else).** Socket drop starts a **90-second grace window**: their card
fades + "reconnecting…", game continues around them where possible. If it's _their_ clue
turn, their turn timer keeps running (host may `turn:skip` sooner). In voting, they simply
abstain if still gone at close. After grace expires the host gets a nudge: "Skip them for
now? They can still rejoin." (copy §8) — skipped-not-removed; a rejoining player re-enters
alive at the next phase boundary.

**Reconnects (you).** socket.io auto-reconnect → `room:sync` → full snapshot → UI restores
mid-phase, including your private slice (your word is never lost). Phone lock/tab-hide then
return triggers the same resync on visibility change. The "you" experience of a blip is: a
thin "reconnecting…" banner, then the exact screen you left.

**Rejoin after full close.** Reopening the invite link (or the site — active room code is in
localStorage, offering "Rejoin room CODE?") re-authenticates with the stored JWT and
`room:join`s: same playerId ⇒ same seat, same role, same word. Works from a _different
device_ too (same token via logged-in identity later; at launch, same browser).

**Host disconnect → migration.** Host loses connection for >grace: host badge auto-migrates
to the longest-connected alive player (`hostChanged` event, copy §8). Original host rejoining
does NOT reclaim automatically (avoids flapping); the new host can hand it back via the
player-card action. If the host _leaves_ explicitly, migration is immediate.

**Abandoned rooms.** All players disconnected >10 min mid-game → room marked abandoned
(persisted as unfinished, then reaped); lobby rooms simply expire on TTL.

**Simultaneity.** Votes land concurrently: engine applies them serially via the Redis
CAS discipline (data-model §2); last write per voter wins until close. Double-submit of the
same action is idempotent (`already_voted` acks as ok:false but harmless).

**Clocks.** All countdowns derive from server `phaseEndsAt` + measured offset — two players
never disagree about whether voting closed (the server's timeout action is the referee).

## 9. Eliminated-player experience

Elimination ≠ ejection. Spectators keep: full clue board, chat (wavy ghost styling), vote
_visibility_ (counts, not ballots), reveal sequences. They lose: clue input, ballots
(unless Ghost role enabled — then they keep voting, phase 12), and they still never see
living players' secrets (redaction is server-side). A subtle "you're out — heckling
encouraged" banner (copy §8) sets the tone. This directly attacks the genre's
first-out-is-bored problem (research 03).

## 10. Voice UX (Discord-first now, LiveKit at phase 15)

- Now: "Copy invite message" everywhere the code appears; untimed-phases preset; nothing
  audio-gated. A lobby hint suggests hopping on a call (copy §4).
- Phase 15: "Join voice" pill in the status strip → mic permission → connected; speaking
  ring + mute state on player cards (`voice:state`); push-to-mute; voice auto-joins on room
  entry _only_ if the player opted in previously. Voice presence is cosmetic to the engine —
  game state never depends on it. Off by default in public rooms (phase 16).
