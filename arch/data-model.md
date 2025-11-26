# Data Model — Postgres schema, Redis keyspace, and the canonical GameState

> Shared reference. See [system-design.md](system-design.md) for where each store fits.
> Postgres = durable entities & finished games. Redis = live rooms & operational state.
> The in-memory `GameState` (§3) is defined once in `packages/engine` and is the same shape
> in pass-and-play (browser) and online play (server + Redis).

## 1. PostgreSQL schema

Managed by Drizzle migrations in `apps/api/drizzle/`. DDL below is the authoritative shape;
phase files reference tables by name and never restate columns.

```sql
-- Enums
CREATE TYPE game_mode        AS ENUM ('pass_play', 'online_private', 'online_public');
CREATE TYPE base_role        AS ENUM ('civilian', 'undercover', 'mrwhite');
CREATE TYPE faction          AS ENUM ('civilian', 'undercover', 'mrwhite', 'infiltrators');
CREATE TYPE difficulty       AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE pack_visibility  AS ENUM ('private', 'unlisted', 'public');
CREATE TYPE pair_status      AS ENUM ('active', 'pending_review', 'rejected');
CREATE TYPE pack_review_status AS ENUM ('pending', 'approved', 'rejected'); -- PACK-level public-catalog review (distinct from the per-PAIR pair_status)

-- Players: guest-first identity (see system-design.md §6)
CREATE TABLE players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 20),
  avatar        jsonb NOT NULL DEFAULT '{}',   -- doodle avatar config, see conventions.md
  is_guest      boolean NOT NULL DEFAULT true,
  email         citext UNIQUE,                 -- NULL for guests; set by account linking (phase 16)
  -- denormalized lifetime stats, updated transactionally at game persistence:
  total_points  integer NOT NULL DEFAULT 0,
  games_played  integer NOT NULL DEFAULT 0,
  games_won     integer NOT NULL DEFAULT 0,
  warned_at     timestamptz,                    -- phase 16: soft moderation flag (a recorded warning)
  suspended_at  timestamptz,                    -- phase 16: hard block — refused at every auth boundary
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- Word packs: category is a PACK property; difficulty is a PAIR property.
-- Official content ships as one pack per category ("Food & Drink", "Animals", ...).
CREATE TABLE word_packs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE,                   -- official packs only ('food-drink'); NULL for user packs
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  description   text NOT NULL DEFAULT '',
  category      text NOT NULL DEFAULT 'custom',-- fixed list for official packs, 'custom' otherwise
  language      text NOT NULL DEFAULT 'en',
  is_official   boolean NOT NULL DEFAULT false,
  owner_id      uuid REFERENCES players(id) ON DELETE CASCADE,  -- NULL = official
  visibility    pack_visibility NOT NULL DEFAULT 'private',
  review_status pack_review_status NOT NULL DEFAULT 'pending', -- public-catalog moderation state; access requires 'approved', but going public sets 'approved' immediately (self-service, no gate enforced yet — dormant infra)
  share_code    text UNIQUE,                   -- 8-char code for 'unlisted' sharing
  cover_url     text,                          -- R2 public URL (custom pack covers, phase 11)
  pair_count    integer NOT NULL DEFAULT 0,    -- denormalized, maintained on pair writes
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (is_official = (owner_id IS NULL))
);

-- Word pairs: symmetric (a/b) — the ENGINE flips a coin for which side Civilians get.
CREATE TABLE word_pairs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id       uuid NOT NULL REFERENCES word_packs(id) ON DELETE CASCADE,
  word_a        text NOT NULL CHECK (char_length(word_a) BETWEEN 1 AND 40),
  word_b        text NOT NULL CHECK (char_length(word_b) BETWEEN 1 AND 40),
  difficulty    difficulty NOT NULL DEFAULT 'medium',
  status        pair_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, word_a, word_b)
);
CREATE INDEX idx_pairs_pack ON word_pairs (pack_id) WHERE status = 'active';

-- Pack access grants (phase 11): one row per (pack, player) minted by
-- POST /packs/import (by share code) OR POST /packs/:id/import (by id, from
-- the public catalog) — "grants read-access, does not copy" (api-contract.md
-- §1). Lets an imported 'unlisted' or 'public' pack pass the same
-- visibility/leak-guard gates as ownership without duplicating pair data, and
-- is what puts a discovered pack into the importer's GET /packs set (and thus
-- the room pack picker) so it's usable in a game.
CREATE TABLE pack_access (
  pack_id       uuid NOT NULL REFERENCES word_packs(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, player_id)
);
CREATE INDEX idx_pack_access_player ON pack_access (player_id);

-- Games: ONLINE games only. Pass-and-play is fully client-side (localStorage), never
-- persisted server-side in this roadmap. Row created at game start, completed at game end.
CREATE TABLE games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code       text NOT NULL,
  mode            game_mode NOT NULL,
  host_player_id  uuid REFERENCES players(id) ON DELETE SET NULL,
  settings        jsonb NOT NULL,              -- GameSettings snapshot (§3.2)
  pair_id         uuid REFERENCES word_pairs(id) ON DELETE SET NULL,
  civilian_word   text NOT NULL,               -- resolved sides, for history display
  undercover_word text NOT NULL,
  rounds_played   integer NOT NULL DEFAULT 0,
  winner_faction  faction,                     -- NULL = abandoned before finishing
  summary         jsonb,                       -- full un-redacted final state: rounds, clues,
                                               -- votes, eliminations (safe once game is over)
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);
CREATE INDEX idx_games_room    ON games (room_code, started_at DESC);
CREATE INDEX idx_games_started ON games (started_at DESC);

-- Per-player-per-game results — the scoring & history backbone.
CREATE TABLE game_players (
  game_id           uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id         uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seat              integer NOT NULL,          -- turn order position, 0-based
  role              base_role NOT NULL,
  special_role      text,                      -- 'judge' | 'ghost' | 'jester' | ... | NULL
  word              text,                      -- NULL for Mr. White
  eliminated_round  integer,                   -- NULL = survived to game end
  won               boolean NOT NULL DEFAULT false,
  points            integer NOT NULL DEFAULT 0,-- per scoring table in copy.md / engine
  was_host          boolean NOT NULL DEFAULT false,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX idx_gp_player ON game_players (player_id, game_id);

-- Phase 16 (public matchmaking) — IMPLEMENTED (0002_phase16_moderation.sql).
CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reported_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  room_code    text,
  reason       text NOT NULL,                  -- enum-ish: 'name','chat','clue','other'
  detail       text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open',   -- 'open' | 'actioned' | 'dismissed'
  context      jsonb,                          -- phase 16 additive: server-captured recent
                                               -- chat/clue lines from the reported room (task 4);
                                               -- NEVER supplied by the untrusted client
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_status_created ON reports (status, created_at DESC);

-- Phase 16 per-player block list (task 4). Directional in storage, symmetric in
-- matchmaking effect (the matcher never seats a pair where EITHER blocked the other).
CREATE TABLE player_blocks (
  blocker_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX idx_player_blocks_blocked ON player_blocks (blocked_id);

-- Phase 16 moderation action log (task 5, "Log every action"). Token-gated admin
-- surface has no player identity, so there is no admin_id — the row records what
-- was done to whom/what. FKs SET NULL so the audit trail outlives its referents.
CREATE TABLE moderation_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action           text NOT NULL,             -- 'dismiss' | 'warn' | 'suspend' | 'retire_pack'
  report_id        uuid REFERENCES reports(id) ON DELETE SET NULL,
  target_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  pack_id          uuid REFERENCES word_packs(id) ON DELETE SET NULL,
  detail           text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mod_actions_created ON moderation_actions (created_at DESC);
```

