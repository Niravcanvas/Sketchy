# System Design — "Sketchy" (Undercover-style party game)

> Shared reference. Phase files in `plan/` point here instead of re-explaining. Sibling docs:
> [data-model.md](data-model.md) · [api-contract.md](api-contract.md) ·
> [game-design.md](game-design.md) · [copy.md](copy.md) · [conventions.md](conventions.md)

## 0. Constraints this design is built around (decided, don't re-litigate)

- **Stack**: TypeScript everywhere. Next.js (App Router) + React + Tailwind on the web; a
  separate Node backend service; self-hosted on a single VPS (~4 vCPU / 8 GB RAM); Redis and
  Postgres run on the same VPS; Cloudflare available (DNS/proxy + R2 storage).
- **Scale target**: low hundreds of concurrent connected players (~50–100 active rooms) at
  launch. One node handles this comfortably; the design keeps a documented path to horizontal
  scale without building it now.
- **Clients**: web first; a phone app comes months later and must reuse the backend unchanged.
  Nothing in the backend may assume "the client is Next.js".
- **Modes**: pass-and-play (one device, fully offline-capable) AND remote online rooms
  (room-code private rooms at launch; public matchmaking is a later phase). Remote players talk
  over Discord at launch; first-party in-game voice chat is a dedicated later phase.

## 1. High-level topology

```
                        ┌──────────────────────────────┐
        players ───────▶│  Cloudflare (DNS proxy, TLS,  │
                        │  CDN cache, WAF, R2 storage)  │
                        └──────────────┬───────────────┘
                                       │ HTTPS / WSS (Cloudflare proxies WebSockets)
                     VPS (4 vCPU / 8GB)│
                        ┌──────────────▼───────────────┐
                        │  Caddy (reverse proxy,        │
                        │  Cloudflare origin cert)      │
                        └───┬───────────────┬──────────┘
                            │               │
              app.domain /* │               │ api.domain /v1/*  + /socket.io/*
                ┌───────────▼──┐      ┌─────▼──────────┐
                │ apps/web     │      │ apps/api        │
                │ Next.js      │      │ Fastify + REST  │
                │ (SSR + static│      │ Socket.IO (ws)  │
                │  marketing,  │      │ game engine     │
                │  game client)│      │ (authoritative) │
                └──────────────┘      └───┬───────┬─────┘
                                          │       │
                              ┌───────────▼──┐ ┌──▼──────────┐
                              │ Redis         │ │ Postgres 16 │
                              │ hot game state│ │ durable data│
                              │ pub/sub, rate │ │ packs, games│
                              │ limits, queues│ │ players     │
                              └───────────────┘ └─────────────┘

  Later phases add on the same VPS:  LiveKit (voice SFU, phase 15)
  Cloudflare R2 holds: user-uploaded images (custom pack covers, avatars), DB backups.
```

Two public hostnames (placeholders — swap for the registered domain in phase 9):

| Hostname              | Serves                                      | Notes                                                           |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| `sketchy.example`     | Next.js app (marketing pages + game client) | Cloudflare caches static assets                                 |
| `api.sketchy.example` | Fastify REST `/v1/*` + Socket.IO            | Cloudflare proxy supports WSS; **disable caching** on this zone |

A separate API hostname (rather than routing `/api` through Next.js) is deliberate: the mobile
app will point at `api.sketchy.example` and never touch Next.js.

## 2. Service layout (monorepo)

pnpm workspaces. The backend is a standalone service; Next.js contains **no game logic** and
**no API routes** for game features.

```
apps/
  web/        Next.js App Router — game client + marketing. Talks to apps/api only
              through the typed client in packages/shared. No DB access, ever.
  api/        Fastify 5 + Socket.IO 4. REST for CRUD, sockets for realtime play.
              The ONLY process that touches Postgres and Redis.
packages/
  engine/     Pure TypeScript game engine: state machine, reducers, role assignment,
              win conditions, scoring, role-count suggestions. Zero I/O, zero deps on
              Node APIs — runs identically in the browser (pass-and-play) and on the
              server (online rooms). Deterministic given an injected RNG seed.
  shared/     Zod schemas + TS types for every REST body and socket event (the API
              contract, see api-contract.md), the typed REST client, socket event
              name constants, shared utilities (room-code alphabet, profanity list).
  config/     Shared tsconfig / eslint / prettier / tailwind preset.
```

