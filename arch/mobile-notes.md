# Mobile notes — React Native readiness

> Phase 17 deliverable. Scope per plan/phase17.md: design/verification only — no React
> Native app exists in this repo, and none ships in this roadmap (mobile is "unblocked, not
> built"). This is the on-ramp for whoever eventually builds it.

## Recommended stack

- **Expo (React Native)**, managed workflow — fastest path from zero to a signable app,
  EAS Build/Submit handles the native toolchain neither this repo nor its CI currently has.
- **`socket.io-client`** — the SAME library the web app and this phase's headless reference
  client (`packages/shared/examples/headless-client.ts`) already use; no RN-specific
  transport shim needed (it runs on plain WebSocket, which RN provides natively).
- **TanStack Query** for the REST half (`@sketchy/shared/client`'s `createApiClient` —
  already fetch-based, already framework-agnostic) — cache invalidation for packs/history/
  stats, the same shape the web app would benefit from adopting too (not yet done there).
- **`@sketchy/engine`** reused verbatim for **offline pass-and-play**: same `applyAction`
  reducer, same `GameState`, `redactFor()` drives the privacy screens — api-contract.md §3
  already documents this as the intended pattern ("pass-and-play imports packages/engine
  directly... the future mobile app gets the identical offline mode for free by importing
  the same package"). Swap `localStorage` for `AsyncStorage`/`expo-secure-store` at the
  persistence boundary only; the engine itself has zero storage opinions.
- **`@sketchy/shared`** reused verbatim for the contract: Zod schemas, `CLIENT_EVENTS`/
  `SERVER_EVENTS` constants, `createApiClient`. Verified this phase to build cleanly for a
  platform-neutral (RN/Metro-safe) target with zero patches — `pnpm check:rn-build`
  (`scripts/check-rn-build.mjs`), wired into CI. See that script's doc comment for exactly
  what it does and doesn't prove.
- **Auth**: identical flow to web, by design (system-design.md §6) — `POST /auth/guest` →
  store the JWT in `expo-secure-store` (not `localStorage`, obviously, but same
  header-token model, zero cookies) → `Authorization: Bearer` on REST, `auth: { token }` on
  the socket handshake. The headless client's `runAuthPortabilityChecks` (phase 17) is a
  runnable proof of the full lifecycle — issue, bearer use, silent re-issue, socket
  handshake, expired-token rejection — from a non-browser client.

## What does NOT port 1:1

- **Party Pop's hand-drawn CSS look** (`border-3`-style thick borders + hard/offset
  drop-shadows, Rough.js-drawn frames — conventions.md §2 "Sketch rendering") has no RN
  equivalent via CSS. Re-implement with RN `StyleSheet` `borderWidth`/`borderColor` +
  `shadowOffset`/`shadowOpacity`/`shadowRadius` (iOS) and `elevation` (Android) — visually
  approximable, not a direct port. Rough.js itself (an SVG/canvas library assuming a DOM) is
  browser-only; a hand-drawn RN look would need either pre-rendered SVG assets (traced once,
  shipped static) or a canvas library with RN bindings (e.g. `react-native-skia`) — a real
  design+build task, not a config change.
- **The two genuinely SVG-driven surfaces** — `PopTimerRing`
  (`apps/web/src/components/pop/pop-timer-ring.tsx`, an `<svg>` countdown ring) and the Open
  Peeps avatar composer (`<AvatarDoodle config>`, modular hand-drawn parts assembled from
  `AvatarConfig` — conventions.md §2, data-model.md §1) — both need `react-native-svg`
  rather than a browser `<svg>` element. The underlying data (`AvatarConfig` in
  `@sketchy/shared/contract/players`, `phaseEndsAt` timestamps in `RedactedGameState`) is
  already portable; only the RENDERING layer needs a rewrite, not the state it draws from.
- **Fonts ship fine.** conventions.md §2's OFL-1.1, self-hosted woff2 fonts (via `next/font`
  on web) have no licensing obstacle for RN — bundle the same `.ttf`/`.otf` sources via
  `expo-font` / `useFonts()` instead of `next/font`'s webpack-specific loader. A build-config
  swap, not a design or licensing one.