Phase-16 moderation notes: "retire pack" marks every `word_pairs` row of the pack `status='rejected'` (the existing `pair_status` value), which removes them from the draw pool (`idx_pairs_pack` is `WHERE status='active'`) without any new column. "Suspend" stamps `players.suspended_at` and mirrors the id into a fast Redis `mod:suspended` set (rehydrated from Postgres on boot) so the every-request auth check is O(1).

Public-pack lifecycle (`word_packs.review_status`): packs are always created `private`; an owner opens one to the public catalog by patching `visibility='public'`, which is SELF-SERVICE and takes effect IMMEDIATELY — that PATCH sets `review_status='approved'`, so the pack is instantly visible/usable to everyone. The access gates that admit a `public` pack to non-owners (`routes/pack-access.ts` `hasPackAccess` / `allPackIdsAccessible`) already require `review_status='approved'`, so the enforcement machinery exists — it's just that going public grants the approval in the same step, i.e. NO moderation gate is enforced at launch. The gate is intentionally left as dormant infrastructure: the admin `approve_pack` moderation action (flips `review_status='approved'`, logs a `moderation_actions` row — the mirror of `retire_pack`, standalone with no report) and the admin "packs awaiting review" queue are wired up and ready. Turning the gate ON later is a one-line change: make the `visibility='public'` PATCH set `review_status='pending'` instead of `'approved'`; pending public packs are then owner-only until an admin approves them (ownership is always checked before the gate, so an owner never loses access to their own pack). Backfill/seed: the migration set pre-existing `public` OR `is_official` packs to `approved` at rollout, and the seed marks official packs `approved` on insert — the `'pending'` column default just means "not opened to the public yet", which every private pack is.