**Why the engine is a package, not server code**: pass-and-play runs the entire game
client-side with no network (works offline, instant), while online rooms run the same reducer
server-side as the single source of truth. One rules implementation, two hosts. This is the
core architectural bet of the project — any rules change lands in exactly one place, and the
future mobile app gets pass-and-play by importing the same package.

## 3. Database: PostgreSQL 16 — and why

Postgres over the alternatives, concretely:

- **The data is relational**: players ↔ games ↔ game_players ↔ word packs ↔ pairs, score
  history aggregated per player. Foreign keys and joins are the natural shape; a document DB
  would immediately re-invent them.
- **JSONB where flexibility is real**: finished-game snapshots (`games.summary`), per-game
  settings, avatar doodle configs. We get schema-on-write for the stable core and
  schema-on-read for the parts that will churn (special roles add settings keys every phase).
- **One binary on the VPS, boring and battle-tested**: excellent backup story (`pg_dump` →
  R2 nightly), point-in-time recovery available later via WAL archiving if ever needed.
- **Room to grow without migration**: full-text search for public pack browsing (phase 16),
  `LISTEN/NOTIFY` if we ever want DB-driven events, read replicas if traffic demands.
- **SQLite was considered** (single box, low write volume) and rejected: concurrent writers
  during result persistence + future multi-process API and background jobs make Postgres the
  safer default, and it's already available on the VPS.

Access layer: **Drizzle ORM** + `drizzle-kit` migrations. Rationale: SQL-first (no query-engine
magic to debug on a VPS at 2 a.m.), generates precise TS types consumed by `packages/shared`,
trivially runs in CI. Migrations are committed files, applied by the deploy script — never
auto-applied by the app at boot. Schema lives in [data-model.md](data-model.md).

Postgres is **never** in the per-action hot path of a live game. It is written to at three
moments: entity CRUD (players, packs), game start (row created), game end (summary persisted,
scores updated). Everything between lives in Redis.

## 4. Redis — exactly what it is used for

Redis is the operational heart during play. Uses, exhaustively (keyspace detail in
[data-model.md §Redis](data-model.md)):

1. **Authoritative live-room state.** Each online room is one JSON document
   (`room:{code}:state`) plus a monotonically increasing version counter
   (`room:{code}:ver`). Every player action = load → run engine reducer → CAS-style write
   (version check) → broadcast. State survives API process restarts; a deploy mid-game does
   not kill running games. TTL 24 h, refreshed on activity.
2. **Room code allocation.** `SET room:{code}:lock NX EX` to claim a code atomically from the
   unambiguous alphabet (no 0/O/1/I — see conventions.md).
3. **Presence & connection mapping.** `room:{code}:conn` hash (playerId → socketId,
   lastSeenAt) driving the lobby presence UI, disconnect grace timers, and host-migration
   decisions.
4. **Rate limiting.** Sliding-window counters (`rl:{scope}:{key}`) for room creation, join
   attempts, clue/chat submission, auth endpoints. Enforced in Fastify middleware and in the
   socket handler.
5. **Socket.IO Redis adapter (dormant until multi-process).** Installed and configured from
   day one but effectively pass-through with a single API process. The moment we run 2+ API
   processes, broadcasts already fan out correctly — this is the pre-paid scaling path.
6. **Ephemeral queues & timers.** Server-side phase deadlines are stored in room state
   (`phaseEndsAt` epoch ms) and enforced by an in-process timer wheel with Redis as the source
   of truth on restart (scan active rooms, re-arm timers). Phase 16 adds the matchmaking queue
   (`mm:queue` sorted set).
7. **Cross-game session data.** Rematch scoreboards (accumulated points across rematches in
   one room) ride inside the room state doc; recently-used word-pair IDs per room
   (`room:{code}:usedPairs` set) prevent repeats within a session.

Redis is configured with `maxmemory 1gb`, `allkeys-lru` **disabled** (we use explicit TTLs;
eviction of live rooms would be data loss), `appendonly yes` (AOF everysec) so a VPS reboot
doesn't wipe running games.

