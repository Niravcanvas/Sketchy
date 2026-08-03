# API Contract — REST `/v1` + Socket.IO `/game`

> The single contract shared by the web app and the future mobile app. Every shape below has a
> Zod schema in `packages/shared/src/contract/` — that package is the source of truth; this
> document is its human-readable mirror and MUST be updated in the same PR as any schema
> change. Transport decisions and rationale: [system-design.md §5–7](system-design.md).
> State shapes referenced here (`GameState`, `GameSettings`, redaction): [data-model.md](data-model.md).

## 0. Conventions

- Base URL: `https://api.sketchy.example/v1` (placeholder domain).
- Auth: `Authorization: Bearer <jwt>` on every REST call except `POST /auth/guest` and
  `GET /health`. The same JWT authenticates the socket handshake.
- All bodies JSON. Timestamps are epoch milliseconds (number). IDs are UUIDs (string).
- **Error envelope** (REST non-2xx and socket ack failures share it):

  ```ts
  { error: { code: ErrorCode, message: string } }
  // ErrorCode is a closed union; UI copy per code lives in copy.md §9. Core codes:
  // 'unauthorized' | 'not_found' | 'validation' | 'rate_limited'
  // 'room_not_found' | 'room_full' | 'room_in_progress' | 'name_taken_in_room'
  // 'not_host' | 'not_your_turn' | 'wrong_phase' | 'already_voted' | 'clue_repeated'
  // 'clue_is_secret_word' | 'kicked' | 'pack_forbidden' | 'pair_limit' | 'profanity'
  // 'voice_disabled' (phase 15 — the VOICE_ENABLED kill-switch)
  // 'account_required' | 'suspended' (phase 16 — public matchmaking needs a linked
  //   account; a moderation-suspended player is refused with a sanitized message)
  // 'internal' (uncaught 500s — client copy is copy.md §9 "generic 500")
  ```

- Pagination: cursor-based — request `?cursor=<opaque>&limit=<n≤50>`, response
  `{ items: T[], nextCursor: string | null }`.
- **Versioning policy**: `/v1` freezes at phase 17. Additive-only after that (new optional
  fields, new endpoints, new socket events). Breaking change ⇒ `/v2` alongside `/v1` for a
  deprecation window. OpenAPI 3.1 served at `GET /v1/openapi.json` (generated from Zod via
  `@fastify/swagger` + `fastify-type-provider-zod`, wired in `apps/api/src/server.ts`).
- **Frozen baseline**: [`arch/openapi-v1.baseline.json`](openapi-v1.baseline.json)
  is a committed snapshot of that document. `contract-v1.0.0` tagged the phase-17 freeze
  (17 `/v1` paths); `contract-v1.1.0` re-tags the current, expanded surface (28 paths) — the
  phase-16 matchmaking/accounts/moderation paths plus the additive pre-launch additions
  (`POST /auth/google`, `DELETE /account`, `GET /packs/public`, `POST /packs/{id}/import`,
  and the `reviewStatus` field on the Pack shape). Every change since `contract-v1.0.0` is
  additive, so `oasdiff` stays green against this file. Regenerate it with
  `pnpm --filter @sketchy/api print:openapi ../../arch/openapi-v1.baseline.json` (requires
  `DATABASE_URL`/`REDIS_URL` reachable — `apps/api/scripts/print-openapi.ts`) whenever a
  genuinely additive contract change lands; a CI job (`.github/workflows/ci.yml`
  `contract-verification`) regenerates the LIVE spec on every push/PR and fails the build if
  `oasdiff` finds a breaking change against this file — see that job for the exact mechanics
  and `plan/phase17-handoff.md` for how to demonstrate it failing/passing.

## 1. REST endpoints

### Auth & players

