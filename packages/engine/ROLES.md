# Special roles — the pattern (phase 12, wave 1)

> Short reference for wave 2 (phase 13) and beyond. Wave 1 shipped the Judge, the Ghost, and
> the Jester (`arch/plan/phase12.md`); this doc extracts the reusable shape so a later wave
> can plug in without re-deriving it. See `arch/data-model.md` "Phase 12 engine extension"
> for the full prose write-up, and `arch/copy.md §3.2` for the finalized copy of every role
> (including the five not implemented yet).

## 1. Two kinds of special role

Every entry in `SpecialRole` (`src/types.ts`) is one of:

1. **A single-holder role** — assigned to exactly one random eligible player at deal time,
   layered on top of their base civilian/undercover/mrwhite role. Tracked on
   `GamePlayer.specialRole`. Wave 1: `judge`, `jester`. (Wave 2: `lovebirds`, `grudge`,
   `mirror`, `rivals`, `mime` — already listed in `ASSIGNABLE_SPECIAL_ROLES`,
   `reducers/deal.ts`, ready for their gameplay hooks.)
2. **A room-wide setting** — enabled by `settings.specialRoles.includes(role)`, applies
   uniformly to every player (or every eliminated player), never assigns a holder, never
   touches `specialRole`. Wave 1: `ghost`. It's the odd one out and is deliberately EXCLUDED
   from `ASSIGNABLE_SPECIAL_ROLES` — do not add it there.

Deciding which kind a new role is (research/03-SPECIAL-ROLES-VARIANTS.md describes the
source mechanic) is the first design call for wave 2; almost everything below only applies
to kind 1.

## 2. The assignment framework (single-holder roles)

`reducers/deal.ts`:

- `ASSIGNABLE_SPECIAL_ROLES: SpecialRole[]` — the deterministic order roles get assigned in
  (matters only for reproducibility given a seed, not gameplay). Add a new wave-2 role here.
- `eligibleForSpecialRole(role, candidates)` — per-role eligibility filter. Wave 1's Judge
  and Jester have none (any seated player qualifies). A wave-2 role with a real constraint
  (e.g. excluding a role that only makes sense for an alive/undercover-only holder) adds a
  branch here — the function's whole job is to narrow `candidates` before the random pick.
- `assignSpecialRoles(settings, players, rng)` — the loop: for each ENABLED role in
  `ASSIGNABLE_SPECIAL_ROLES`, draw one random ELIGIBLE, UNASSIGNED player and give them that
  `specialRole`. At most one special role per player (a player already holding one is
  excluded from later roles' candidate pools automatically). Called from `dealRoles` AFTER
  the base role/word deal, drawing from the SAME per-deal `Rng` — determinism only depends
  on `state.seed` + `state.gamesPlayedInRoom`, same as every other deal-time draw.
  `dealRoles`'s own player-reset map sets `specialRole: null` on everyone first (mirroring
  its `role`/`word`/`alive`/`eliminatedRound` resets) — `assignSpecialRoles` relies on that.

Settings validation: `constants.ts` `SPECIAL_ROLE_MIN_PLAYERS` is a `Partial<Record<
SpecialRole, number>>` — a role ABSENT from the map has no requirement beyond the game's own
`MIN_PLAYERS` (3); present entries are checked by `reducers/shared.ts`
`isValidSpecialRoles(specialRoles, playerCount)`, wired into `isValidSettingsForLobby`
(against `settings.maxPlayers`, at `lobby:settings` time) and re-checked against the ACTUAL
seated count at `start`/`rematch` — the exact same two-call-site pattern `isValidRoleMath`
already uses. Adding a wave-2 role with a real player-count floor is a one-line addition to
that map; nothing else needs to change.

## 3. In-game hooks

Each role's actual gameplay effect lives wherever it's mechanically relevant — there is no
central "special role dispatcher". Wave 1's three:

- **Judge** (`reducers/vote.ts`): `closeVote`'s first-tie branch (`revoteCount === 0`) checks
  `state.players.find(p => p.specialRole === 'judge')` — alive OR eliminated, deliberately no
  `.alive` filter (research/03: "stays active even after she herself is eliminated") — and if
  found, routes to the new `judge_decision` phase instead of `tiebreak_clue`, and latches
  `GameState.judgeRevealed = true`. The new `judgeDecide` action (`applyJudgeDecide`,
  `reducers/vote.ts`) resolves it: actor must hold `specialRole === 'judge'`, `targetId` must
  be one of `tiedPlayerIds`, resolution mirrors `closeVote`'s clean-plurality branch exactly
  (elimination + `revealRole`/timer effects). `judge_decision` is timed
  (`JUDGE_DECISION_TIMEOUT_SEC`, constants.ts) — both `timeout{judge_decision}` and the
  host's early `advancePhase` fall through to `resolveJudgeDecisionByDefault`
  (`reducers/vote.ts`), which eliminates a deterministic random pick from `tiedPlayerIds`
  (seeded RNG, same convention as `assignSpecialRoles`) so an unreachable Judge can never
  stall the game — this was an open gap at the end of phase 12 itself, closed as a
  follow-up before phase 13 started. **This is the shape any future wave should copy** for
  a special-power decision phase that can otherwise wait on one specific player forever:
  give it a real timeout constant, implement its `applyTimeout` case for real, and add it to
  `applyAdvancePhase`'s host-escape-hatch set — don't ship the "phase exists, no way out"
  half of it.
- **Ghost** (`reducers/vote.ts`): a pure `settings.specialRoles.includes('ghost')` branch in
  both `eligibleVoterIds` (the "everyone voted" gate) and `applyCastVote` (the actor-alive
  check) — eliminated players become eligible voters, on top of the always-eligible
  alive/not-left set. No new state, no `specialRole` ever set to `'ghost'`. Chat for
  eliminated players was already unconditional before this phase existed
  (`sockets/lobby.ts`) — Ghost doesn't touch that.
- **Jester** (`reducers/shared.ts` `applyJesterFirstOutBonus`): +`JESTER_FIRST_OUT_BONUS`
  (constants.ts) awarded IMMEDIATELY at the moment of elimination — not deferred to
  game-over scoring — if (a) the eliminated player holds `specialRole === 'jester'` and (b)
  no OTHER player has a non-null `eliminatedRound` yet (checked against the PRE-elimination
  player list). Called from both places an elimination can be decided:
  `closeVote`'s clean-plurality branch and `applyJudgeDecide`. No new state field — the
  bonus folds straight into the existing `scoreboard`, and any client wanting to show "why"
  can re-derive "was there a first-out Jester" purely from the now-public
  `eliminatedRound`/`specialRole` fields (§4 below) — same trick the win screen already uses
  for the ordinary 2/6/10 deltas.

**Pattern for wave 2**: find the ONE reducer/phase transition the role's mechanic actually
touches (a vote close, an elimination, a phase entry) and add a narrow, settings/specialRole
-gated branch there, same as the three above — resist the urge to build a generic "special
role effects" indirection layer. Three roles didn't justify one; five more might, but decide
that when they exist, not preemptively.

## 6. Wave 2 (phase 13): Lovebirds, Grudge, Mirror, Rivals, Mime

Five more roles shipped in phase 13. Verdict on the "resist a generic dispatcher" guidance
above: still resisted for FOUR of the five (Mirror is a narrow branch in `closeVote`; Rivals
is a narrow scoring function called from the two game-over paths; Mime is a narrow branch in
`enterNextClueRound` + one field on `Clue`) — but Lovebirds and Grudge share a REAL, non-
trivial state machine (chained, one-card-at-a-time reveals with a single deferred win-check),
so that ONE piece — and only that piece — got its own module, `reducers/cascade.ts`. This is
the "a small shared helper is fine and expected" case the wave-1 note above anticipated; it
is NOT a general special-role dispatcher (nothing routes generically on `specialRole`
anywhere in `cascade.ts` — it exposes named functions for named mechanics, same as every
other reducer file).

