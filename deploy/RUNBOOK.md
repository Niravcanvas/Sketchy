# Runbook

Operational procedures for running Sketchy — day-to-day ops, not architecture (see
[arch/system-design.md](../arch/system-design.md) for that). Grows as each phase adds an
operational concern; this file starts with phase 10's reconciliation job.

## Rollback Procedure

If a deploy introduces a critical bug or regression, you can rollback to a previous known-good state by specifying older image tags. `deploy.sh` intentionally keeps the most recent 3 SHA-tagged images (e.g. `sketchy-web:<sha>`).

You can rollback by overriding `WEB_IMAGE` and `API_IMAGE` and re-running docker compose:

```sh
WEB_IMAGE=sketchy-web:<previous-sha> API_IMAGE=sketchy-api:<previous-sha> \
  docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d --wait
```

> [!WARNING]
> Rolling back the application images does **NOT** undo database migrations.
> If the broken deploy included a destructive database migration (e.g. dropping a column), the old code may crash expecting the old schema. In that case, you must manually restore the database from the `pg_dump` backup taken just before the migration.

## Database bootstrap — migrations + official word-pack seed

A fresh production database needs two one-off runs before real traffic, both via profile-gated
services in `deploy/compose.prod.yml` (neither is part of the default `up -d` set, so a plain
deploy can never accidentally re-run either against a live DB):

```sh
# 1. Schema — run on a fresh box, and again after any commit that adds a migration.
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile migrate run --rm migrate

# 2. Official word packs — run once after the first migrate, and again whenever
#    apps/api/seed/packs/*.json content changes.
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile seed run --rm seed
```

`seed` runs `apps/api/scripts/seed.ts` (`pnpm db:seed`), which upserts one `word_packs` row per
file in `apps/api/seed/packs/*.json` (by slug) and diffs `word_pairs` (insert-missing,
leave-existing) — idempotent, so re-running it after editing pack content only inserts what's new.
Skipping this step doesn't break anything structurally (schema is already correct after `migrate`),
but the game ships with **zero official packs** until it's run — worth checking on any fresh
deploy. Same `build`-stage image as `migrate` (not the slim `api` runtime image), since both need
the source `scripts/`/`seed/` tree the runtime image deliberately doesn't ship.

## Weekly jobs

Neither job below has actual cron/CI scheduling infra wired up yet — this section documents
the intent and the manual command so a future phase can wire the schedule (GitHub Actions
`schedule:` trigger, or a `deploy/` cron container) without re-deriving what should run.

### Player totals reconciliation (phase 10)

**What it checks**: `players.total_points` / `games_played` / `games_won` (data-model.md §1 —
denormalized, bumped transactionally by `rooms/persist-game.ts` at the end of every finished
game) against a fresh `SUM(game_players)` computed independently. The two should always agree;
if they don't, the denormalization drifted from its source of truth somewhere (a
`persist-game.ts` bug, a hand-edited row, a partial migration).

**Script**: `apps/api/scripts/reconcile-totals.ts` (`findDrift()` is the reusable entry point;
`apps/api/scripts/reconcile-totals.test.ts` covers it in isolation).

**Run it**:

```sh
cd apps/api
DATABASE_URL=postgres://sketchy:sketchy@localhost:5432/sketchy pnpm db:reconcile
```

**Reading the output**:

- `Reconciliation OK — N player(s) checked, zero drift.` — exit code `0`. Nothing to do.
- `Reconciliation FAILED — M of N player(s) drifted:` followed by one line per drifted player
  (`denormalized` vs `actual` for all three columns) — exit code `1`. This is what a weekly
  CI job should alert on.

**On drift**: don't auto-heal in the script (a silent auto-fix would hide the underlying bug
that caused it). Instead:

1. Pull up the drifted player's `game_players` rows and recent `games` rows and manually
   trace which finished game(s) the `SUM` disagrees with the denormalized value for.