| Method & path           | Auth | Request → Response                                                                                                     |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/guest`      | —    | `{ displayName }` → `{ token, player: Player }` — creates guest identity ([system-design.md §6](system-design.md))     |
| `GET /players/me`       |     | → `{ player: Player }` (also silently re-issues token past half-expiry via `X-Refreshed-Token` header)                 |
| `PATCH /players/me`     |     | `{ displayName?, avatar? }` → `{ player: Player }`                                                                     |
| `GET /players/me/stats` |     | → `{ totalPoints, gamesPlayed, gamesWon, byRole: { civilian: RoleStats, undercover: RoleStats, mrwhite: RoleStats } }` |
| `GET /players/me/games` |     | paginated → `{ items: GameHistoryItem[] }`                                                                             |
| `GET /players/me/games/:gameId` |  | → `{ gameId, rounds: GameRound[] }` — redacted round-by-round summary for one finished game (phase 10 addition, below) |

```ts
Player = { id, displayName, avatar: AvatarConfig, isGuest, createdAt };
RoleStats = { played: number, won: number, points: number };
GameHistoryItem = {
  gameId,
  endedAt,
  mode,
  roomCode,
  myRole,
  mySpecialRole,
  myPoints,
  won,
  winnerFaction,
  civilianWord,
  undercoverWord,
  playerCount,
  roundsPlayed,
};
```

**`GET /players/me/games/:gameId`** (phase 10 — plan/phase10.md task 3): the expandable
round-by-round detail behind one `GameHistoryItem` history card. Additive beyond this
section's otherwise-frozen shapes (api-contract.md §0 versioning policy allows additive
endpoints pre-`/v1`-freeze); kept as its own request rather than inlined onto every
`GameHistoryItem` so the paginated list stays small. 404s (existence-hiding) for a game the
caller didn't play, an unknown game id, or a game whose `summary` was already nulled by the
weekly abandoned-game cleanup (data-model.md §1 retention note).

```ts
GameRound = {
  round: number;
  clues: { playerId, playerName, text }[];
  eliminated: { playerId, playerName, role: BaseRole } | null;
  voteTally: { playerId, playerName, votes: number }[]; // AGGREGATE ONLY — see below
};
```

Redaction (conventions.md §1, data-model.md §4): `voteTally` is counts-per-target derived
server-side from the finished game's `voteHistory`; the raw voter→target ballot map
(`VoteRecord.votes`) never leaves the API, even for a game the caller played in and even
after `game_over`. A round that went to sudden-death (tiebreak clue + re-vote, same `round`
number for both ballots) reports only the deciding (last) vote's tally, not a merge of both.

### Word packs & pairs (list/read from phase 3; write endpoints from phase 11)

| Method & path                     | Auth  | Request → Response                                                                                                                       |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /packs`                      |      | `?official=&mine=&language=` → `{ items: Pack[] }`                                                                                       |
| `GET /packs/:id`                  |      | → `{ pack: Pack }`                                                                                                                       |
| `GET /packs/:id/pairs`            |      | paginated → `{ items: Pair[] }` — owner sees all; non-owners only for official/shared packs, and **never during a live game they're in** |
| `POST /packs`                     |      | `{ name, description? }` → `{ pack: Pack }`                                                                                              |
| `PATCH /packs/:id`                | owner | `{ name?, description?, visibility?, coverUrl? }` → `{ pack: Pack }` — `visibility:'unlisted'` mints `shareCode`; `visibility:'public'` is self-service and immediate: it sets `reviewStatus:'approved'`, so the pack is instantly public (no review gate enforced yet) |
| `DELETE /packs/:id`               | owner | → `{ ok: true }`                                                                                                                         |
| `POST /packs/:id/pairs`           | owner | `{ pairs: [{ wordA, wordB, difficulty }] }` (bulk, ≤100) → `{ items: Pair[] }`                                                           |
| `PATCH /packs/:id/pairs/:pairId`  | owner | `{ wordA?, wordB?, difficulty? }` → `{ pair: Pair }`                                                                                     |
| `DELETE /packs/:id/pairs/:pairId` | owner | → `{ ok: true }`                                                                                                                         |
| `POST /packs/import`              |      | `{ shareCode }` → `{ pack: Pack }` (grants read-access, does not copy)                                                                   |
| `GET /packs/public`               |      | `?q=&cursor=&limit=` → `{ items: Pack[], nextCursor }` — browse the public catalog: `public`+`approved` packs owned by OTHERS, EXCLUDING official/owned/already-imported (only addable rows); optional `q` name search (ILIKE); per-player browse rate limit |
| `POST /packs/:id/import`          |      | → `{ pack: Pack }` — add a PUBLIC pack to the caller's set by id (mints a `pack_access` grant, idempotent); refuses (404) a pack that isn't `public`+`approved`, so private/unlisted/pending packs never leak |
| `POST /uploads/presign`           |      | `{ kind: 'packCover' \| 'avatar', contentType, sizeBytes }` → `{ uploadUrl, publicUrl }` (R2 presigned PUT, phase 11)                    |