## 5. Real-time layer: WebSockets via Socket.IO — and why

Requirements: bidirectional (clients submit clues/votes; server pushes phase changes),
room-scoped broadcast, reconnection with state resync, works from a future React Native app,
low infra ceremony on one VPS.

| Option                     | Verdict                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebSockets (Socket.IO)** | **Chosen.** Bidirectional, built-in room primitives, automatic reconnection with backoff, per-event acknowledgements (we use these for action results), first-party client for React Native, and the Redis adapter gives multi-process fan-out later without code changes. |
| Raw `ws`                   | Leaner, but we'd hand-roll rooms, heartbeats, reconnect, acks, and multi-process fan-out — precisely the undifferentiated plumbing Socket.IO ships.                                                                                                                        |
| SSE + POST actions         | Workable for one-way push, but we'd still need POST for every action, manual resync protocol, and SSE over HTTP/1.1 burns a connection per tab; no RN story as clean as socket.io-client.                                                                                  |
| Polling                    | Rejected: 2–4 s perceived lag in a game whose drama is simultaneous reveals; wasteful at 100+ rooms.                                                                                                                                                                       |

**Server-authoritative model.** Clients never mutate state locally in online mode. A client
emits an intent (`clue:submit`), the server validates (is it your turn? right phase? clue not
a repeat?), runs the engine reducer, persists to Redis, then broadcasts. The engine's reducer
signature (`applyAction(state, action, rng) → {state, effects, error}`) is identical in
pass-and-play, where the client is its own authority.

**State sync protocol** (full detail in [api-contract.md](api-contract.md)):

- Server broadcasts **redacted snapshots**, not diffs. Room state at this game's size is
  1–4 KB JSON; snapshot-on-change is trivially cheap and eliminates the entire class of
  diff-drift bugs. Each snapshot carries `ver`.
- **Redaction is per-viewer**: the public snapshot never contains secret words or roles of
  living players. Each connected socket additionally receives its own `you` slice (own role,
  own word, own vote). Redaction happens server-side in one function
  (`redactFor(state, playerId)`) — the only place that decides who may see what. Votes are
  tallied server-side and revealed only in aggregate at the reveal step.
- **Resync**: on connect/reconnect the client sends `room:sync {code, lastVer}` and always
  receives a full redacted snapshot. Clients treat any received `ver` ≤ their current as
  stale and drop it. There is no incremental catch-up to get wrong.
- **Acks**: every action emit gets an ack callback `{ok} | {ok:false, error}` (typed error
  codes in [copy.md §errors](copy.md)) so the UI can show immediate, accurate feedback.

**Timers** are server-owned. The server stamps `phaseEndsAt`; clients render countdowns from
it (with a one-time clock-offset estimate) and never decide that a phase is over. When the
deadline passes server-side, the server applies the timeout action (auto-skip clue, close
voting, etc.) and broadcasts.

## 6. Identity & auth

Friction kills party games, so identity is progressive:

- **Guest-first.** `POST /v1/auth/guest {displayName}` creates a `players` row and returns a
  long-lived signed **JWT** (`sub: playerId`, `guest: true`, 180-day expiry) that web stores
  in `localStorage` and mobile will store in secure storage. No email, no password, no cookie
  dependency — deliberately header-token-based (`Authorization: Bearer`) so the mobile app
  reuses the exact flow. The socket handshake carries the same token.
- Display name and doodle avatar are editable any time; the playerId is the stable identity
  that room rejoin, scoring, and pack ownership hang off.
- **Named accounts shipped in phase 16** (required before public matchmaking): email
  magic-link linking that upgrades the existing guest row in place (`is_guest = false`) —
  playerId never changes, history is preserved. Enumeration-safe + rate-limited; a single-use
  token lives in Redis (`link:{sha256}`, 15-min TTL) and the durable email lands on `players`.
  The transactional-email provider is env-configured (Resend/Postmark shape) — with none
  configured the dev provider logs the link instead of sending (real provider wiring deferred
  to phase 9).