- **Everything else** — the REST client, socket event handling, the reactive
  snapshot-driven state model (api-contract.md §2.3: "clients render only from the latest
  `room:snapshot`"), and the whole engine — is plain TypeScript with no DOM/browser
  assumption, and now has a CI-enforced guarantee of that (`pnpm check:rn-build`, plus the
  `no-restricted-imports` Node-built-in ban this phase added for `packages/shared/src/**`,
  mirroring the ban `packages/engine/**` already had since phase 1).

## Voice parity (LiveKit)

Phase 15 (landing concurrently with this phase, in a separate work-stream) adds first-party
voice: a token-minting REST route and a `voice:state` socket event mirroring mute state into
the player strip (system-design.md §8, arch/api-contract.md §1/§2 "voice" rows — those rows
are Phase 15's territory; this document does not restate their exact shapes since they may
still be settling as this is written. **Cross-check api-contract.md directly before
integrating** — the phase 17 contract audit found the two design docs disagreeing on the
token route's HTTP method (system-design.md §8 says `POST`, api-contract.md §1 says `GET`);
confirm against whichever is live by the time an RN build starts, api-contract.md is the
source of truth per its own §0 preamble).

LiveKit ships an **official React Native SDK** (`@livekit/react-native`) alongside the web
SDK the phase 15 web integration uses (`@livekit/components-react`) — this was explicitly
part of system-design.md §8's rationale for choosing LiveKit over alternatives ("official
React components AND React Native SDK (mobile stays unblocked)"). Parity plan, described
against the DOCUMENTED contract rather than phase 15's implementation:

1. Fetch a LiveKit access token from the voice-token endpoint the same way the web client
   does (member-of-room check happens server-side either way).
2. Connect via `@livekit/react-native`'s `Room`/`useRoomContext` in place of the web SDK's
   equivalents — same token, same LiveKit room name (room code), same audio-only
   publish/subscribe constraints.
3. Mirror the `voice:state` socket event exactly as the web client does — it's transport-
   agnostic (plain Socket.IO), no RN-specific handling needed.
4. RN-specific concerns web doesn't have: microphone permission prompts go through
   `expo-av`/OS-level permission APIs rather than `getUserMedia`; background-audio behavior
   (does voice survive an app backgrounding, same as the "iOS Safari pauses mic on tab
   switch" caveat phase 15's web Verify checklist calls out honestly) needs its own honest
   testing pass — don't assume RN foreground-audio session config is a solved problem by
   default.
5. Everything phase 15 documents as a guardrail (voice server down → game unaffected, kill
   switch via `VOICE_ENABLED`, per-room participant cap) is server-side and applies
   identically regardless of which client connects.

## Store-policy checklist (privacy labels)

Both app stores require declaring data collection at submission time — plan this BEFORE
building, not after:

- **Email** (phase 16, not yet live): collected for magic-link account linking. Apple App
  Store "Privacy Nutrition Label" category: **Contact Info → Email Address**, linked to
  identity (used for login), not used for tracking. Google Play Data Safety: same
  classification, declare "Account management" as the purpose, no third-party sharing
  beyond the transactional email provider (Resend/Postmark, per plan/phase16.md).
- **Voice** (phase 15): LiveKit's audio streams are NOT recorded or stored server-side
  (system-design.md §8, phase 15's explicit "recording — never — privacy stance," Out of
  scope list) — so this is closer to a live communication feature than "data collection,"
  but both stores still require disclosing **microphone access** and its purpose (in-app
  voice chat) in the permission-usage description (`NSMicrophoneUsageDescription` on iOS,
  the `RECORD_AUDIO` permission rationale on Android) even though no audio is persisted.
- **Guest identity** (`players.id`, display name, avatar config): Apple/Google both want
  "User ID" and "Other User Content" declared even for anonymous/guest accounts — the
  `playerId` persists across sessions (system-design.md §6) and is the join key for game
  history, so it counts as an identifier even without a login.
- **Push tokens**, if/when `POST /v1/devices` (api-contract.md's new RESERVED section, this
  phase) is actually built: declare **Device ID** / push-token collection, purpose
  "Notifications," no third-party sharing (APNs/FCM are the delivery channel, not a
  third-party data recipient in the stores' own taxonomy — but check each store's current
  wording, this shifts across policy revisions).
- **Analytics/crash reporting**: this repo already ships Sentry (`apps/api`) — if the mobile
  app adds a Sentry SDK too, declare **Crash Data** / **Diagnostics**, and confirm the DSN
  scrubs PII the same way `apps/api/src/observability.ts` already documents doing
  server-side (conventions.md §1's "never log clue/word/vote contents" rule should extend
  to any client-side breadcrumbs too).
- None of the above blocks a first submission — every category above is a standard,
  well-trodden declaration, not a design change — but budget real time for it; it is
  routinely the thing that delays a first submission, not the code.

## Proof this phase already produced

- `packages/shared/examples/headless-client.ts` — a genuine non-browser client playing a
  full game to completion over the real `/v1` REST + `/game` socket contract. Read it before
  writing the RN networking layer; it is closer to "what the mobile client's data layer
  should do" than any web component is (the web app also renders UI, which is irrelevant
  here).
- `arch/openapi-v1.baseline.json` — the frozen `/v1` OpenAPI 3.1 document. Point an
  OpenAPI-to-TypeScript generator at `GET /v1/openapi.json` (or this file) if the mobile
  team wants generated types instead of importing `@sketchy/shared` directly — either is
  valid since both are Zod-schema-derived from the same source.