```ts
Pack = {
  id,
  slug,
  name,
  description,
  category,
  language,
  isOfficial,
  ownerId,
  visibility,
  reviewStatus, // additive — 'pending' | 'approved' | 'rejected'; PACK-level public-catalog
                // moderation state. A 'public' pack is browsable/usable by non-owners only
                // when 'approved'; going public sets 'approved' in the same step (self-service,
                // immediate — no gate enforced at launch), so in practice public ⇒ approved.
                // Owners read it to show a "Public" indicator. Dormant infra for a future
                // review gate. Meaningful only for public packs; carried but not consulted
                // for private/unlisted.
  shareCode,
  coverUrl,
  pairCount,
  createdAt,
  ownerName?, // phase 11, additive/optional — owner's display name, resolved by
              // routes that need "owner attribution" in the UI (imported/shared
              // packs); null for official packs or when not resolved by the caller
};
Pair = { id, packId, wordA, wordB, difficulty };
```

Phase 11 note on `POST /uploads/presign`: `sizeBytes` is an ADDITIVE required field beyond
this endpoint's original sketch (`{ kind, contentType }`) — added per §4's contract-change
checklist because the 512 KB cap can't be enforced without knowing the size before minting
the URL. The server signs `ContentType`/`ContentLength` into the presigned PUT
(`apps/api/src/uploads/presign.ts`), so R2's own SigV4 check rejects an upload that doesn't
match what was declared here, not just this endpoint's pre-check. Write-endpoint auth column
above reads "owner" for every pack/pair route except `POST /packs` (any authenticated caller
creates a NEW pack they then own), `POST /packs/import` (any authenticated caller, gated by
share code + `visibility:'unlisted'` instead of ownership), and `POST /packs/:id/import` (any
authenticated caller, gated by the target being `public`+`approved` instead of ownership).