- JWTs are signed with an HS256 secret from the environment; rotation strategy: two accepted
  secrets during a rotation window. No refresh tokens at this scale — 180-day expiry with
  silent re-issue on API use past the halfway point.

## 7. API surface (summary — the contract itself is api-contract.md)

- **REST `/v1/*`** for everything request/response-shaped: auth, player profile, pack & pair
  CRUD, room creation/join resolution, game history, stats. JSON bodies validated by the Zod
  schemas in `packages/shared` (single source of truth for both server validation and client
  types). OpenAPI 3.1 document auto-generated from those schemas and served at
  `/v1/openapi.json` — this is the artifact the mobile team consumes.
- **Socket.IO namespace `/game`** for live play only. Events are typed in `packages/shared`
  and enumerated exhaustively in api-contract.md. Rule of thumb: if it must reach other
  players in <1 s, it's a socket event; otherwise it's REST.
- **Versioning policy**: `/v1` is frozen at phase 17 (mobile-readiness). Additive changes
  (new optional fields, new events) are allowed anytime; breaking changes require `/v2` and a
  deprecation window — mobile app releases can't be hot-swapped like web deploys, which is
  the entire reason for this policy.

## 8. Voice: Discord-first, then first-party voice chat

- **Launch stance (phases 1–14)**: remote rooms are designed to be played **alongside a
  Discord/FaceTime call** — this is how the genre is actually played remotely. Concretely
  that means: no gameplay information is ever audio-only, every phase state is glanceable
  ("who are we waiting on"), timers are generous and host-adjustable, and the lobby has a
  "copy invite message" button that produces a paste-ready blurb (room link + code) for a
  Discord channel. This costs nothing and removes voice infrastructure from the launch
  critical path.
- **Phase 15 — in-game voice**: self-hosted **LiveKit** (Apache-2.0) on the same VPS as an
  audio-only SFU. Why LiveKit over alternatives: production-grade SFU with tiny ops surface
  (single Go binary), official React components AND React Native SDK (mobile stays unblocked),
  token-based room auth that maps 1:1 onto our room codes, and audio-only rooms of ≤20
  participants are light enough for the shared box at our scale. Why not WebRTC mesh: beyond
  ~6 participants upstream bandwidth per client degrades — our rooms go to 20. Why not
  embedding mediasoup in the API: couples voice load and game loop in one process and roughly
  triples the code we own. The API mints short-lived LiveKit tokens
  (`GET /v1/rooms/{code}/voice-token`) so voice membership exactly mirrors game-room
  membership; mute/speaking indicators render in the player strip
  (see [game-design.md](game-design.md)). Requires UDP port range + TURN/TLS fallback on 443
  — deployment details live in the phase 15 file.
- Voice remains **off by default in public-matchmaking rooms** (phase 16) until moderation
  tooling matures; Discord-first remains the documented alternative forever.

## 9. Deployment topology (VPS)

**Everything runs as Docker Compose services** under a single `deploy/compose.prod.yml`,
managed by systemd (`docker compose up -d` on boot). Containers over bare processes: identical
bits from CI to prod, one-command rollback (`:previous` tag), and Postgres/Redis versions
pinned independent of the host OS.