Public-catalog discovery → use: opening a pack to the public (above) only makes it FINDABLE; a stranger still has to add it to their own set before it's playable. `GET /packs/public` is the discovery surface — it lists `public`+`approved` packs owned by others, MINUS anything already in the caller's set (official / owned / already-imported), so every listed pack is addable. `POST /packs/:id/import` then adds a chosen one by id, minting the same idempotent `pack_access` grant as the share-code import; from that point the pack is in the caller's `GET /packs` set (official ∪ owned ∪ imported) and therefore usable in a game via the room pack picker — no pair data is copied, exactly like a share-code import. Import-by-id refuses (404, existence-hiding) any pack that isn't `public`+`approved`, so the by-id path never exposes a private/unlisted/pending pack that browsing would never have surfaced; importing your own public pack is a no-op (ownership already grants access).

Notes & decisions:

- **Score history** is `game_players` (one row per player per finished game). Profile stats
  (win rate by role, points over time) are queries over it; `players.total_points /
games_played / games_won` are denormalized in the same transaction that persists the game,
  so the profile header never needs an aggregate query.
- **Word sides**: pairs are stored symmetric (`word_a/word_b`); which side is the Civilian
  word is decided per-game by the engine's RNG and recorded on `games` after the fact. This
  prevents authoring bias ("first word is always civilian") from leaking into play.
