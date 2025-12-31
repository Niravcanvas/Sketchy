# Post-launch backlog — deliberately deferred debt & gaps

A single, honest home for the known Tier-1/Tier-2 debt and future gaps that this
pre-launch hardening pass **deliberately defers**. Everything here has been reviewed and
decided **DEFERRED — non-launch-blocking**; the point of the doc is that nothing is
silently dropped. Each item carries a one-line reason and a real code citation (verified
against the tree, not restated on faith).

This is a log, not a work order — none of it is scheduled for the launch cut. When one of
these is picked up post-launch, do it properly (contract/`/v2` conversation where flagged)
rather than as a quiet patch.

---

## From WP-14 — deferred debt

### 1. Avatar-fallback duplication (api vs. web)

**Deferred reason:** consolidating avatar-fallback logic into `packages/shared` is a
deliberate cross-package refactor — not worth the churn/risk in a pre-launch hardening
pass; do it post-launch.

Two independent deterministic-fallback generators produce an `AvatarConfig` for a player
whose stored avatar isn't well-formed, and they are **not** shared:

- **api:** `apps/api/src/rooms/default-avatar.ts:57` — `defaultAvatarForPlayerId(playerId)`
  keys off a djb2-ish hash of the player id, over placeholder part-id lists
  (`HEADS`/`FACES`/… at lines 36-41).
- **web:** `apps/web/src/lib/default-avatar.ts:22` — `defaultAvatar(seat)` keys off the
  seat index, over the *real* curated Open Peeps ids (`AVATAR_*_IDS`).

`packages/shared` today carries only the `avatarConfigSchema` *type/shape*
(`packages/shared/src/contract/players.ts`), **not** a shared fallback generator — so the
duplication is real, not already-consolidated.

**Verified nuance from the brief holds:** the *api-internal* duplication is already reduced.
`DEFAULT_AVATAR` is now a single exported const
(`apps/api/src/rooms/default-avatar.ts:13`) consumed by both guest creation and the
account-deletion anonymize path (`apps/api/src/routes/accounts.ts:24,311`). The api file's
own comment (`default-avatar.ts:30-34`) already names "folding both fallbacks into one
shared `packages/shared` implementation" as logged debt. So what remains is strictly the
**api-vs-web** duplication.

### 2. `POST /auth/link/request` timing side-channel

**Deferred reason:** low-severity; equalizing the latency (constant-time path / always
await a dummy send) is a hardening nicety, not launch-blocking.

The response is **content/enumeration-safe** — the same constant `LINK_REQUEST_OK` body
and 200 status regardless of whether the email is free or already taken
(`apps/api/src/routes/accounts.ts:32,90`). But the two branches differ in **latency**:
when the email is free (`if (!taken)`), the handler `await`s a real token mint **and** a
real magic-link send (`accounts.ts:76-88`); when the email is already taken by another
player, it skips straight to `return LINK_REQUEST_OK` (`accounts.ts:90`) with no such work.
A precise timing attack could exploit that difference to distinguish the two cases. Low
severity (needs many timed samples; send latency is noisy), so deferred.

### 3. Multi-process / horizontal-scaling broadcast gap

**Deferred reason:** only relevant if the API runs more than one replica; a single-replica
launch is unaffected. **MUST be resolved before any multi-replica scale-out.**

`broadcastSnapshots` (`apps/api/src/rooms/snapshot.ts:120`) reads room membership from the
adapter (`namespace.adapter.rooms.get(code)`) but then resolves each socket **only from the
local in-process map** (`namespace.sockets.get(socketId)`, `snapshot.ts:125-131`), skipping
any socket it can't find locally. Correct for the single-process deployment this project
targets, but a >1-replica deploy needs adapter-aware fan-out (each process redacting for
its own locally-connected sockets in response to a cross-process signal, or
`fetchSockets()`-style emit). The function's own doc comment (`snapshot.ts:107-118`)
already documents this and cites `system-design.md §4.5` ("dormant until multi-process").
**Hard gate: this must land before Phase 9 ever runs a second API replica.**

### 4. Public low-privilege `{ gamesToday }` endpoint — RESOLVED

**Original deferred reason:** the landing counter was already gated to hide small/failed
values, so a dedicated public stats endpoint was treated as a nice-to-have, not required.

**Resolution:** implemented. `GET /v1/stats/games-today` (`apps/api/src/routes/stats.ts`) is
a public, unauthenticated endpoint returning ONLY `{ gamesToday }`, computed by the SAME
`countGamesToday()` query `GET /admin/stats` uses (`apps/api/src/services/stats.ts`) so the
two can never disagree — no admin-only gauge (`roomsActive`/`socketsConnected`/
`actionsPerMin`) crosses this boundary. It's protected by a dedicated per-IP limiter
(`statsRateLimit`, 20/min, `apps/api/src/rate-limit.ts`) since there's no player identity to
key on. `apps/web/src/lib/admin-stats.ts`'s `getGamesToday()` now calls this endpoint instead
of the admin-token-gated `GET /admin/stats` — it no longer reads `process.env.ADMIN_TOKEN` or
sends an `Authorization` header at all, so the public web tier is fully decoupled from the
ops-only bearer token. The contract addition is documented in `arch/api-contract.md` §1
"Ops" and is purely additive to the frozen `/v1` baseline (`arch/openapi-v1.baseline.json`).
The original context (below) is kept for history.

