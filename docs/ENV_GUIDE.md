# .env Setup Guide

Copy-paste this guide next to your `.env` file while filling it in.

---

## 🔐 CRITICAL — Must set in production

| Variable | Where to get it | What it does |
|---|---|---|
| `JWT_SECRET` | Generate a random 32+ character string (or use `openssl rand -base64 32`) | Secret key that signs login tokens. Keep it secret in prod. |
| `ADMIN_TOKEN` | Generate a random 32+ character string | Password for the admin page (`/v1/admin/reports`). Must set or server won't start in prod. |

---

## 📦 Data stores (localhost dev defaults provided)

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `DATABASE_URL` | `postgres://sketchy:sketchy@localhost:5432/sketchy` | Your PostgreSQL connection string (change only for prod) | Where games, players, reports live. |
| `REDIS_URL` | `redis://localhost:6379` | Your Redis connection string (change only for prod) | Live room state, presence, rate limits. |

---

## 🔑 Auth

| Variable | Where to get it | What it does | Required? |
|---|---|---|---|
| `JWT_SECRET_PREVIOUS` | Generate a random 32+ char string (same process as JWT_SECRET) | Old secret during key rotation. Leave blank if not rotating. | No |

---

## 🌐 Networking / CORS (localhost dev defaults provided)

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated list of allowed origins (change for prod) | What websites can call the API. |
| `PUBLIC_WEB_URL` | `http://localhost:3000` | Your public web URL (e.g., `https://sketchy.example`) | Used in emails, invite links, CORS. |
| `PUBLIC_API_URL` | `http://localhost:4000` | Your public API URL (e.g., `https://api.sketchy.example`) | Web client connects to this API URL. |
| `PORT` | `4000` | Leave as-is unless you need a different port | What port the API server listens on. |
| `NEXT_PUBLIC_GITHUB_URL` | Empty (omits the link) | URL to your GitHub repo, if public | Marketing footer link to your repo. Leave blank if private repo. |

---

## ☁️ Cloudflare R2 (file uploads, backups)

**Skip this for MVP launch.** If you want user avatar uploads later:

| Variable | Where to get it | What it does |
|---|---|---|
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 → Account ID | R2 account identifier. |
| `R2_ACCESS_KEY_ID` | Cloudflare dashboard → R2 → API tokens → Create token | S3-compatible access key. |
| `R2_SECRET_ACCESS_KEY` | Cloudflare dashboard → R2 → API tokens → Create token | S3-compatible secret key. |
| `R2_BUCKET` | Name the bucket in Cloudflare (e.g., `sketchy-dev`) | Bucket name where files live. |
| `R2_PUBLIC_BASE_URL` | Cloudflare → R2 → Custom domain (e.g., `https://cdn.sketchy.example`) | Public URL where uploaded files are served from. |

**Gotcha:** correct keys ≠ working uploads. The bucket itself needs a **CORS policy** (Cloudflare
dashboard → your bucket → Settings → CORS Policy) allowing `PUT` from your app's real origin
(`https://sketchy.example`). Without it, uploads fail silently in the browser with a CORS error —
the API-side presign step succeeds either way, so this is easy to miss until someone tries to
actually upload an avatar or pack cover in production.

---

