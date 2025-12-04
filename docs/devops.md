# DevOps Handoff

**This is the launch deployment.** Every item below — core stack, uploads, error tracking,
real email, Google Sign-In, and voice — ships together at launch. None of it is a later phase;
treat the whole page as one checklist to clear before go-live.

One page: what's already built, what you (devops) need to go get, and the order to do it in.
Written for the person standing up the production VPS — not a contributor guide.

**All application code is done and tested.** Nothing below is "finish building X" — it's
"go create an account / DNS record / cert for X, then paste the resulting value into
`deploy/.env.prod`." Each feature is gated by an env flag that defaults to off in the code, but
for this launch every flag gets flipped ON as part of the deploy — the flags exist as an
**incident rollback lever** (kill a misbehaving feature instantly without a redeploy), not as a
"ship it later" option. Sections are ordered by how long their provisioning takes (DNS
propagation and domain/email verification are the slow ones — start those first), not by
priority.

For the full explanation of any single variable: [ENV_GUIDE.md](ENV_GUIDE.md). For the deep,
step-by-step provisioning story behind voice/email/Google: [`deploy/RUNBOOK.md`](../deploy/RUNBOOK.md).
This doc is the index and checklist that ties them together.

---

## 0. What you need accounts/access for

| # | Provider | For |
|---|---|---|
| 1 | A VPS (any provider) with a public IPv4 | Hosting the whole stack |
| 2 | Cloudflare, with your domain's nameservers pointed at it | DNS + TLS for app/api |
| 3 | Cloudflare R2 | Avatar / pack-cover image uploads |
| 4 | Sentry (free tier is fine) | Error tracking |
| 5 | Resend **or** Postmark | Real magic-link emails |
| 6 | Google Cloud | "Sign in with Google" button |
| — | *(none — LiveKit is self-hosted)* | Voice chat in rooms |

All seven rows are required for this launch. Each gets its own section below: provision it,
fill in its env vars, verify it actually works — not just that a call returned 200.

---

## 1. Core stack

**Provision:**
- A VPS with Docker + Docker Compose installed, a public IP, ports `80` and `443` open.
- In Cloudflare: add the domain, create `A` records for your app and API subdomains (e.g.
  `app.sketchy.example`, `api.sketchy.example`), **proxy ON** (orange cloud) for both.
- Cloudflare dashboard → SSL/TLS → Origin Server → **Create Certificate** (RSA, covers
  `*.<domain>` + `<domain>`). Save the two PEM blocks as `deploy/certs/origin.pem` and
  `deploy/certs/origin-key.pem` on the VPS (gitignored — never commit them).
- Set SSL/TLS mode to **Full (strict)** in Cloudflare for this domain.

**Fill in `deploy/.env.prod`** (copy from `deploy/.env.prod.example`):
`APP_DOMAIN`, `API_DOMAIN`, `POSTGRES_PASSWORD`, `DATABASE_URL` (must reuse the same password),
`JWT_SECRET` (`openssl rand -hex 32`), `CORS_ORIGINS`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL`,
`ADMIN_TOKEN` (`openssl rand -hex 32`), `LOG_LEVEL`.

**Deploy:**
```sh
cp deploy/.env.prod.example deploy/.env.prod   # fill in the real values above
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod build
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile migrate run --rm migrate
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d
```
Run the `migrate` step again after any future deploy that adds a database migration.

**Verify:** `https://<API_DOMAIN>/v1/health` returns OK; the web app loads at `https://<APP_DOMAIN>`.

---

## 2. R2 — image uploads (avatars, pack covers)

**Provision** (Cloudflare dashboard → R2):
1. Create a bucket.
2. Create an API token (S3-compatible access key + secret).
3. **Set a CORS policy on the bucket itself** allowing `PUT` from `https://<APP_DOMAIN>` — this
   is separate from the API keys and easy to miss. Without it, uploads fail silently in the
   browser even though everything else is configured correctly.
4. Add a custom domain (or use the `r2.dev` subdomain) for public read access.

**Fill in:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_PUBLIC_BASE_URL`.

**Verify:** upload an avatar in the app; confirm the image actually loads back (not just that
the upload call returns 200 — that only proves the presign step worked).

---

## 3. Sentry — error tracking

**Provision:** create a Sentry project, copy the DSN.

**Fill in:** `SENTRY_DSN`. Used by both `api` and `web` — the web one is baked in at **build
time**, so set it before the first prod build, or rebuild `web` after adding it.

---

## 4. Email — real magic-link delivery (Resend or Postmark)

Right now every sign-in email is written to a log, not sent — that has to be live before
launch, since email is the primary sign-in method. Full detail: `deploy/RUNBOOK.md` → **Email**.

**Provision, in this order (each step depends on the last):**
1. Pick Resend or Postmark; create an account.
2. Add a **dedicated sending subdomain** — e.g. `mail.<domain>`, not the root domain.
3. Publish the SPF / DKIM / DMARC DNS records the provider's dashboard gives you, on that
   subdomain. Start DMARC at `p=none` (monitor-only), tighten later.
4. Wait for the provider dashboard to report the domain **verified**. Skipping this step doesn't
   error — it just means real emails bounce or land in spam, silently.
5. Issue an API key / server token.

**Fill in:** `EMAIL_PROVIDER` (`resend` or `postmark`), `EMAIL_FROM` (must be an address on the
now-verified subdomain, e.g. `Sketchy <no-reply@mail.<domain>>`), `EMAIL_API_KEY`.

**Verify:** request a magic link with a real inbox you control and confirm it lands (not spam).
Setting `EMAIL_PROVIDER` to a real value **without** a matching `EMAIL_API_KEY` is a hard
failure by design (the request returns a 500), not a silent no-op — so a broken config is loud.

**If it breaks after launch:** `EMAIL_PROVIDER=log` instantly kills real sending with zero infra
changes — an incident lever, not a launch option. Sign-in still works either way (the link just
stops emailing), so this is the button to hit if the provider has an outage mid-launch.

---

## 5. Google Sign-In — additional sign-in method

Ships alongside email at launch, not after it. Full detail: `deploy/RUNBOOK.md` → **Google
Sign-In**.

**Provision:**
1. Google Cloud project → OAuth consent screen: type **External**, published (not "Testing"),
   scopes limited to `openid`/`email`. Point its privacy-policy link at
   `https://<APP_DOMAIN>/privacy`.