Public catalog (`GET /packs/public` + `POST /packs/:id/import`): the discovery + add-by-id
pair that completes public packs. `GET /packs/public` is the browse surface — the same
`{ items, nextCursor }` cursor envelope as the other paginated lists, listing only ADDABLE
packs (`public`+`approved`, owned by someone else, and not already in the caller's set), with
an optional trimmed `q` name search (case-insensitive `ILIKE`). It gets its own per-player
browse rate limit (`packsBrowseRateLimit`, 20/min, keyed by playerId — the same dedicated
ceiling as `GET /lobbies`, since a public catalog is an equally scrape-able list surface),
reused as the write limiter on `POST /packs/:id/import`. `POST /packs/:id/import` adds a
browsed pack to the caller's set by id — the by-id sibling of the share-code
`POST /packs/import`: it mints the same idempotent `pack_access` grant, after which the pack
appears in `GET /packs` and is playable via the room pack picker. Importing a pack that isn't
`public`+`approved` 404s (existence-hiding, never leaking private/unlisted/pending packs);
importing your own public pack is a no-op (ownership already grants access).

### Rooms (creation/resolution is REST; everything after joining is socket)

| Method & path                  | Auth      | Request → Response                                                                                                                                   |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /rooms`                  |          | `{ settings?: Partial<GameSettings> }` → `{ code, joinUrl }` — allocates code, seeds Redis room in `lobby` phase with caller as host                 |
| `GET /rooms/:code`             |          | → `{ code, phase, playerCount, maxPlayers, canJoin: boolean, canRejoin: boolean, hostName }` — pre-join check used by the join screen & invite links |
| `GET /rooms/:code/voice-token` | , member | → `{ token, url }` — signed LiveKit access token (phase 15, live)                                                                                    |

**`GET /rooms/:code/voice-token`** (phase 15, `apps/api/src/voice/livekit-token.ts`): caller
must be a currently SEATED room member (any phase, alive or eliminated — Ghosts can
voice-chat too, game-design.md §9); a non-member or unknown code both 404 `room_not_found`
(existence-hiding, same posture as `GET /players/me/games/:gameId`). Token shape: `identity`
= playerId (so LiveKit's own `Participant.identity` maps 1:1 onto player ids), `room` = the
room code — the LiveKit room PERSISTS per code across rematches (session continuity,
decided) — audio-only publish (`canPublishSources: ['microphone']`, which supersedes the
broader `canPublish` flag — a client cannot publish video even with a valid token), 6h TTL
("short-lived" relative to the 180-day player JWT, system-design.md §6; long enough to
outlive one sitting without needing a mid-session refresh flow — reconnect resilience comes
from the web client always re-fetching a fresh token per join attempt, not from a razor-thin
TTL). `url` is the LiveKit server's client-facing wss URL, returned by the API rather than
assumed client-side so a non-browser client (mobile, a future headless client) needs no
separate LiveKit config to use voice. `VOICE_ENABLED=false` short-circuits to 403
`voice_disabled` before touching the room at all — a blanket kill-switch, not a per-room
setting.

### Matchmaking (phase 16 — IMPLEMENTED)

| Method & path               | Auth | Request → Response                                                                                           |
| --------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `GET /lobbies`              |     | paginated → public rooms in lobby phase `{ items: { code, hostName, playerCount, maxPlayers, language }[] }` |
| `POST /matchmaking/queue`   |  (account) | `{ language }` → `{ status: 'queued' }` — resolution pushed via socket `mm:matched { code }`; a guest gets 403 `account_required` |
| `DELETE /matchmaking/queue` |     | → `{ ok: true }` (existence-hiding)                                                                          |
| `POST /reports`             |     | `{ reportedPlayerId, roomCode?, reason, detail? }` → `{ ok: true }` — server captures the room's recent chat/clue context |

Public-room creation is `POST /rooms` with the additive optional `{ visibility: 'private' | 'public' }` field (default `'private'`); `'public'` requires a linked account (guests → 403 `account_required`) and forces the stranger-safe defaults (timers on, spice roles off). A public room is one whose `GameState.mode` is `'online_public'`; it is listed by `GET /lobbies` while in its lobby phase and delisted on `game:start`.

### Accounts / auth (phase 16 — IMPLEMENTED, additive)

Email magic-link linking that upgrades the caller's guest row in place (system-design.md §6 — `playerId` stable, history preserved). Enumeration-safe + rate-limited. With no transactional-email provider configured, the dev provider LOGS the link instead of sending (phase-9 adaptation; see plan/phase16-handoff.md).

| Method & path            | Auth | Request → Response                                                                                                    |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/link/request`|     | `{ email }` → `{ ok: true }` — ALWAYS this response (enumeration-safe), whether or not a link was actually minted     |
| `POST /auth/link/verify` | —    | `{ token }` → `{ token, player }` — consumes the single-use link token (the token IS the proof, so no session auth); the returned JWT now carries `guest:false` |
| `POST /auth/google`      |     | `{ idToken }` → `{ token, player }` — additional identity-link method: the server verifies the Google ID token against `GOOGLE_CLIENT_ID` (as audience) and requires a Google-`email_verified` address, then upgrades the CALLER's guest row via the same `players.email` link + response as `/auth/link/verify` (errors if the email is already in use). Flag-gated and dormant: returns `404 not_found` when `GOOGLE_SIGNIN_ENABLED` is off or no client ID is provisioned. Rate-limited 3/min per player. |
| `DELETE /account`        |     | → `{ ok: true }` — self-service account deletion by SOFT-ANONYMIZE: one UPDATE scrubs `email`→NULL / `displayName`→`'Deleted player'` / `avatar`→the neutral default doodle and flips `isGuest`→true, KEEPING the row + id so the moderation audit trail (`reports`/`player_blocks` on both sides) survives. A guest → 400 `validation` (nothing linked to delete). The still-valid JWT is NOT revoked server-side (no session-revocation infra); the client drops its token. Rate-limited 3/min per player. |

### Blocks (phase 16 — IMPLEMENTED, additive)

Additive `/v1` endpoints beyond the originally-enumerated matchmaking rows (see plan/phase16-handoff.md for the decision): a durable, server-enforced block list backing both the matcher's "never matched together" guarantee and the client's local chat-hiding.

| Method & path                  | Auth | Request → Response                                       |
| ------------------------------ | ---- | -------------------------------------------------------- |
| `GET /blocks`                  |     | → `{ items: { blockedPlayerId, createdAt }[] }`          |
| `POST /blocks`                 |     | `{ blockedPlayerId }` → `{ ok: true }` (idempotent)      |
| `DELETE /blocks/:blockedPlayerId` |  | → `{ ok: true }` (existence-hiding)                     |

Suspension (admin action, below): a moderation-suspended player is rejected at EVERY auth boundary — REST (`requireAuth` → 403 `suspended`) and the socket handshake — with a sanitized message. `account_required` / `suspended` are additive `ErrorCode` values (copy.md §9).

### Ops

| Method & path      | Auth        | Response                                                       |
| ------------------ | ----------- | -------------------------------------------------------------- |
| `GET /health`      | —           | `{ ok: true }` (process up)                                    |
| `GET /ready`       | —           | `{ ok, postgres, redis }` (dependency ping)                    |
| `GET /admin/stats` | admin token | `{ roomsActive, socketsConnected, gamesToday, actionsPerMin }` |
| `GET /stats/games-today` | —     | `{ gamesToday }` — public, low-privilege counterpart to `/admin/stats`'s `gamesToday` field, computed by the SAME query (`countGamesToday`, `apps/api/src/services/stats.ts`); no other gauge. IP rate-limited (`statsRateLimit`, 20/min). Backs the landing page's social-proof counter (`apps/web/src/lib/admin-stats.ts`) without requiring `ADMIN_TOKEN` (post-launch-backlog.md item 4, resolved). |

Phase 16 adds a token-gated moderation queue — `GET /admin/reports` (a plain server-rendered HTML list of open reports + captured context, plus a "Packs awaiting review" section) and `POST /admin/reports/:id/action` (dismiss / warn / suspend / retire-pack; every action logged to `moderation_actions`). A standalone, report-less pack action exists as dormant infrastructure for a future public-pack review gate: `POST /admin/packs/:id/action` with `action=approve_pack` flips a `public` pack to `review_status='approved'` (the mirror of `retire_pack`) and logs a `moderation_actions` row. No gate is enforced at launch — going public already self-approves — but the action + the "packs awaiting review" queue are wired so the gate can be switched on later. All are ops-only HTML surfaces and are HIDDEN from `GET /v1/openapi.json` (`schema.hide`) — they are NOT part of the mobile `/v1` contract, so they never appear in the frozen baseline. See routes/admin.ts.

### Push notifications (RESERVED — mobile phase 1, not yet implemented)

Design-only (phase 17 task 5, `arch/mobile-notes.md`): reserved here so the eventual mobile
app's push registration is additive to `/v1`, never a forced `/v2`. Nothing below exists in
`apps/api` yet — no route, no `device_tokens` table, no send pipeline. Web is unaffected
(browser push is a separate, still-hypothetical follow-up, not this endpoint).

| Method & path        | Auth | Request → Response                                                                                                                                        |
| -------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/devices`   |     | `{ platform: 'ios' \| 'android', pushToken: string }` → `{ ok: true }` — registers/upserts one push token for the caller's playerId; re-registering the same `(platform, pushToken)` pair is idempotent. |
| `DELETE /v1/devices` |     | `{ pushToken: string }` → `{ ok: true }` — unregisters one token (logout / notifications-off), existence-hiding (`ok: true` either way).                                 |

Shape notes for whenever this is actually built:

- One player can hold multiple tokens (multiple devices); a token is scoped to a single
  `playerId` at a time — a token re-registered under a different player supersedes the old
  owner (mirrors the socket "newer connection supersedes" rule in §2).
- A `players` row deletion cascades to its device tokens, same as every other player-owned
  table (data-model.md §1).
- Delivery failures (uninstalled app, expired token) prune the row lazily on the next failed
  send — no separate reconciliation job needed at launch scale.

Notification triggers worth having, in priority order (none implemented — this is the
candidate list for whichever phase actually builds push):

1. **Your-turn nudge** — `clue:submit` is legal for you and you haven't acted within some
   grace window (e.g. half the clue timer) and the app is backgrounded. The highest-value
   trigger: it's the one moment a silent phone actively stalls the table.
2. **Room-filled** — a room you created or are seated in (lobby phase) reaches enough
   players to start, and you're not currently connected. Lets a host who stepped away know
   it's time to come back and hit start.
3. Deliberately NOT proposed for v1 of push: chat messages (too chatty, would need its own
   mute setting), elimination/game-over results (glanceable in-app already, low urgency),
   matchmaking match-found (phase 16 territory, socket `mm:matched` already covers the
   foreground case — push only matters backgrounded, revisit alongside phase 16 if quick-join
   wait times turn out to be long).

Both triggers are best-effort and cosmetic — exactly like the existing `room:event` toasts
(§2.2), the engine and every gameplay rule stay 100% push-independent; a push that never
arrives (permission denied, token expired, app not installed) never blocks or changes a
game. See `arch/mobile-notes.md`'s store-policy checklist for the App Store / Play Store
privacy-label implications of collecting a push token at all.

## 2. Socket.IO protocol — namespace `/game`

Connection: `io('wss://api.sketchy.example/game', { auth: { token }, transports: ['websocket'] })`.
Invalid/expired token ⇒ connection refused with `unauthorized`. One logical player may have
one active socket per room; a newer connection for the same playerId supersedes the older
(the old socket receives `session:superseded` and is dropped) — this makes device-switching
and "reopened the tab" trivially correct.

**Every client→server event uses an ack callback**: `(response: { ok: true, ... } | { ok:
false, error }) => void`. Event names and payload schemas are exported from
`packages/shared/src/contract/socket.ts` — clients never hand-type event strings.

### 2.1 Client → server

| Event            | Payload                 | Ack (success)      | Notes                                                                                                                                                                    |
| ---------------- | ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `room:join`      | `{ code }`              | `{ ok, snapshot }` | Joins/rejoins. Works mid-game only for players already seated (rejoin) or as Ghost/spectator per settings.                                                               |
| `room:leave`     | `{}`                    | `{ ok }`           | Explicit leave (≠ disconnect). In lobby: removes seat. Mid-game: marks player abandoned (treated as eliminated at next reveal).                                          |
| `room:sync`      | `{ lastVer }`           | `{ ok, snapshot }` | Full-state resync; client calls on reconnect & on any gap suspicion.                                                                                                     |
| `lobby:ready`    | `{ ready: boolean }`    | `{ ok }`           |                                                                                                                                                                          |
| `lobby:settings` | `Partial<GameSettings>` | `{ ok }`           | Host only; validated by engine (role counts vs player count, pack access).                                                                                               |
| `lobby:kick`     | `{ playerId }`          | `{ ok }`           | Host only. Kicked player's sockets get `room:event {type:'kicked'}` then disconnected from the room.                                                                     |
| `game:start`     | `{}`                    | `{ ok }`           | Host only; engine validates min players & role math; draws pair excluding `usedPairs`.                                                                                   |
| `deal:ack`       | `{}`                    | `{ ok }`           | "I've seen my word." Dealing → clue phase when all alive players acked (or timer).                                                                                       |
| `clue:submit`    | `{ text }`              | `{ ok }`           | Turn-holder only. Server validates: phase, turn, 1–40 chars, not the secret word (either side), not a repeat of any clue this game (case-insensitive), profanity filter. |
| `phase:advance`  | `{}`                    | `{ ok }`           | Host only. Ends discussion early → voting; also dismisses reveal → next round.                                                                                           |
| `turn:skip`      | `{}`                    | `{ ok }`           | Host only — skips a stalled clue turn (disconnected/AFK player). Engine records an empty clue `"(skipped)"`.                                                             |
| `vote:cast`      | `{ targetId }`          | `{ ok }`           | One ballot per alive player per vote; changeable until the vote closes; Ghosts vote only if Ghost role enabled.                                                          |
| `mrwhite:guess`  | `{ word }`              | `{ ok }`           | Only the just-eliminated Mr. White, only during `mrwhite_guess`. Exact-ish match: case/diacritic-insensitive, trimmed.                                                   |
| `game:rematch`   | `{}`                    | `{ ok }`           | Host only, from `game_over`. Same seats & settings, fresh pair (de-duped), scoreboard carries over.                                                                      |
| `chat:send`      | `{ text }`              | `{ ok }`           | Room chat (lobby + in-game + ghosts). 1–200 chars, rate-limited, profanity-filtered.                                                                                     |
| `timer:extend`   | `{}`                    | `{ ok }`           | Host only, once per phase, any phase with an active deadline — engine `extendTimer`, +60s (game-design §6.3). _(Added phase 6, closing phase-2's logged contract debt.)_ |
| `host:transfer`  | `{ targetId }`          | `{ ok }`           | Host only. Hands the pencil to another seated player (game-design §8 manual hand-back). Dispatches engine `migrateHost`; fans out `hostChanged`. _(Added phase 8.)_ Auto-migration (grace expiry / explicit host leave) is server-originated and needs no client event. |
| `special:judge`  | `{ targetId }`          | `{ ok }`           | Judge only, during a tie the engine has routed to them (phase 12).                                                                                                       |
| `special:grudge` | `{ targetId }`          | `{ ok }`           | Just-eliminated Grudge holder choosing who to drag down, during `grudge_decision` (phase 13). `targetId` must name a currently alive player; enforced server-side by the engine's `grudgeDrag` reducer, never trusted from the client. |
| `voice:state`    | `{ muted: boolean }`    | `{ ok }`           | Reports the caller's OWN LiveKit mute state (phase 15, live) — the server fans it out to the whole room as `voice:roster` (§2.2) so participants who aren't themselves connected to voice still see who's muted. No phase/turn restriction — legal in lobby and every game phase, including as a spectator/Ghost. `VOICE_ENABLED=false` acks `{ok:false, error:'voice_disabled'}`. |

`special:judge` (phase 12), `special:grudge` (phase 13), `voice:state`/`voice:roster`
(phase 15), and `mm:matched` (phase 16 — the ONE `mm:*` event, server→client only; enqueue/
cancel are REST) are all live. No namespaces remain reserved.

### 2.2 Server → client

| Event                | Payload                                            | When                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room:snapshot`      | `{ ver, state: RedactedGameState, you: YouSlice }` | After every accepted action, phase timeout, join/leave/presence change. **The only way state reaches clients.** `state` is spectator-redacted; `you` is the caller's private slice ([data-model.md §4](data-model.md)). |
| `room:event`         | `{ type, ...meta }`                                | Transient, non-state toasts: `playerJoined`, `playerLeft`, `playerDisconnected`, `playerReconnected`, `hostChanged`, `kicked`, `timerExtended`. UI copy per type in copy.md §8.                                         |
| `chat:message`       | `{ from: { id, name }, text, at }`                 | Fan-out of `chat:send`. Not part of state; not replayed on resync (chat is ephemeral by design).                                                                                                                        |
| `session:superseded` | `{}`                                               | This socket was replaced by a newer connection for the same player.                                                                                                                                                     |
| `voice:roster`       | `{ muted: Record<string, boolean> }`               | Phase 15, live — the `voice:state` mirror: the FULL current mute map (playerId → muted) for every player who has sent `voice:state` this room-session. Sent (a) to the whole room whenever any player's mute state changes, and (b) once, straight to a just-(re)joined socket, right after `room:join`/rejoin binds — so a late joiner/resync sees correct icons without waiting on someone else to toggle their mic. Never folded into `room:snapshot`/`GameState` — voice is cosmetic to the engine (system-design.md §8). |
| `mm:matched`         | `{ code }`                                         | Phase 16 queue resolution.                                                                                                                                                                                              |

```ts
YouSlice = { playerId, role, word, specialRole, yourVote: string | null,
             canAct: { submitClue: boolean, vote: boolean, judge: boolean, grudge: boolean, ... },
             lovebirdsPartnerId: string | null, rivalId: string | null }
// `canAct` is computed server-side so clients never re-derive permission logic.
// `lovebirdsPartnerId`/`rivalId` (phase 13): server-computed, `null` unless the viewer
// genuinely holds that paired special role — see data-model.md's "Phase 13 engine
// extension" note for why this is a `you`-slice concern rather than new public state.
RedactedGameState = GameState with pair/roles/words/votes redacted per data-model.md §4
```

### 2.3 Sync & timer rules (normative)

1. Clients render **only** from the latest `room:snapshot` (+ their `you` slice). Any
   snapshot with `ver` ≤ current is discarded.
2. On EVERY socket connect — first connect and every auto-reconnect — the client emits
   `room:join { code }`: a reconnect is a brand-new connection server-side (fresh socket,
   no room binding), and `room:join` is idempotent for an already-seated player (a pure
   rejoin — rebind + presence, no engine `join`). `room:sync` is only the mid-connection
   gap-fill: emit it on visibility regain (mobile web tab wake) or any gap suspicion.
   There is no diff protocol. _(Amended in phase 5 — the original rule said "on
   connect/reconnect emit `room:sync`", which cannot work for reconnects: the server has
   no room binding for the new connection to sync within.)_
3. Timers: clients render countdowns from `state.phaseEndsAt` minus an estimated clock
   offset (one `time:ping` → `{serverNow}` measurement per connection, exposed as event
   `time:ping` with ack). Clients never trigger phase changes; the server applies timeout
   actions and broadcasts.
4. Optimistic UI is allowed **only** for the actor's own pending action (e.g. dim your vote
   button immediately) and must reconcile with the next snapshot.

## 3. How pass-and-play uses this contract

It doesn't — by design. Pass-and-play imports `packages/engine` directly in the browser:
same `applyAction` reducer, same `GameState`, `redactFor()` drives the pass-the-phone privacy
screens, and localStorage replaces Redis. Word packs are fetched over REST (`GET /packs`,
`GET /packs/:id/pairs`) and the official starter pack ships bundled with the client for a
fully offline path. No sockets are involved. The future mobile app gets the identical
offline mode for free by importing the same package.

## 4. Contract change checklist (any phase touching this file)

1. Change the Zod schema in `packages/shared` first; types flow to both apps.
2. Update this document in the same PR (tables above; keep error codes in sync with copy.md §9).
3. Additive only once `/v1` is frozen (phase 17) — see §0 versioning policy.
4. New socket events must: use an ack, be validated server-side by the engine (never trust
   the client's claimed role/turn), and appear in the §2 tables.