### Kind assignment (§1's two kinds, revisited)

- **Kind 1 (single-holder, `ASSIGNABLE_SPECIAL_ROLES`)**: `mirror`, `grudge`. Plus two NEW
  **paired** single-holder roles that draw TWO distinct holders instead of one:
  `lovebirds`, `rivals` (`PAIRED_SPECIAL_ROLES`, constants.ts — `assignSpecialRoles`,
  `reducers/deal.ts`, generalizes its draw loop to "N distinct picks" instead of hard-coding
  1). The pair LINK itself is never stored as a new field — `reducers/shared.ts`
  `pairedPartnerId`/`aliveLovebirdsPartner` derive "the other player holding this same
  paired role" on demand (at most one pair per paired role can exist per game, since each is
  only ever assigned once). The partner's NAME is public (`GamePlayer.name` is never
  redacted) — only the LINK is secret, so a `you`-slice field carrying just the partner's
  ID (never a whole redacted player) is sufficient for a client to render "linked to
  {name}" without any new redaction exception.
- **Kind 2 (room-wide setting)**: `mime`, alongside wave 1's `ghost`. Mime is the
  interesting case: naively it looks like a kind-1 role ("give one random player the mime
  behavior"), but the mechanic is "a DIFFERENT random alive player EACH ROUND" — that does
  NOT fit "one holder, assigned once at deal time, for the whole game". Forcing it into kind
  1 would mean the SAME player mimes every single round, which is wrong. So `mime` is
  EXCLUDED from `ASSIGNABLE_SPECIAL_ROLES` (same as `ghost`) and instead gets its own
  per-round derivation: `reducers/clue.ts` `drawMimeForRound`, called from
  `enterNextClueRound` every time a fresh round begins, seeded by
  `${seed}:mime:${gamesPlayedInRoom}:${round}` (the same per-purpose-fresh-generator
  convention as `assignSpecialRoles`/`resolveJudgeDecisionByDefault`) so replays stay
  identical. The result is stored on `GameState.mimeId` (unlike Ghost, which needs no state
  at all — Mime's identity changes every round, so SOMETHING has to remember "who, right
  now") and a `Clue.mimed` boolean is stamped at record time so the clue board stays
  historically accurate across rounds even after `mimeId` moves on.

### The cascade (Lovebirds + Grudge), `reducers/cascade.ts`

Two additive `GameState` fields carry a chained-elimination sequence across phase
transitions (arch/data-model.md "Phase 13 engine extension" has the full field-by-field
write-up): `pendingCascade: string[]` (a queue of already-eliminated player ids still
awaiting their own reveal card) and `mirrorBounced: boolean` (a reveal-flavor flag, see
below). The frozen `pendingElimination: string | null` is deliberately left ALONE — it keeps
meaning exactly what it always meant ("the ONE card currently showing"); the queue is a new,
separate field rather than a repurposing of the old one.

The shape: `enterCascadeReveal` (called from `closeVote`'s clean-plurality branch, the
Mirror bounce, and `applyJudgeDecide`/`resolveJudgeDecisionByDefault`) marks the primary
eliminated player, checks for an alive Lovebirds partner and marks/queues them too if found,
then enters `reveal` for the primary. Each time a card's reveal is dismissed (host
`continueReveal`/`advancePhase`, or a timeout — reveal.ts's `resolveRevealPhase`, or a wrong
Mr. White guess — reveal.ts's `resolveGuess`), `advanceCascadeOrResolve` runs: if the
JUST-shown card belongs to the Grudge (and they haven't used their power), it opens
`grudge_decision` (a new phase, mirroring `judge_decision`'s shape exactly — real 30s
timeout constant `GRUDGE_DECISION_TIMEOUT_SEC`, a real `applyTimeout` case, AND a real
`applyAdvancePhase` host-escape-hatch case, all wired from the start per this doc's own §3
guidance); otherwise it pops the next queued card (if any) or — once the queue is fully
drained — hands off to `resolveAfterElimination` (departures + `checkWin` + next round).
`checkWin` is invoked from EXACTLY that one place, so however many players a chain takes
down, the win-check only ever runs once, after the last of them.

`applyGrudgeDrag` (the Grudge's own decision) marks their chosen target eliminated, checks
that target for an alive Lovebirds partner too (so a Grudge-dragged Lovebird still cascades
their partner — bounded because a player can hold only one special role, so at most one
Grudge and one Lovebirds pair can ever exist per game), and continues the queue.
`resolveGrudgeDecisionByDefault` — UNLIKE the Judge's default, which must always name
someone — defaults to dragging **nobody** (copy.md §3.2: "defaults to nobody on expiry"),
since "no drag" is itself a perfectly ordinary outcome of this power, not a liveness
failure to paper over.

Termination is structural, not just tested (though it IS tested — the 20-seed fuzz in
`__tests__/special-roles-wave2.test.ts`): a player is only ever queued via
`aliveLovebirdsPartner`, which filters to `alive: true` — an already-eliminated player can
never be re-queued, so the chain can grow by at most (primary + their partner) + (one
Grudge drag + that target's partner) = 4 eliminations from a single vote close, strictly
bounded by the number of paired-role holders that can ever exist (2 lovebirds + 1 grudge,
since grudge is never itself paired).

### Mirror's boundary (the one rule most worth getting wrong)

"Mirror triggers ONLY on vote pluralities" is enforced by NEVER checking for
`specialRole === 'mirror'` anywhere except `closeVote`'s clean-plurality branch
(`reducers/vote.ts`). A Judge's decision (`applyJudgeDecide`), that decision's own
timeout/host-escape default (`resolveJudgeDecisionByDefault`), and a Grudge's drag
(`applyGrudgeDrag`) all resolve straight through `enterCascadeReveal` with
`mirrorBounced: false` hard-coded — there is no branch in any of them that could ever
re-trigger a bounce, by construction, not by a runtime guard that could be forgotten later.

The bounce itself (`resolveMirrorBounce`, `reducers/vote.ts`) eliminates **the most-voted
player AMONG THE BOUNCERS** — the voters who cast a ballot against the Mirror (plan/phase13.md
task 3, the canonical spec). Each bouncer's ballot redirects onto its own caster, so every
alive bouncer starts with one self-vote; a bouncer who ALSO drew ordinary votes that round
accrues those too, which is what lets one bouncer uniquely top the rest (a clean, deterministic
redirect). If the top bouncers tie, it routes to the standard tiebreak flow among **those
bouncers only**. Candidacy is deliberately RESTRICTED to the bouncers: a third player who
merely collected ordinary votes that round — but never voted the Mirror — is NEVER eliminated
by the bounce, nor dragged into a bounce-caused tie, even if their ordinary vote count exceeds
any single bouncer's lone self-vote. (An earlier implementation scored the plurality over the
whole adjusted ballot set and could scapegoat such a bystander — the mechanic-level regression
test in `vote.test.ts` now pins the bouncers-only rule.) The one exception to "redirect onto
the caster" is a caster who is an eliminated Ghost (phase 12's `settings.specialRoles`
containing `'ghost'`): their ballot still counts toward the ORIGINAL tally that gave the Mirror
its plurality (a Ghost's vote is a genuine "bouncer" ballot), but a dead player can't sensibly
"fall" a second time, so it's dropped rather than silently overwriting their real
`eliminatedRound` — and they are not an elimination candidate.

`GameState.mirrorBounced` decorates the reveal with a distinct "the vote bounced" beat
WITHOUT ever naming the Mirror — a deliberate asymmetry with the Judge's `judgeRevealed`
(data-model.md §4): the Judge's identity is intentionally announced to everyone the moment
their power activates; the Mirror's is not (research/03 doesn't ask for it, and copy.md's
own bounce framing — "the first mob that comes for you will regret it" — reads as staying
anonymous). If a bounce itself produces a tie among bouncers, `mirrorBounced` is NOT carried
through that tie into the eventual elimination (documented scope decision — see
`resolveMirrorBounce`'s comment) — the distinct beat only decorates a direct redirect.

### Rivals scoring

Applied ONCE, at game-over time, from BOTH ways a game can end (`enterGameOverForWin` AND
`enterGameOverForGuess`, `reducers/cascade.ts`) — never mid-game, unlike the Jester's
immediate bonus. "First eliminated" is derived purely from `eliminatedRound`, ranking
`null` (never eliminated) as `Infinity` so a single comparison covers every case: both
survived (equal rank, no points), both eliminated the SAME round — e.g. one was a cascade
member of the other's chain (equal rank, no points — a documented tiebreak decision, treated
the same as "both survived" since there's no reliable sub-round ordering), or a genuine
earlier/later split (the earlier one loses `RIVALS_POINT_DELTA`, the later one gains it).

### Settings guardrails: the total-slot budget

`reducers/shared.ts` `isValidSpecialRoles` gained a SECOND check beyond wave 1's per-role
minimum: the sum of every enabled role's holder "slots"
(`specialRoleSlotCount` — 0 for room-wide settings, 2 for a paired role, 1 otherwise) must
not exceed `floor(playerCount / 2)` (plan/phase13.md task 7 — keeps the number of
simultaneously-spicy seats legible at a glance). This is a REAL behavior change from wave 1:
a 3-player table enabling `judge` + `ghost` + `jester` together used to be valid (no
per-role floor for any of the three) and is now rejected (2 non-zero-cost slots >
`floor(3/2) = 1`) — `reducers/deal.test.ts` documents this explicitly as a phase 13 change,
not a regression.

## 4. Redaction

`specialRole` is SECRET by default — hidden for any ALIVE player who isn't the viewer, same
as their base `role` (`redact-for.ts` `redactPlayer`'s `roleVisible`). It becomes visible the
instant a player is eliminated (again, same as `role`) or once `game_over`. The ONE
exception wave 1 adds: the Judge's `specialRole` becomes public EARLY — the moment
`judgeRevealed` latches true — even while they're still alive, independent of whether their
base `role` has leaked. This is intentionally a SEPARATE boolean expression
(`specialRoleVisible`, not a reuse of `roleVisible`) — a future role that needs its own early
public-reveal condition should add its own OR-branch next to the Judge's, not generalize the
mechanism until there's a second real case.

`GameState.judgeRevealed` itself never reaches the client — `RedactedGameState` has no such
field. A client that wants to render "the Judge is {name}" (e.g. a permanent badge on their
player-strip card once revealed) just reads `player.specialRole === 'judge'` off the ordinary
redacted snapshot; the boolean is purely an engine-internal latch driving that field's
visibility.

## 5. Tests

Every wave-1 behavior above has coverage co-located with the reducer it lives in:
`reducers/deal.test.ts` (assignment framework — empty/one-role/two-roles/ghost-has-no-holder/
reset-across-deals + min-player validation at `start`), `reducers/vote.test.ts` (Judge tie
routing including an already-eliminated Judge, `judgeDecide` actor/target validation, Ghost
voter eligibility + outcome-swinging ballots, Jester bonus on both elimination paths +
no-bonus-when-second-out), and `redact-for.test.ts` (the Judge public-reveal exception, and
that it does NOT leak the base `role` or apply to a non-Judge `specialRole`). Follow the same
split for wave 2: assignment-framework tests in `deal.test.ts`, mechanic tests next to
whichever reducer the new branch landed in, redaction tests in `redact-for.test.ts` only if
the role adds a new visibility exception.