2. Credentials → Create OAuth client ID → **Web application**. **Authorized JavaScript
   origins**: the exact `https://<APP_DOMAIN>` (scheme + host, no path). This is the #1
   "button does nothing" failure if it's missing or wrong.

**Fill in (all three together — the app fail-fasts in prod if the flag is on with no client ID):**
`GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value, both api and web),
`GOOGLE_SIGNIN_ENABLED=true`.

**Note:** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is baked into the web image at **build time** — you
must rebuild `web` after setting it, a container restart alone won't pick it up.

**Verify:** click the Google button on a real device, confirm a fresh sign-up and (separately)
signing back in on a second guest session both land you in the right account.

**Rollback:** `GOOGLE_SIGNIN_ENABLED=false` — endpoint returns a clean 404, button disappears
after a web rebuild.

---

## 6. Voice — self-hosted LiveKit, audio-only

Ships live at launch. The one feature needing real infrastructure, not just an account — no
LiveKit dashboard exists, it's your own container. Full detail: `deploy/RUNBOOK.md` → **Voice**.

**Provision:**
1. **DNS:** create an A/AAAA record for `voice.<domain>` → the VPS's public IP. **Turn the
   Cloudflare proxy OFF for this one record** (grey cloud / "DNS only") — unlike `app`/`api`,
   this one must NOT be proxied, since Cloudflare can't forward the UDP media traffic.
2. **Firewall** (open on the VPS): `31881/tcp` (ICE/TCP fallback), `32000-32999/udp` (media —
   resize in both `deploy/livekit.yaml` and `compose.prod.yml` if you expect very high
   concurrency), `33478/udp` (embedded TURN). `443/tcp` is already open from step 1. These are
   **not** LiveKit's stock port numbers (`7881` / `50000-60000` / `3478`) — deliberately
   renumbered so voice doesn't collide with whatever else might already be bound on the box, or
   sit on the ports a scanner tries first. If one of these still collides on your specific VPS,
   change it in both `deploy/livekit.yaml` and `deploy/compose.prod.yml` together (same number
   on both sides — LiveKit tells clients to dial its own container-side port number directly, so
   a Docker-only remap silently breaks the connection).
3. Edit `deploy/livekit.yaml`: set `domain:` to the real `voice.<domain>` (LiveKit doesn't
   expand env vars in this file — edit it directly).
4. Generate a real key/secret pair (`openssl rand -hex 32` for the secret) — **never reuse the
   `devkey`/`devsecret-...` values**, those are dev-only and are not a secret to anyone who's
   read this repo.

**Fill in:** `VOICE_ENABLED=true`, `VOICE_DOMAIN`, `LIVEKIT_URL` and `NEXT_PUBLIC_LIVEKIT_URL`
(both `wss://<VOICE_DOMAIN>`), `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, `VPS_PUBLIC_IP` (the
address LiveKit advertises for WebRTC — **the single most common self-host failure is getting
this wrong**: it must be the box's real public IP, not `127.0.0.1` or a private/internal IP).

**Rebuild `web`** (bakes in `NEXT_PUBLIC_LIVEKIT_URL`), then start voice specifically:
```sh
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile voice up -d
```
Voice is **not** part of a plain `up -d` — it only starts with `--profile voice`, so it's safe
to leave unconfigured indefinitely without risking the rest of the stack.

**Optional hardening — TURN over TLS (port 33349):** UDP TURN (33478) is already active with no
cert needed and covers most locked-down networks. TLS on 33349 covers the remainder (firewalls
that only allow outbound 443) but needs a **publicly-trusted certificate** for `voice.<domain>`
— a Cloudflare origin cert will NOT work here since this host isn't proxied. Get one (certbot,
or export the cert Caddy already provisions for this host), place it at
`deploy/certs/voice.pem` + `deploy/certs/voice-key.pem`, then uncomment the `tls_port` /
`cert_file` / `key_file` lines in `deploy/livekit.yaml` and restart the `livekit` service.

**Verify:** two devices in the same room both enable voice and can hear each other — ideally
one of them on a phone's cellular network, not just both on the same office wifi, to actually
exercise the UDP/TURN paths instead of a lucky direct connection.

**Rollback:** `VOICE_ENABLED=false` kills it instantly, no infra change — the game is unaffected
either way, voice is cosmetic to it.

---

## 7. Go-live checklist

- [ ] Core stack up, `/v1/health` OK, web app loads over HTTPS
- [ ] R2: bucket + CORS set, an avatar upload round-trips
- [ ] Sentry: DSN set (optional but cheap to just do)
- [ ] Email: sending domain verified, a real link lands in a real inbox
- [ ] Google: client ID + origins set, button works for both new and returning users
- [ ] Voice: DNS grey-clouded, firewall open, two real devices hear each other
- [ ] `deploy/.env.prod` is **not** committed anywhere (it's gitignored — double-check before
      any `git add -A`)
- [ ] `deploy/certs/*.pem` are on the VPS only, never in the repo