2. Check `rooms/persist-game.ts` logs (structured, one line per persisted game — conventions.md
   §1) around the suspected game's `endedAt` for anything unusual (a retried `persistGame`
   effect, a crash mid-transaction that somehow still landed a partial write, etc.) —
   `persistFinishedGame`'s `WHERE ended_at IS NULL` guard is supposed to make double-persists a
   no-op, so drift usually means that invariant broke, not that scoring math is wrong.
3. Once the cause is understood, a one-off corrective `UPDATE players SET ... WHERE id = ...`
   bringing the denormalized columns back in line with the `actual` values from the script's
   output is the safe manual fix — never edit `game_players` retroactively to match a
   (possibly also wrong) denormalized total; `game_players` is the source of truth.

**Weekly CI wiring (not yet built)**: a scheduled job that runs the command above against
production and fails/pages on a non-zero exit code. Natural home: a GitHub Actions workflow on
a `schedule:` cron trigger, reusing the same `DATABASE_URL` secret the deploy workflow already
has.

### Abandoned-game summary cleanup (documented in data-model.md §1, not yet implemented)

`games.summary` for abandoned games (`winner_faction IS NULL`, `ended_at` more than 48h in the
past) should be nulled out by a weekly cleanup job — noted here so it lands in the same place
once a later phase implements it. Not part of phase 10's scope.

## Voice (LiveKit) — WIRED, provisioning + secrets required

**Status: baked into the stack, off until provisioned.** The voice SFU is now part of the
production stack: the `livekit` service in `deploy/compose.prod.yml` (behind the `voice` compose profile), its config in `deploy/livekit.yaml`, and its env vars in `deploy/.env.prod.example`. What's left is pure ops —
DNS, firewall, one cert, real secrets — plus starting the stack with `--profile voice`.
Nothing here runs on a plain `up -d`, and the app stays inert until `VOICE_ENABLED=true`, so
this is safe to merge and deploy before voice is switched on. The app layer (token minting,
socket gate, web client) shipped in phase 15 and was load-tested locally (8 rooms × 8 audio
participants, 0 connection failures) via `deploy/compose.dev.yml`. The production shape
follows system-design.md §8 (self-hosted LiveKit, audio-only, same VPS) and §9's deploy table.

### Turn-it-on checklist

1. Fill the **Voice (LiveKit)** block in `deploy/.env.prod`: `VOICE_ENABLED=true`, the real
   `VOICE_DOMAIN`, `LIVEKIT_URL` / `NEXT_PUBLIC_LIVEKIT_URL` both `wss://<voice-domain>`, a
   strong `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (never the dev pair), and `VPS_PUBLIC_IP`.
2. Set `domain:` in `deploy/livekit.yaml` to that same voice host.
3. Do the DNS (§1), firewall (§3), and — for the TURN-over-TLS route — the cert (§4).
4. Rebuild `web` if you set `NEXT_PUBLIC_LIVEKIT_URL` (baked in at build time), then start voice:
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile voice up -d`.
5. Kill-switch anytime with `VOICE_ENABLED=false` (§6) — no infra change.

### 1. DNS — `voice.<domain>`, DNS-only (grey cloud), never proxied

Cloudflare's proxy only speaks HTTP(S)/WS over TCP — it cannot forward the UDP media LiveKit
actually needs (WebRTC RTP/RTCP), and even the WSS control-plane connection should ride the
SAME unproxied path as the media so a client's signaling and media are never asymmetrically
routed through different edges. Concretely:

- Create an A/AAAA record for `voice.sketchy.example` → the VPS's public IP.
- **Turn the Cloudflare proxy OFF for this one record** ("DNS only" / grey cloud icon in the
  dashboard) — `app.sketchy.example` and `api.sketchy.example` stay orange-clouded
  (system-design.md §9); `voice.` is the one deliberate exception.