The landing-page social-proof counter used to read the **ops** admin endpoint: `getGamesToday()`
called `GET /admin/stats` with `Authorization: Bearer ${ADMIN_TOKEN}`
(`apps/web/src/lib/admin-stats.ts:46,50-53`, pre-fix), and that endpoint is gated on
`requireAdminToken` (`apps/api/src/routes/admin.ts:250-262`). This coupled the public web
server to an ops-only bearer token — the web module's own comment flagged it explicitly
("FLAG FOR OWNER REVIEW", `admin-stats.ts:14-19`, pre-fix). Also cross-referenced as
owner-review debt in `plan/phase17-handoff.md:444-448`.

---

## From WP-18 — narrative / future gaps (log, don't build)

### 5. Rematch "Back to lobby" variant (online)

**Deferred reason:** returning a finished room to `lobby` has no engine action / contract
event today — game_over only transitions to `dealing` via `rematch`; adding it means a new
`game:reset` action, deferred to keep engine + shared frozen.

The online win screen (`OnlineWinScreen`, `apps/web/src/components/room/game/win-screen.tsx`)
offers exactly two CTAs: **Rematch** for the host (`emitRematch`, `win-screen.tsx:376-387`)
and **Leave room** for everyone (`emitLeave`, `win-screen.tsx:393-402`). There is **no**
"Back to lobby" button. The file's own `TODO` (`win-screen.tsx:170-173`) documents exactly
this: `game-design.md §6.7`'s host "Back to lobby" has no engine action / contract event,
so "Leave room" is the frozen-safe exit "until a `game:reset` action lands."

**Verified nuance:** the copy string `copy.reveal.endCTAs.backToLobby` *does* exist
(`apps/web/src/copy.ts:480`), but it is used only by the **pass-and-play** reset path
(`apps/web/src/stores/pnp-store.ts:307`), never wired into the online room. So this is a
genuine online-path gap, not a missing string.

### 6. Online second-tie / all-abstain narrative beat

**Deferred reason:** the online room has no dedicated narrative overlay for a second
consecutive tie / all-abstain outcome — the engine just returns to a fresh clue round; a
narrated beat is polish, deferred.

The copy exists — `copy.phases.secondTie` and `copy.phases.allAbstain`
(`apps/web/src/copy.ts:407-409`) — but it is consumed **only** by the pass-and-play
interlude overlay (`apps/web/src/components/pnp/interlude-overlay.tsx:58-59`, on the
`second_tie` / `all_abstain` kinds). No online room component references it. The online
flow *does* have an interlude component — but `guess-interlude.tsx` is explicitly "the
online analog of pass-and-play's interlude overlay" for the **Mr. White guess** only
(`apps/web/src/components/room/game/guess-interlude.tsx:16`), not for tie/abstain. On the
engine side these outcomes route straight back to a new clue round with no reveal
(all-abstain → `enterFreshClueRound`, `packages/engine/src/reducers/vote.ts:225`; second
tie → no elimination, next round, `vote.ts:87`), so an online player simply sees the phase
jump back to `clue` with no narration.

### 7. Grudge "drag nobody" self-service button (online)

**Deferred reason:** closing this needs a contract change (`targetId` becoming nullable on
`special:grudge`) — an additive-only `/v1`-freeze concern that belongs in a `/v2`
conversation, not a quiet patch.

Pass-and-play's Grudge screen has an explicit "drag nobody" button (`plan/phase13.md:73`).
The **online** screen deliberately does not: `OnlineGrudgeDecisionScreen`
(`apps/web/src/components/room/game/grudge-decision-screen.tsx`) renders a button per alive
player and requires a selection to confirm (`grudge-decision-screen.tsx:35,95-104`), and
its own doc comment states "there's no self-service 'drag nobody' button here — that
outcome only ever comes from the 30s timeout or the host's early `phase:advance`"
(`grudge-decision-screen.tsx:18-21`). Giving the online Grudge a self-service "drag nobody"
would require `special:grudge`'s `targetId` to become nullable — a contract change.

**Provenance note:** the brief attributes this to phase-13's handoff, but
`plan/phase13-handoff.md` no longer exists in the tree (deleted). The live carry-forward of
this idea is `plan/phase17-handoff.md:449-455`, which records the same gap and names the
`targetId`-nullable contract change as the fix.

---

## Not launch-blocking, and not in scope for this log

For completeness, these were reviewed and are covered elsewhere rather than duplicated here:

- Broader pre-mobile debt (R2 placeholder credentials, device-picker/public-catalog gaps,
  the unbuilt Phase 16 surface) is already enumerated in `plan/phase17-handoff.md:435-469`.
- The `ADMIN_TOKEN` coupling (item 4) and the Grudge idea (item 7) overlap that list — kept
  here because they were explicitly routed into this backlog pass.