| Service    | Image                  | Notes                                                                                                                                                                                               |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caddy`    | caddy:2                | Reverse proxy. Terminates TLS with a Cloudflare **origin certificate**; Cloudflare proxy in front runs Full (strict). Routes by hostname to `web` / `api`. WebSocket pass-through for `/socket.io`. |
| `web`      | built in CI            | Next.js standalone output, port 3000 internal.                                                                                                                                                      |
| `api`      | built in CI            | Fastify + Socket.IO, port 4000 internal. Stateless (state in Redis) — can run 2 replicas later with the already-installed Redis adapter + Caddy sticky-by-cookie.                                   |
| `postgres` | postgres:16            | Bound to the internal Docker network only. Volume-backed. `shared_buffers=1GB`, `max_connections=50` (Drizzle pool ≤10).                                                                            |
| `redis`    | redis:7                | Internal only. AOF on. `maxmemory 1gb`.                                                                                                                                                             |
| `livekit`  | livekit/livekit-server | Phase 15 only.                                                                                                                                                                                      |

**Cloudflare's role**: DNS + proxy (hides origin IP), edge TLS, WAF/bot rules on auth and
room-creation endpoints, CDN caching for Next.js static assets (`/_next/static`, immutable),
**R2** for user uploads and nightly DB backups. R2 uploads go through presigned URLs minted by
the API (S3-compatible SDK); public reads are served via an R2 custom domain
(`cdn.sketchy.example`) so images ride Cloudflare's CDN and never touch the VPS. Cache rule:
`api.sketchy.example` bypasses cache entirely.

**CI/CD (GitHub Actions)**: on every push — typecheck, lint, engine + API tests. On tag/main —
build `web` and `api` images, push to GHCR, SSH to VPS, `docker compose pull && up -d`,
run pending Drizzle migrations, smoke-check `/v1/health`, rollback on failure. Deploys are
zero-drama mid-game because live state is in Redis, and clients auto-reconnect and resync
(§5) during the seconds the API restarts.

**Operations baseline** (set up in phase 9, not later):

- **Backups**: nightly `pg_dump` piped to R2 (30-day retention) + weekly restore drill note in
  the runbook. Redis AOF covers live games; it is not backed up off-box (rooms are ephemeral
  by design).
- **Monitoring**: `/v1/health` (process up) and `/v1/ready` (Postgres + Redis ping) probed by
  an external uptime service; Sentry (free tier) for API + web error tracking; pino JSON logs
  shipped to journald with 7-day rotation; a tiny `/v1/metrics`-style stats endpoint
  (rooms active, sockets connected, actions/min) readable by the admin token.
- **Runbook**: `deploy/RUNBOOK.md` — restart procedures, restore-from-backup, secret rotation,
  "the VPS rebooted, what now" (answer: compose comes up via systemd, Redis AOF restores
  rooms, timer wheel re-arms from `phaseEndsAt` scan).

## 10. Scaling path (documented now, built when needed)

Ordered levers, cheapest first — the design above makes each one additive:

1. Run `api` with 2–4 replicas on the same box (Redis adapter already fans out; Caddy adds
   sticky sessions for Socket.IO's HTTP-fallback polling, or we force `transports:
['websocket']` and skip stickiness entirely).
2. Move Postgres+Redis to a second VPS (connection strings are already env-config).
3. Multiple app VPSes behind Cloudflare load balancing; rooms are naturally shardable by code
   since all room state is keyed by room code in shared Redis.
4. Only past ~5k concurrent sockets does anything architectural change (room-sharded
   processes); explicitly out of scope.

## 11. Security & abuse baseline (launch, private rooms)

- All secrets (JWT keys, DB/Redis passwords, R2 keys) via environment — never in the repo;
  `.env.example` documents every variable.
- Rate limits (§4.4) on auth, room create/join, and per-socket action frequency (a clue
  submission per turn, vote per phase — the engine rejects out-of-turn actions anyway;
  the rate limiter just blunts floods).
- Input length caps + profanity filter (shared word list in `packages/shared`) on display
  names, room names, clues, and custom pack content. Zod validation rejects everything else.
- Room codes: 5 chars from a 31-char unambiguous alphabet ≈ 28.6M combinations, join attempts
  rate-limited — brute-force enumeration is impractical; codes also expire with room TTL.
- CORS: REST + socket origins allow-listed (web origin now, app scheme later).
- No PII beyond display name at launch (guest model); magic-link email arrives with accounts
  in phase 16 and brings a privacy-policy update with it.

**Phase 16 — public matchmaking abuse posture** (extends the above once strangers can meet):
public rooms and quick-join require a linked account (accountability has a cost of entry —
guests keep private rooms), so reports and blocks mean something. Rails: `POST /reports`
(server-captured recent chat/clue context), a per-player block list the matcher honors
(blocked pairs are never seated together), a STRICTER profanity filter on public-room
chat/clues, and a token-gated admin queue whose actions (dismiss / warn / suspend / retire
pack) are all logged. A suspended player is refused at every auth boundary (REST + socket) with
a sanitized message. Ranked/ELO, friends/parties, OAuth, and ML moderation stay out of scope.