- Because the proxy is off, Cloudflare's "Full (strict)" origin-cert trick (§9's existing TLS
  story for `app`/`api`) does not apply here — `voice.` needs its own **publicly-trusted**
  certificate (below), not a Cloudflare origin cert (browsers would reject that cert directly,
  with no Cloudflare edge to have already validated it).

### 2. TLS / Cloudflare tunnel route

Route the voice domain to `livekit:7880` in your Cloudflare tunnel configuration. Only the WSS/HTTPS control-plane rides through the tunnel — the UDP RTC + TURN media is
its own DTLS-SRTP transport straight to the VPS and is deliberately NOT proxied.

### 3. Firewall — what actually has to be open, and why

**Port numbers below are deliberately NOT LiveKit's stock defaults** (`7881` /
`50000–60000` / `3478` / `5349`) — those exact numbers are what every LiveKit tutorial ships,
making them the first thing already bound on a shared/pre-used VPS and the first thing a port
scanner tries. `deploy/livekit.yaml` and `deploy/compose.prod.yml` use the renumbered set below
instead; if any of them still collide on your specific box, change the number in BOTH files
together, keeping host:container numerically identical (LiveKit advertises the container-side
port directly to the client, so a Docker-side-only remap breaks silently).

| Port(s)                | Proto   | Purpose                                                                 | Notes |
| ----------------------- | ------- | ------------------------------------------------------------------------ | ----- |
| 443                     | TCP     | `voice.sketchy.example` WSS/HTTPS control-plane, via Cloudflare tunnel (above)       | Same port every other hostname uses — nothing new to open. |
| 31881                    | TCP     | ICE/TCP fallback (`rtc.tcp_port`)                     | For clients whose network blocks UDP outright (hotel/corporate wifi) — bypasses the tunnel, dials the VPS directly. |
| 32000–32999 (shipped) | UDP     | ICE/UDP media (`rtc.port_range_start/end`)             | **Matches `deploy/livekit.yaml` + the range published in compose — keep the two in sync if you resize.** ~1 UDP port per concurrent participant at peak: the phase-15 LOCAL load test saw a 20-port range fail at 64 participants (exactly half connected) while 100–200 handled 64 cleanly. 1000 ports covers the launch target (system-design.md §0: "low hundreds of concurrent connected players") with wide headroom, without the startup/iptables cost of publishing LiveKit's full 10 000-port default under Docker. |
| 33478 / 33349             | UDP/TCP | Embedded TURN (below) — only if enabled                                 | |

### 4. Embedded TURN — UDP is on; TURN-over-TLS is the last step

`deploy/livekit.yaml` already enables the embedded TURN server on **UDP 33478** (backup route #2
for symmetric NATs / firewalls that block direct + TCP-fallback ICE) — no cert required, live as
soon as voice starts. The reach-maximizing piece, **TURN-over-TLS on 33349**, is the one remaining
decision: it needs a publicly-trusted cert for the DNS-only voice host (a Cloudflare origin cert
will NOT work here). TCP 33349 is already published by compose. To finish it:

- Get a public cert + key for `VOICE_DOMAIN` and place them at `deploy/certs/voice.pem` +
  `deploy/certs/voice-key.pem` (mounted read-only into the livekit container at
  `/etc/livekit/certs`). Ways to source it: a dedicated ACME client (certbot) for that host; or
  export the cert from Cloudflare or another ACME source, or set
  LiveKit's `external_tls` and terminate TURN-TLS at a fronting proxy.
- Uncomment the `tls_port` / `cert_file` / `key_file` lines in `deploy/livekit.yaml`, then restart
  the livekit service.

Making TURN-TLS share port 443 (so it's indistinguishable from ordinary HTTPS to the
most restrictive firewalls — the trick every major WebRTC provider uses) needs ALPN/SNI
routing; pin that once the cert is settled. UDP TURN plus the 33349 listener
already cover the large majority of locked-down networks.