- **Custom pairs live in the same `word_pairs` table** as official ones — the engine draws
  from a merged pool filtered by the room's selected pack IDs + difficulties. No separate
  code path for custom content (research doc 02's key implication).
- **Deletion (row-level FK semantics)**: hard-deleting a player row cascades their packs and
  `game_players` rows but leaves `games` (host set to NULL) — finished games belong to
  everyone who played them.
- **Account deletion (self-service, `DELETE /v1/account`)**: SOFT-ANONYMIZE, never a row
  delete. The player row is UPDATEd in place — `email → NULL`, `display_name → 'Deleted
  player'`, `avatar → DEFAULT_AVATAR` (the same neutral, well-formed doodle guest creation
  uses — NOT the jsonb `{}` default, which would fail `avatarConfigSchema` serialization
  anywhere the scrubbed row is later read), `is_guest → true` — while the `id` and the
  non-PII aggregate stats (`total_points`/`games_played`/`games_won`) are kept. Nothing
  cascades: the account's `reports` (as reporter AND reported), `player_blocks`, owned
  `word_packs`, and `game_players` all survive, now attached to the anonymized row. This is
  the deliberate reason it's an UPDATE and not a `DELETE` — a hard delete would CASCADE-erase
  `reports`/`player_blocks` (both FKs are `ON DELETE CASCADE`), including OPEN reports filed
  AGAINST the account, destroying the moderation audit trail; keeping the row keeps every FK
  intact (`moderation_actions.target_player_id` is `SET NULL` and keeps its log either way).
  `email → NULL` is safe under the UNIQUE index (Postgres permits many NULLs), so the address
  is freed for re-linking. Columns-only — no schema migration. A guest has no linked identity
  and is refused with `validation`. **Residual**: the JWT already issued stays valid until
  natural expiry — auth verifies the JWT plus a Redis suspension check with no per-request DB
  load, and there is no server-side session-revocation infra today, so the anonymized row
  does NOT invalidate an outstanding token; the CLIENT drops its token to end the session.
- **Retention**: `games.summary` for abandoned games (winner NULL, ended_at NULL, started >48h
  ago) is intended to be nulled by a weekly cleanup job — **planned, not yet implemented**:
  nothing schedules it today (no cron/CI wiring exists; `deploy/RUNBOOK.md` "Abandoned-game
  summary cleanup" tracks it as pending). The same holds for the phase-10 player-totals
  reconciliation (`db:reconcile` script + RUNBOOK entry exist, but nothing runs them on a
  timer). Actually scheduling both is Phase-9 work — they need production scheduling infra (a
  cron container or a CI `schedule:` trigger). Completed games are kept indefinitely (tiny rows).

## 2. Redis keyspace

All keys and their lifecycles. TTLs refresh on room activity. (Config: AOF on, no eviction —
see [system-design.md §4](system-design.md).)

| Key                     | Type        | Content                                                                             | TTL              |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------- | ---------------- |
| `room:{code}:state`     | string      | JSON-serialized `GameState` (§3) — authoritative live state                         | 24 h             |
| `room:{code}:ver`       | string(int) | monotonic version, INCR on every accepted action; broadcast with each snapshot      | 24 h             |
| `room:{code}:lock`      | string      | room-code claim (`SET NX EX 86400`)                                                 | 24 h             |
| `room:{code}:conn`      | hash        | playerId → `{socketId, lastSeenAt}` presence map                                    | 24 h             |
| `room:{code}:usedPairs` | set         | pair IDs already played in this room session (rematch de-dup)                       | 24 h             |
| `room:{code}:gameId`    | string      | `games.id` of the running game — set on `game:start`, read at game-over to complete the row _(added phase 6)_ | 24 h             |
| `room:{code}:voice`     | hash        | playerId → `'1'\|'0'` mute state — the `voice:state`→`voice:roster` mirror's durable side (`apps/api/src/rooms/voice-store.ts`); ENTIRELY ephemeral/cosmetic, never read by the engine, never part of `GameState` _(added phase 15)_ | 24 h             |
| `rl:{scope}:{key}`      | string(int) | sliding-window rate-limit counters (`scope` ∈ auth, roomCreate, join, action, chat) | window (10–60 s) |
| `mm:queue`              | zset        | phase 16 matchmaking queue: playerId scored by enqueue time                         | —                |
| `mm:queue:lang`         | hash        | phase 16: playerId → language (the grouping dimension the zset can't carry)          | —                |
| `lobbies:index`         | zset        | phase 16: public-room code → createdAt — the browsable/quick-join public-lobby index | —                |
| `lobbies:lang`          | hash        | phase 16: public-room code → language (matcher grouping + `GET /lobbies` `language`) | —                |
| `room:{code}:chatlog`   | list        | phase 16: last ≤20 chat lines (JSON) for report context capture — ephemeral, never in state | 24 h        |
| `mod:suspended`         | set         | phase 16: suspended playerIds (fast auth check; rehydrated from Postgres on boot)    | —                |
| `link:{sha256(token)}`  | string      | phase 16: pending magic-link `{playerId,email}` — single-use (`GETDEL` on verify)   | 15 min           |
| `stats:gauge`           | hash        | roomsActive, socketsConnected — for the admin stats endpoint                        | —                |

Write discipline for room state (the only concurrency-sensitive path): `WATCH
room:{code}:ver` → load state → engine reducer → `MULTI` → `SET state` + `INCR ver` → `EXEC`;
on conflict, retry from fresh state with jittered backoff, up to a small bounded attempt count
(`MAX_CAS_ATTEMPTS`, `rooms/room-store.ts`). The turn-based hot path almost never conflicts on
a single process, but phase 8's resilience introduced genuine N-writer bursts on one room —
every phone on a table dropping at once (simultaneous `presence:false`), or the whole table's
ballots landing in the same tick at vote close. A single retry (the original spec) loses an
update under that contention, and a dropped `presence:false` fatally leaves a player stuck
`connected:true` so the abandon reaper never fires — hence the bounded multi-retry. This
discipline is also what makes the multi-process scaling lever (§10 of system-design) safe to
pull later without a rewrite.

## 3. The canonical `GameState` (packages/engine)

One TypeScript shape, exported from `packages/engine`, used by: the server (stored in Redis,
reduced on actions), pass-and-play (stored in localStorage, reduced in the browser), and — in
redacted form — every client render. **Phase files must not invent state fields; they extend
this shape via the engine package with a migration note.**

```ts
type Phase =
  | 'lobby' // players joining, host configuring
  | 'dealing' // roles assigned; players privately viewing words ("ack" gate)
  | 'clue' // turn-ordered clue giving
  | 'discussion' // free talk (timer, host-skippable)
  | 'voting' // simultaneous secret ballots
  | 'tiebreak_clue' // sudden-death: tied players give one extra clue each
  | 'reveal' // elimination result being shown
  | 'mrwhite_guess' // eliminated Mr. White's single guess window
  | 'game_over';

interface GameState {
  code: string | null; // null in pass-and-play
  mode: 'pass_play' | 'online_private' | 'online_public';
  phase: Phase;
  round: number; // 1-based; increments each time clue phase restarts
  settings: GameSettings;
  players: GamePlayer[]; // in seat/turn order
  hostId: string;
  turnSeat: number | null; // whose clue turn (index into alive, seat-ordered)
  clues: Clue[]; // append-only log: {round, playerId, text}
  votes: Record<string, string>; // voterId → targetId; CURRENT ballot only; SECRET (§4)
  tiedPlayerIds: string[] | null; // non-null during tiebreak_clue / re-vote
  revoteCount: number; // 0 or 1; second tie = no elimination this round
  pendingElimination: string | null; // playerId shown in 'reveal'
  pair: { civilianWord: string; undercoverWord: string; pairId: string | null }; // SECRET (§4)
  winnerFaction: Faction | null;
  scoreboard: Record<string, number>; // session points accumulated across rematches
  gamesPlayedInRoom: number;
  phaseEndsAt: number | null; // epoch ms; server-owned deadline (null = untimed)
  seed: string; // RNG seed — engine is deterministic given seed + actions
  createdAt: number;
}

interface GamePlayer {
  id: string;
  name: string;
  avatar: AvatarConfig;
  seat: number;
  connected: boolean; // presence-driven; always true in pass_play
  isReady: boolean; // lobby only
  hasSeenWord: boolean; // dealing-phase ack
  alive: boolean;
  eliminatedRound: number | null;
  role: 'civilian' | 'undercover' | 'mrwhite' | null; // SECRET while alive (§4)
  word: string | null; // SECRET (§4); null for Mr. White
  specialRole: SpecialRole | null; // SECRET unless role rules say otherwise
  usedSpecialPower: boolean; // Mirror bounce, Grudge drag, etc. — one-shot tracking
}

interface GameSettings {
  maxPlayers: number; // default 12, hard cap 20, min 3 (UI warns <4 — see copy.md)
  undercoverCount: number; // host-set; default from suggestRoleCounts(playerCount)
  mrWhiteCount: number;
  specialRoles: SpecialRole[]; // enabled roles, e.g. ['judge','ghost']; empty at launch
  packIds: string[]; // selected word packs
  difficulties: Difficulty[]; // filter, default all three
  clueTimerSec: number | null; // default 60; null = untimed (Discord-friendly)
  discussionTimerSec: number | null; // default 120
  voteTimerSec: number | null; // default 45
  mrWhiteFirstClueBan: boolean; // default true: Mr. White never assigned seat 0
  eliminationReveal: 'role' | 'word_and_role'; // default 'role'
}

type SpecialRole =
  | 'judge'
  | 'ghost'
  | 'jester' // wave 1 (phase 12)
  | 'lovebirds'
  | 'grudge'
  | 'mirror'
  | 'rivals'
  | 'mime'; // wave 2 (phase 13)
```

Engine API (signatures frozen in phase 2; all pure):

```ts
createGame(settings, players, seed) → GameState                    // lobby
applyAction(state, action) → { state, effects, error? }            // ONE entry point
suggestRoleCounts(playerCount) → { undercoverCount, mrWhiteCount } // +1 UC per 4 players;
                                                                   // 1 Mr. White at 5+
redactFor(state, viewerId | 'spectator') → RedactedGameState       // §4
checkWin(state) → Faction | null                                   // exposed for tests
```

`effects` are declarative instructions for the host environment (server or pass-and-play
client): `{type:'startTimer', endsAt}`, `{type:'persistGame'}`, `{type:'revealRole',
playerId}` — the engine never does I/O itself.

## 4. Redaction matrix — who sees what, when

Implemented solely in `redactFor()` (engine). The server broadcasts the `'spectator'`
redaction publicly and sends each player their private `you` slice. **No other code path may
touch `pair`, `role`, `word`, or raw `votes`.**

| Field                                          | Own view                          | Others' view (alive)                                          | Others' view (eliminated)         | Game over                    |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------- | --------------------------------- | ---------------------------- |
| `role`                                         | always                            | hidden                                                        | revealed (from `reveal` phase on) | all revealed                 |
| `word`                                         | always (null for Mr. White)       | hidden                                                        | per `settings.eliminationReveal`  | all revealed                 |
| `specialRole`                                  | always                            | hidden — except Judge, announced to all when a tie invokes it | revealed                          | all revealed                 |
| `pair`                                         | never (would leak the other word) | never                                                         | never                             | both words shown             |
| `votes` (who→whom)                             | own vote only                     | count of ballots cast (`7/9 voted`)                           | —                                 | per-round tallies in summary |
| `clues`                                        | public                            | public                                                        | public                            | public                       |
| `scoreboard`, `phase`, `phaseEndsAt`, presence | public                            | public                                                        | public                            | public                       |

Mr. White's `word` is `null` — their card shows the "no word" state
([copy.md](copy.md) has the exact text). Eliminated players (and Ghosts) receive the same
spectator redaction plus their own historical slice; they never gain access to living
players' secrets.

### Phase 2 engine extensions

Fields the engine implementation added to §3's shapes: `GameState.voteHistory: VoteRecord[]`
— one entry per closed vote, appended before `votes` clears; SECRET until `game_over`.
`GameState.lastGuess` — Mr. White's guess outcome; PUBLIC (game-design.md §6.6).
`GameState.timerExtended` — whether the host's once-per-phase +60s has been used; resets
on every phase change. `GamePlayer.hasLeft` — an explicit mid-game `leave`; elimination
defers to the next phase boundary. Every `GameAction` carries `at: number` (the host
environment's clock reading — the engine never reads a clock); `phaseEndsAt` is always
`action.at + seconds * 1000`. `createGame` takes an optional 4th `now` param (default `0`)
for the same reason, becoming `createdAt`. The `extendTimer` action (host-only) was added
because game-design.md §6.3's host "+60s" extension had no corresponding action in §3.

### Phase 8 engine extension — `migrateHost`

The server-originated `migrateHost { newHostId, at }` action (game-design.md §8 "Host
disconnect → migration") reassigns `state.hostId`. The engine reassigns host on its own
only in `lobby` (via `removeAndCompactSeats` on `leave`/`kick`) and on `rematch`; a
mid-game host disconnect or explicit hand-back has no in-engine reassignment path, so this
action fills the gap. Like `presence`/`timeout` it carries NO actor-authority check — the
host environment decides both whether migration is allowed and who inherits (grace-expiry
picks the longest-connected alive player; the explicit `host:transfer` path is host-only,
enforced server-side). The engine only validates that `newHostId` names a seated player
(else `validation`) and swaps `hostId`; re-assigning to the current host is a no-op accept.
It never touches `alive`/turn order and emits no effects. `hostId` is already PUBLIC in the
redaction matrix (§4 — it drives the host-crown chip), so no redaction change is needed.

**`was_host` semantics after a migration** (data-model §1 `game_players.was_host` /
`games.host_player_id`): both are written from the FINAL `state.hostId` at persist time
(`rooms/persist-game.ts`), i.e. whoever held the pencil when the game ended, not the
original creator. The abandoned-game persist path (below) is consistent with this.

### Phase 12 engine extension — special roles wave 1 (Judge / Ghost / Jester)

New `Phase` value: `'judge_decision'` — entered from `voting`'s tie-close
(`reducers/vote.ts` `closeVote`) instead of `tiebreak_clue`, whenever a special-role holder
with `specialRole === 'judge'` exists (alive OR eliminated — research/03-SPECIAL-ROLES-
VARIANTS.md: the Judge "stays active even after she herself is eliminated"). Resolved by
the (previously-stubbed, now real) `judgeDecide {targetId, at}` action
(`applyJudgeDecide`): `targetId` must be one of `tiedPlayerIds`; the actor must hold
`specialRole === 'judge'`; the target is eliminated exactly like a clean-plurality vote
close (`pendingElimination` set, phase → `reveal`, `revealRole` + reveal-timer effects) —
the tie's own `VoteRecord` (already logged with `eliminated: null`) is not rewritten; the
Judge's decision isn't itself a vote. `judge_decision` is timed
(`JUDGE_DECISION_TIMEOUT_SEC`, `constants.ts`, always-on regardless of
`settings.voteTimerSec` — same convention as `MRWHITE_GUESS_SEC`); on expiry OR the host's
early `advancePhase`, `resolveJudgeDecisionByDefault` (`reducers/vote.ts`) eliminates a
deterministic random pick from `tiedPlayerIds` (seeded RNG, same per-purpose-generator
convention as `assignSpecialRoles`) — an unreachable Judge can never stall the game
(game-design.md §8 "never block on a ghost"). This closed a gap in phase 12's initial
implementation (shipped with `phaseEndsAt: null` and no escape hatch) before phase 13
started; see `packages/engine/ROLES.md`'s Judge section for the pattern any future
special-power decision phase should follow from the start.

New `GameState.judgeRevealed: boolean` — latches `true` the first time a tie ever routes to
`judge_decision` this game, reset to `false` again on the next `beginDealing`
(start/rematch). Drives the ONE redaction exception in §4: `specialRole` is normally hidden
for an alive player, but the Judge's becomes PUBLIC (to everyone, alive or not, for the rest
of THIS game) once `judgeRevealed` is true — `redactFor`'s `redactPlayer` now takes this
flag and ORs it into `specialRole`'s visibility, kept deliberately INDEPENDENT of `role`'s
own visibility (the Judge's identity leaking does not also leak their base
civilian/undercover/mrwhite role).

Special-role assignment framework (`reducers/deal.ts` `assignSpecialRoles`, called from
`dealRoles` right after the base role/word deal — packages/engine/ROLES.md has the full
pattern write-up): every ENABLED role in `settings.specialRoles` except `'ghost'` gets
assigned to one random eligible player, at most one special role per player, drawing from
the SAME per-deal `Rng` the base role shuffle already used (determinism unchanged: same
seed + same `gamesPlayedInRoom` ⇒ same holders). `'ghost'` is deliberately never assigned a
holder — it's a room-wide setting (below), not a per-player role. Settings validation:
`isValidSpecialRoles` (`reducers/shared.ts`) rejects a `specialRoles` list containing a role
whose table-size requirement (`SPECIAL_ROLE_MIN_PLAYERS`, `constants.ts`) exceeds the player
count — wired into `isValidSettingsForLobby` (against `maxPlayers`, lobby time) and
re-checked against the actual seated count at `start`/`rematch`, mirroring the existing
role-math re-validation. Wave 1's three roles (judge/ghost/jester) have no extra minimum
beyond the game's own `MIN_PLAYERS`; wave 2 (phase 13) is the first to populate
`SPECIAL_ROLE_MIN_PLAYERS` beyond that.

Ghost (`settings.specialRoles` containing `'ghost'`, game-design.md §9): eliminated players
keep `vote:cast` rights — `reducers/vote.ts`'s `eligibleVoterIds`/`applyCastVote` both fold
`!p.alive` into "still eligible" whenever Ghost is enabled (their ballot targets are still
restricted to alive/tied players exactly like everyone else's). No new state field — a pure
settings-driven behavior change keyed off `settings.specialRoles`, never off `specialRole`
(no player ever holds a `'ghost'` `specialRole`). Chat for eliminated players was already
unconditional before this phase (`sockets/lobby.ts` `handleChatSend` never checked `alive`)
— Ghost does not change that; only the ballot right and the UI's wavy styling/
elimination-banner variant are gated by the setting.

Jester (`reducers/shared.ts` `applyJesterFirstOutBonus`, called from both `closeVote`'s
clean-plurality branch and `applyJudgeDecide`): +`JESTER_FIRST_OUT_BONUS` (4) points onto
the scoreboard, IMMEDIATELY, the moment the FIRST player ever eliminated this game is
revealed to hold `specialRole === 'jester'` — checked against the PRE-elimination player
list (no other player already has a non-null `eliminatedRound`). No bonus for a Jester
eliminated later; no new state field — the bonus folds directly into the existing
`scoreboard`, same as every other scoring rule, and the win screen re-derives whether to
show the bonus line purely from the now-public `eliminatedRound`/`specialRole` fields
(§4 above), the same trick it already uses for the ordinary 2/6/10 win deltas.

### Phase 13 engine extension — special roles wave 2 (Lovebirds / Grudge / Mirror / Rivals / Mime)

New `Phase` value: `'grudge_decision'` — the Grudge special role's own drag-down decision
window, entered from a chained-elimination walk (below) whenever the just-revealed card
belongs to the Grudge and they haven't used their power yet. Shaped exactly like
`judge_decision` (phase 12): a real timeout constant (`GRUDGE_DECISION_TIMEOUT_SEC`, 30s,
`constants.ts`), a real `applyTimeout` case, and a real `applyAdvancePhase` host-escape-hatch
case, all wired from the start (`packages/engine/ROLES.md` §3's guidance). UNLIKE the Judge,
whose default MUST eliminate someone, the Grudge's timeout/host-escape default is "drags
NOBODY down" (copy.md §3.2) — a deliberately different, and equally valid, fallback shape.

Three new `GameState` fields, all PUBLIC (redaction matrix §4 unchanged otherwise — no new
early-reveal exception for any wave-2 role):

- **`pendingCascade: string[]`** — queue of player ids still awaiting their own reveal card
  within the CURRENT chained-elimination sequence (Lovebirds partner fall / Grudge
  drag-down). Every id in the queue is ALREADY marked `alive: false` with `eliminatedRound`
  set the instant they're queued — the queue only tracks reveal ORDER, not who's actually
  eliminated (that's atomic). Reset to `[]` on `enterNextClueRound` and a fresh
  `beginDealing`. The frozen `pendingElimination: string | null` (§3 above) is deliberately
  left untouched in meaning — it still names the ONE card currently showing; this is a
  wholly additive field, not a repurposing.
- **`mirrorBounced: boolean`** — `true` for the duration of the current elimination
  sequence when its primary elimination was redirected by the Mirror's one-shot vote-bounce
  (`reducers/vote.ts` `closeVote`'s clean-plurality branch ONLY — never a Judge decision,
  never that decision's timeout/host-escape default, never a Grudge drag: the Mirror check
  lives in exactly one place in the whole engine). Deliberately carries NO player id — unlike
  the Judge's `judgeRevealed` exception, the Mirror's identity is never announced; this flag
  only lets the client render a distinct "the vote bounced" reveal beat without naming who
  caused it. Reset to `false` on `enterNextClueRound` and a fresh `beginDealing`.
- **`mimeId: string | null`** — the CURRENT round's Mime (see the Mime write-up below).
  `null` when the setting is off or before round 1 begins. Recomputed once per fresh clue
  round (`reducers/clue.ts` `enterNextClueRound`).

`Clue` (§3 above) gained one field: **`mimed: boolean`** — `true` when `playerId` was that
round's Mime at the moment this clue was recorded (never `true` for a skipped-turn entry).
Set once, at record time, so the clue board stays historically accurate across rounds even
after `mimeId` moves on to someone else. PUBLIC, same as the rest of `Clue`.

`YouSlice` (api-contract.md §2.2) gained two fields, both server-computed and `null` unless
the viewer genuinely holds that paired role: **`lovebirdsPartnerId`** and **`rivalId`**. The
partner LINK is secret (nobody else's `specialRole` reveals it), but the partner's NAME is
already public (`GamePlayer.name` is never redacted) — so exposing just the id is enough for
a client to render "linked to {name}" via a lookup against the ordinary redacted roster,
without inventing a new public state field or a new early-reveal redaction exception.
Derived by `reducers/shared.ts` `pairedPartnerId(players, playerId, role)`: at most one pair
of a given paired role can exist per game (each is assigned exactly once,
`reducers/deal.ts`), so "the other player holding this role" is unambiguous — no separate
partner-id field is stored on `GamePlayer` either. `YouSliceCanAct` gained **`grudge`**
(true only during `grudge_decision`, only for the just-eliminated Grudge holder — mirrors
`judge`'s shape).

**Kind assignment** (packages/engine/ROLES.md §1's two kinds): `mirror` and `grudge` are
ordinary kind-1 single-holder roles (`ASSIGNABLE_SPECIAL_ROLES`). `lovebirds` and `rivals`
are also kind-1, but PAIRED — `assignSpecialRoles` (`reducers/deal.ts`) now draws either 1
or 2 distinct holders per role (`PAIRED_SPECIAL_ROLES`, `constants.ts`), generalizing what
was previously a hard-coded single draw. `mime` is kind-2 (a room-wide setting, alongside
`ghost`) rather than kind-1 — REMOVED from `ASSIGNABLE_SPECIAL_ROLES` — because its mechanic
("a DIFFERENT random alive player each round") does not fit "one holder, assigned once at
deal time, for the whole game"; forcing it into kind 1 would make the same player mime every
round, which is wrong. Instead, `reducers/clue.ts` `drawMimeForRound` re-derives it every
time a fresh clue round begins, seeded by `${seed}:mime:${gamesPlayedInRoom}:${round}` (the
same per-purpose-fresh-generator convention as `assignSpecialRoles`/
`resolveJudgeDecisionByDefault`), so replays stay identical; no anti-repeat constraint
against the previous round's pick (documented simplification).

**The cascade** (`reducers/cascade.ts`, a new reducer module — the one small shared helper
wave 2's mechanics needed, per ROLES.md §3's "resist a generic dispatcher" guidance): both
Lovebirds and Grudge walk the SAME chained-elimination state machine. `enterCascadeReveal`
(called from `closeVote`'s clean-plurality branch, the Mirror bounce, and
`applyJudgeDecide`/`resolveJudgeDecisionByDefault`) marks the primary eliminated player,
checks for an alive Lovebirds partner and marks/queues them too if found, then enters
`reveal` for the primary. Every time a card's reveal is dismissed (host action or timeout),
`advanceCascadeOrResolve` runs: opens `grudge_decision` if the just-shown card is an
unused Grudge; otherwise pops the next queued card, or — once the queue is fully drained —
hands off to `resolveAfterElimination` (departures + `checkWin` + next round). `checkWin` is
invoked from EXACTLY that one place, so a chain of any length only ever triggers ONE
win-check, after its very last member. `applyGrudgeDrag` (the Grudge's own decision) marks
their chosen target eliminated, checks THAT target for an alive Lovebirds partner too (so a
Grudge-dragged Lovebird still cascades their partner), and continues the queue. Termination
is structural: a player is only ever queued via an ALIVE-filtered partner lookup, so an
already-eliminated player can never be re-queued, bounding any single chain to at most 4
eliminations (primary + their partner, plus one Grudge drag + that target's partner) — a
player can hold only one special role, so at most one Grudge and one Lovebirds pair can ever
exist per game. Proven both by direct unit tests (`reducers/cascade.test.ts`) and a 20-seed
random-role-mix fuzz at 8 players (`__tests__/special-roles-wave2.test.ts`) asserting every
game terminates with a valid winner.

**Rivals scoring** (`reducers/cascade.ts` `applyRivalsScoring`, called from BOTH
`enterGameOverForWin` and `enterGameOverForGuess` — i.e. applied once, at game-over time,
regardless of how the game ended): ±`RIVALS_POINT_DELTA` (2) based purely on
`eliminatedRound`, ranking "never eliminated" as later than any real round so a single
comparison covers every case — both survived (no points), both eliminated the SAME round
(no points — a documented tiebreak, since there's no reliable sub-round ordering to say
which "really" went first), or a genuine earlier/later split (earlier loses, later gains).

**Settings guardrail** (plan/phase13.md task 7): `reducers/shared.ts` `isValidSpecialRoles`
gained a total-holder-slot budget on top of wave 1's per-role minimums — the sum of every
enabled role's slot cost (0 for a room-wide setting, 2 for a paired role, 1 otherwise) must
not exceed `floor(playerCount / 2)`. This is a real behavior change from wave 1 (documented
in `reducers/deal.test.ts`): a 3-player table enabling `judge` + `ghost` + `jester` together
used to be valid and is now rejected (2 non-zero slots > `floor(3/2) = 1`).