## 📊 Observability / admin

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `LOG_LEVEL` | `info` | Leave as-is or set to `debug` for verbose logs | API log verbosity (trace, debug, info, warn, error, fatal, silent). |
| `SENTRY_DSN` | Empty (disables error tracking) | [sentry.io](https://sentry.io) → Create a project → Copy the DSN | Error tracking in prod. Leave empty for MVP. |

---

## 📧 Email (magic-link account linking)

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `EMAIL_PROVIDER` | `log` | Set to `resend`, `postmark`, or `log` | Which email service to use. `log` = print to terminal (dev only). |
| `EMAIL_FROM` | `Sketchy <no-reply@sketchy.example>` | Your sender address (e.g., `Sketchy <noreply@sketchy.io>`) | The "From:" address on magic-link emails. |
| `EMAIL_API_KEY` | Empty | [resend.com](https://resend.com) → API Keys (if using Resend) or [postmark.com](https://postmark.com) → API Keys | API key for the email service. Only required if `EMAIL_PROVIDER` is not `log`. |

**For Resend specifically:**
1. Sign up at [resend.com](https://resend.com)
2. Add a **sending subdomain** (e.g. `mail.sketchy.example`), not your root domain
3. **Publish the SPF/DKIM/DMARC DNS records Resend gives you and wait for "verified."** This is
   NOT optional — sending before the domain verifies means mail bounces or lands in spam, and the
   API call itself will still return success (it's a fire-and-forget POST). Full steps in the
   **Email** section of `deploy/RUNBOOK.md`.
4. Create an API key
5. Set `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY=re_xxxxx`, and `EMAIL_FROM` pointing at the
   verified subdomain (e.g. `Sketchy <no-reply@mail.sketchy.example>`)

---

## 🔓 Google Sign-In (optional, dormant by default)

**Skip for MVP.** To add "Sign in with Google" later:

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Empty | [Google Cloud Console](https://console.cloud.google.com) → Create OAuth 2.0 Client ID (Web) | OAuth client ID. Must match the one in Google Cloud. |
| `GOOGLE_SIGNIN_ENABLED` | `false` | Set to `true` when you're ready to turn on the feature | Feature flag — turn on only after setting `GOOGLE_CLIENT_ID`. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Empty | Same as `GOOGLE_CLIENT_ID` | Public client ID exposed to the web. (Not secret — it's the OAuth client ID.) |

**To enable Google Sign-In:**
1. Create a Google Cloud project
2. Set up OAuth 2.0 Client ID (Web) → Authorized origins: `http://localhost:3000` (dev) or `https://sketchy.example` (prod)
3. Copy the Client ID
4. Set all three variables above
5. See the **Google Sign-In** section of `deploy/RUNBOOK.md` for full setup

---

## ⚙️ Matchmaking tuning (optional — code defaults if empty)

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `MATCH_INTERVAL_MS` | `3000` | Leave empty or set to milliseconds | How often the matchmaker runs (default 3 seconds). |
| `MATCH_FORM_AFTER_MS` | `8000` | Leave empty or set to milliseconds | How long the oldest waiter waits before a below-target room forms (default 8 seconds). |
| `MATCH_STALE_MS` | `300000` | Leave empty or set to milliseconds | Drop stale queue entries older than this (default 5 minutes). |

---

## 💪 Resilience tuning (optional — spec defaults if empty)

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `GRACE_WINDOW_MS` | `90000` | Leave empty or set to milliseconds | Disconnect grace window before host migration (default 90 seconds). |
| `ABANDON_MS` | `600000` | Leave empty or set to milliseconds | Time to wait before reaping an all-disconnected room (default 10 minutes). |
| `ABANDON_SWEEP_MS` | `60000` | Leave empty or set to milliseconds | How often the abandon reaper scans rooms (default 60 seconds). |

---

## 🎤 Voice (self-hosted LiveKit SFU — localhost dev defaults provided)

**Not a hosted service** — LiveKit runs as your own container (`deploy/compose.prod.yml`'s
`livekit` service, behind the `voice` compose profile), so there's no dashboard to visit. You
generate the API key/secret yourself; they just have to match on both sides (the container's
`LIVEKIT_KEYS` env and the app's `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`).

| Variable | Default | Where to get it | What it does |
|---|---|---|---|
| `VOICE_ENABLED` | `true` (dev) / `false` (prod compose) | Set to `true` in `deploy/.env.prod` to turn it on | Kill-switch. Games work with or without voice. |
| `VOICE_DOMAIN` | *(prod only)* | The subdomain you point at your VPS, e.g. `voice.sketchy.example` | Which host Caddy routes to the LiveKit container. |
| `LIVEKIT_URL` | `ws://localhost:7880` (dev) | Prod: `wss://<VOICE_DOMAIN>` | WebSocket URL to the LiveKit server. |
| `NEXT_PUBLIC_LIVEKIT_URL` | `ws://localhost:7880` (dev) | Same value as `LIVEKIT_URL` | Public LiveKit URL exposed to the web. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `devkey` / `devsecret-...` (dev only) | **You generate these** — any random string pair. Prod: use `openssl rand -hex 32` for the secret. **Never reuse the dev pair.** | Signs/verifies voice tokens between the API and LiveKit. |
| `VPS_PUBLIC_IP` | *(prod only)* | Your VPS's public IPv4/IPv6 | The address LiveKit advertises for WebRTC media — wrong value is the #1 self-host voice failure. |

**To enable in production** (full detail in the **Voice** section of `deploy/RUNBOOK.md`):
1. DNS: `VOICE_DOMAIN` → an A/AAAA record pointed at the VPS, **proxy OFF** (grey-cloud/DNS-only —
   unlike the app/api subdomains, which stay proxied).
2. Open firewall ports: `31881/tcp`, `32000-32999/udp`, `33478/udp`, `33349/tcp` (443 is already
   open). These are deliberately NOT LiveKit's stock defaults (`7881`/`50000-60000`/`3478`/`5349`)
   — renumbered so voice doesn't collide with whatever's already bound on the box.
3. Set `domain:` in `deploy/livekit.yaml` to the real `VOICE_DOMAIN`.
4. Fill in all six vars above in `deploy/.env.prod`.
5. Rebuild `web` (bakes in `NEXT_PUBLIC_LIVEKIT_URL`), then start with the voice profile:
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile voice up -d`

---

## 🚀 Minimal launch checklist

✅ **For local dev:** Just set `JWT_SECRET` and `ADMIN_TOKEN` to any random strings. Everything else has defaults.

✅ **For Phase 9 production deploy:**
- [ ] `JWT_SECRET` = secure random string
- [ ] `ADMIN_TOKEN` = secure random string
- [ ] `DATABASE_URL` = your prod Postgres URL
- [ ] `REDIS_URL` = your prod Redis URL
- [ ] `PUBLIC_WEB_URL` = your prod web domain
- [ ] `PUBLIC_API_URL` = your prod API domain
- [ ] `CORS_ORIGINS` = your prod web domain
- [ ] `EMAIL_PROVIDER` = `resend` (or `postmark` / `log`) — only after the sending domain is DNS-verified
- [ ] `EMAIL_API_KEY` = your Resend/Postmark API key (if using real email)
- [ ] `GOOGLE_CLIENT_ID` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `GOOGLE_SIGNIN_ENABLED=true` = only if Google Sign-In is ready (optional)
- [ ] Voice (optional) — `VOICE_ENABLED=true`, `VOICE_DOMAIN`, `LIVEKIT_URL` + `NEXT_PUBLIC_LIVEKIT_URL` (`wss://<VOICE_DOMAIN>`), a real `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (never the dev pair), `VPS_PUBLIC_IP` — then start with `--profile voice`

✅ **Optional (can skip for MVP):**
- R2 (file uploads)
- Sentry (error tracking)
- Google Sign-In (account linking method)