### 5. The `livekit` service — already in compose.prod.yml (behind the `voice` profile)

No file surgery needed: the service is in `deploy/compose.prod.yml` under `profiles: ['voice']`,
so it only starts when you pass `--profile voice`. It mounts `deploy/livekit.yaml` for config and
`deploy/certs` (read-only, for the TURN-TLS cert), takes its real key/secret via `LIVEKIT_KEYS`
(from `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, so no secret is committed), publishes 31881/TCP +
the 32000–32999/UDP media range + 33478/UDP (TURN) + 33349/TCP (TURN-TLS) — all deliberately
renumbered off LiveKit's stock defaults, see §3 — and deliberately does NOT publish 7880 (Cloudflare tunnel
reaches it over the compose network). The one line that matters most:

`--node-ip=${VPS_PUBLIC_IP}` (rather than the dev config's `127.0.0.1`) is what makes LiveKit
advertise ICE candidates a REMOTE browser can actually dial — this is the one line that
differs in kind (not just value) from `deploy/compose.dev.yml`, and getting it wrong is the
single most common self-hosted-LiveKit failure mode (candidates advertise an address only
reachable from inside the VPS itself, so every connection times out from the outside while
looking completely healthy from a shell on the box).

### 6. Soft cap & kill-switch (operational, not infra)

`VOICE_ENABLED=false` (`.env.example`, `apps/api/src/env.ts`) turns voice off cluster-wide with
zero infra changes — the game is entirely unaffected either way. Pair it with a documented soft
cap on rooms-with-voice once real usage data exists; the phase-15 local load test is a starting
estimate, not a launch-day guarantee.

## Email (phase 16) — NOT DEPLOYED — for phase 9 to wire up

**Status: code shipped, sending deferred.** The transactional-email path for magic-link account
linking (system-design.md §6) is fully built and tested: `apps/api/src/accounts/email-provider.ts`
implements a tiny `EmailProvider` interface with three implementations selected by
`EMAIL_PROVIDER` — `'log'` (the credential-free dev default), `'resend'`, and `'postmark'` — and
`getEmailProvider()` is called from the magic-link request path in
`apps/api/src/routes/accounts.ts` (`POST /auth/link/request`, the `sendMagicLink(...)` call around
line 75). What has **not** happened is any real provider provisioning: no sending domain is verified,
no DNS record exists, and there are no provider credentials in this environment — so with
`EMAIL_API_KEY` unset the two real providers **throw a clear, labeled error** rather than pretend to
send (`email-provider.ts` lines 91–95), and the whole stack runs on the `'log'` provider, which
writes the link to the API log + an in-process dev sink instead of emailing it. Everything below is
what phase 9 must do to flip a single environment to a real provider. Unlike the Voice section
above, email needs **no new container, port, or firewall change** — it's an outbound HTTPS `POST`
from the existing `api` service, so the work is entirely DNS + a provider account + three env vars.

### 1. Sending subdomain — `mail.<domain>`, dedicated to transactional mail

Send from a dedicated subdomain (e.g. `mail.sketchy.example`), not the root domain. A subdomain
isolates the sending reputation of automated magic-link mail from anything the root domain is used
for (human mail, the marketing site), so a deliverability problem on one never drags down the other,
and it keeps the DMARC alignment story (below) simple. Concretely this means the `From` address
should live on that subdomain — `no-reply@mail.sketchy.example` — and every DNS record below is
published on `mail.sketchy.example`, not the apex. The code sends as whatever `EMAIL_FROM` is set to
(§4); the current `.env.example` default (`Sketchy <no-reply@sketchy.example>`) is a dev placeholder
on the apex — phase 9 must point it at the verified sending subdomain so the `From` domain matches
the domain the provider signs (DKIM alignment, §2).

### 2. DNS — SPF / DKIM / DMARC on the sending subdomain

Three record families make provider-sent mail authenticate as genuinely from us; publish them on the
sending subdomain before verifying the domain at the provider (§3), because the provider's
verification step checks exactly these:

- **SPF** — a `TXT` on `mail.sketchy.example` authorizing the provider's sending infrastructure via
  the `include:` value the provider's domain-setup screen gives you (each provider publishes its own
  `include:` host). Keep it to the single provider `include` plus `-all`; SPF has a hard 10-DNS-lookup
  limit, so don't accumulate stale includes.
- **DKIM** — the provider generates a signing key and gives you the exact record(s) to publish
  (typically one or more `CNAME`s under a provider-chosen selector, e.g. a `._domainkey` host).
  Publish them verbatim from the dashboard — the selector and target are provider-specific, so copy
  them rather than hand-authoring. DKIM is what actually cryptographically signs each message, and
  its signing domain must line up with the `From` domain for DMARC alignment.
- **DMARC** — a `TXT` at `_dmarc.mail.sketchy.example` telling receivers what to do with mail that
  fails SPF/DKIM alignment, plus where to send aggregate reports. **Roll it out in stages, never
  jump straight to enforcement:** start at `p=none` (monitor-only — collect `rua=` aggregate reports
  and confirm real magic-link mail is passing before you can break anything), then tighten to
  `p=quarantine`, then to `p=reject` once the reports show clean alignment. A too-early `p=reject`
  silently bins legitimate link emails.

```
# DNS on mail.sketchy.example (phase 9) — SPF/DKIM values come from the provider dashboard;
# only DMARC is fully ours to author. Ramp p=none → quarantine → reject over successive weeks.
mail.sketchy.example.           TXT   "v=spf1 include:<provider-spf-host> -all"
<selector>._domainkey.mail...   CNAME <provider-supplied DKIM target>   ; copy verbatim from provider
_dmarc.mail.sketchy.example.    TXT   "v=DMARC1; p=none; rua=mailto:dmarc@sketchy.example; fo=1"
```

### 3. Provider setup — Resend or Postmark (the two the code supports)

The code speaks to exactly two real providers, each a single `POST`; pick one, and its choice is
purely which `EMAIL_PROVIDER` value and credential you set (§4) — nothing else in the code changes.

| Provider | Send endpoint (`email-provider.ts`) | Auth header | Credential to issue |
| -------- | ----------------------------------- | ----------- | ------------------- |
| Resend   | `POST https://api.resend.com/emails` | `Authorization: Bearer <key>` | An API key from the Resend dashboard |
| Postmark | `POST https://api.postmarkapp.com/email` (stream `outbound`) | `X-Postmark-Server-Token: <token>` | A Server Token for a Postmark server |

For whichever you pick: create the account, add `mail.sketchy.example` as a sending domain, publish
the SPF/DKIM records it generates (§2), and wait for the dashboard to report the domain **verified**
before issuing the API key / server token — an unverified domain sends nothing (or lands in spam).
Store the resulting secret as `EMAIL_API_KEY` (§4). Note both providers are strictly outbound HTTP
here — the code has no inbound webhook receiver of any kind yet; see §5.

### 4. Env wiring — `EMAIL_PROVIDER` / `EMAIL_FROM` / `EMAIL_API_KEY`

Three variables on the `api` service (`.env.example`, parsed in `apps/api/src/env.ts`;
conventions.md §4) carry the entire switch from dev-log to real sending:

| Var | Dev default | Production value |
| --- | ----------- | ---------------- |
| `EMAIL_PROVIDER` | `log` | `resend` or `postmark` — anything unrecognized falls back to `log` (`env.ts` `parseEmailProvider`) |
| `EMAIL_FROM` | `Sketchy <no-reply@sketchy.example>` | `Sketchy <no-reply@mail.sketchy.example>` — the verified sending subdomain (§1) |
| `EMAIL_API_KEY` | *(empty)* | the provider secret from §3 |

The one non-obvious safety property to preserve: setting `EMAIL_PROVIDER=resend` (or `postmark`)
**without** a matching `EMAIL_API_KEY` is not a silent no-op — the sender throws immediately
(`email-provider.ts` lines 91–95, `"EMAIL_PROVIDER=<kind> but EMAIL_API_KEY is unset"`), and the
request path surfaces that as a `500` (`routes/accounts.ts` lines 76–82) rather than returning `ok`
to a user whose link was never sent. So `EMAIL_PROVIDER` and `EMAIL_API_KEY` must be flipped
**together** — a real provider with no key is a hard failure by design, not a degraded mode. Set both
in a staging environment first, use the guarded dev-inbox / real inbox to confirm a link actually
arrives end-to-end, then promote the same pair to production.

### 5. Bounces & complaints — webhook + suppression list (net-new work)

Nothing in the shipped code consumes provider webhooks or keeps a suppression list — the send path
is fire-and-forget past the HTTP response. That's fine for launch volume but will burn sending
reputation over time: repeatedly emailing a hard-bounced (nonexistent) address, or one that hit
"spam", is exactly what gets a sending domain throttled or blocklisted. Phase 9 (or a fast follow)
should therefore add:

1. **A webhook receiver** — a small authenticated `api` route the provider `POST`s delivery events
   to (both Resend and Postmark emit hard-bounce and spam-complaint webhooks). Verify the provider's
   signature so the endpoint can't be spoofed.
2. **A suppression list** — persist every hard-bounced / complained address (a table keyed on the
   citext email, alongside the existing `players.email`), and consult it in the request path
   (`routes/accounts.ts`, before the `sendMagicLink` call) to skip sending to a suppressed address.
   Because that path is already enumeration-safe (it returns the identical `ok` whether or not a link
   was minted — `LINK_REQUEST_OK`), skipping a suppressed address stays invisible to callers, so no
   new enumeration signal is introduced.

Document this as a requirement here rather than a finished recipe — the exact webhook signature
scheme and table shape are a phase-9 decision once the provider is chosen.

### 6. Kill-switch — `EMAIL_PROVIDER=log` (operational, not infra)

There's no separate on/off flag: the `'log'` provider **is** the kill-switch. Setting
`EMAIL_PROVIDER=log` (or any unrecognized value — `env.ts` coerces the unknown to `'log'`) turns
real sending off cluster-wide with zero infra changes; the linking flow still fully works, it just
writes the magic link to the API log + dev sink instead of emailing it (`email-provider.ts`
`LogEmailProvider`). Use it to disable email instantly if a provider outage or a deliverability
incident makes real sends worse than none. Two operational cautions: (a) the guarded dev-inbox
endpoint (`GET /auth/link/dev-inbox`, `routes/accounts.ts`) that exposes those logged links is
registered **only** when `EMAIL_PROVIDER=log` **and** `NODE_ENV !== 'production'`, so falling back to
`log` in production disables sending but does *not* expose link tokens; and (b) under `log`, users
never receive a link by email — it's a safe-off for incidents, not a steady state for a real
deployment.

## Google Sign-In (phase 18) — NOT DEPLOYED — for phase 9 to wire up

**Status: code shipped, DORMANT by design.** "Sign in with Google" is a fully-built, additional
account-link method alongside the email magic link (`POST /v1/auth/google` in
`apps/api/src/routes/accounts.ts`; the `GoogleSignInButton` in
`apps/web/src/components/account/`). It links the caller's guest identity using the
Google-verified email — the SAME `players.email` linked identity the magic link sets, so there is
no separate identity store and account deletion already scrubs it. **It ships OFF and changes
nothing for users until an operator provisions a Google client ID and flips the flag:** with the
feature off, the API endpoint returns a clean `not_found` (never a 500), and the web renders no
button and never loads the Google Identity Services script (so no Google cookies). Like the Email
section above — and unlike Voice — this needs **no new container, port, or firewall change**: token
verification is an outbound cert fetch from the existing `api` service, and the browser button is
GIS's own hosted script. What has **not** happened is the Google Cloud provisioning below; **the
owner must create the Cloud project + OAuth client ID before the feature can be enabled or tested
end-to-end** (there is no Google project in this environment, so the flow is not exercisable today —
the shipped tests mock Google's verification).

### 1. Google Cloud project + OAuth consent screen

Create (or reuse) a Google Cloud project, then configure its **OAuth consent screen**:

- User type **External**, published (not just "Testing") before a public launch, or only
  allow-listed test accounts can sign in.
- App name, support email, and the app logo/domain.
- **The user-data disclosure** must match what the privacy page already promises (the "Sign in with
  Google" section of `/privacy`, `apps/web/src/copy.ts`): we receive only the user's verified email,
  used solely to create/link their account, never sold or shared. Point the consent screen's privacy
  policy link at `https://<web-domain>/privacy` and its terms link at `/terms`.
- Scopes: only the basic `openid` / `email` (and `profile` if the button ever shows a name/photo) —
  the code needs just the **verified email**, so do not request anything broader.

### 2. OAuth 2.0 Client ID (Web application) + authorized JavaScript origins

Under **Credentials → Create credentials → OAuth client ID**, type **Web application**:

- **Authorized JavaScript origins** — the web app's exact origin(s), scheme + host + (non-default)
  port, no path: e.g. `https://app.sketchy.example` (add `http://localhost:3000` for local testing).
  GIS is browser-side and validates the origin, so a missing/incorrect origin is the most common
  "nothing happens when I click the button" failure. No redirect URI is needed — the GIS credential
  flow returns the ID token to the page via callback, it does not do a server redirect.
- The resulting **Client ID** (looks like `<number>-<hash>.apps.googleusercontent.com`) is **not a
  secret** — it's designed to be exposed in the browser bundle. There is no client *secret* to
  manage for this flow (GIS ID-token sign-in uses only the client ID).

### 3. Env wiring — the SAME client ID in two vars, then flip the flag

The one client ID from §2 is set as BOTH an api var and a web var (`.env.example`, parsed in
`apps/api/src/env.ts`; the web one is inlined by Next at build time):

| Var | Service | Dev default | Production value |
| --- | ------- | ----------- | ---------------- |
| `GOOGLE_CLIENT_ID` | api | *(empty — feature unconfigured)* | the §2 client ID (the audience the server verifies ID tokens against) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | web | *(empty — no button, GIS never loads)* | the SAME §2 client ID (public by design) |
| `GOOGLE_SIGNIN_ENABLED` | api | `false` (dormant) | `true` to turn the endpoint on |

Safety property to preserve (enforced in `apps/api/src/startup-guards.ts`): setting
`GOOGLE_SIGNIN_ENABLED=true` **without** a `GOOGLE_CLIENT_ID` is a **fail-fast startup error** in
production, not a degraded mode — the flag and the api client ID must be flipped **together**. The
web button is gated independently on `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, so set all three when enabling:
`GOOGLE_CLIENT_ID` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value) + `GOOGLE_SIGNIN_ENABLED=true`.
Turn it on in a staging environment first and link a real account end-to-end (a guest → Google →
`is_guest=false`, scrapbook preserved) before promoting the same trio to production.

### 4. Kill-switch — `GOOGLE_SIGNIN_ENABLED=false` (operational, not infra)

Setting `GOOGLE_SIGNIN_ENABLED=false` (api) turns the endpoint off cluster-wide with zero infra
changes — it reverts to the clean `not_found`. To ALSO remove the button (and stop loading Google's
script) unset `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the web env and redeploy the web app. The email
magic link is unaffected either way — it's the always-available link method, and Google is purely
additive on top of it.
