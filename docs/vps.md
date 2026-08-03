# QA Review & Deployment Plan: Sketchy on VPS

**Project:** Undercover / Sketchy
**Server:** `pb56` (Proxmox host) → LXC 170 (`docker`) → `/opt/game`
**Target Domains:**
- **App:** `sketchy.canvasco.in`
- **API:** `api.canvasco.in`
- **Webhook/Deploy:** `deploy.canvasco.in`

---

## 1. Architectural Decisions & Reasoning

This deployment plan introduces a few critical architectural shifts from the previous setup. The reasoning for each is detailed below for QA and operational review.

### 1.1 Dropping Caddy as the Reverse Proxy
**Decision:** Caddy has been completely removed from the production Docker Compose stack (`deploy/compose.prod.yml`), and its associated volumes have been deleted.
**Reasoning:**
- **Redundancy:** The server already runs multiple Cloudflare Tunnel (`cloudflared`) instances. Cloudflare Tunnels can natively route incoming traffic directly to specific internal Docker containers based on the requested hostname (e.g., `sketchy` routes to `deploy-web-1:3000`, `api` routes to `deploy-api-1:4000`). Using Caddy as a middleman to do the exact same routing is unnecessary and adds overhead.
- **TLS Termination:** Cloudflare handles edge TLS. Attempting to manage a strict Origin Certificate (`origin.pem`) internally via Caddy led to the recent crash-loop incident because the certificate file was missing on the host. By removing Caddy, we rely entirely on Cloudflare for SSL/TLS, simplifying our internal credential management.
- **Simplicity:** Fewer containers mean fewer points of failure. The `deploy_default` Docker network is already secure and isolated, so internal unencrypted HTTP traffic between `cloudflared` and the Node.js/Next.js services is safe.

### 1.2 Webhook-Based CI/CD Pipeline
**Decision:** Replaced the previous `appleboy/ssh-action` deployment strategy with an HTTP webhook listener (`almir/webhook`) running on the VPS.
**Reasoning:**
- **Security:** The previous pipeline required storing raw SSH keys and server IP addresses in GitHub Secrets, granting GitHub Actions full root SSH access to the Proxmox VPS. The webhook approach only requires a single HMAC secret token. If the token leaks, an attacker can only trigger a git pull/rebuild of the app, rather than gaining arbitrary shell access.
- **Isolation:** The webhook container runs with specific volume mounts (only `/opt/game` and the docker socket) rather than full host access.
- **Consistency:** The server already runs a webhook receiver for the `mithilvi` landing page. Unifying the deployment strategy reduces operational overhead.

### 1.3 Database Migration Strategy
**Decision:** The deployment script explicitly runs `--profile migrate run --rm migrate` before bringing up the main stack.
**Reasoning:**
- **Crash Prevention:** A previous outage was caused by `deploy-api-1` crash-looping with the error `relation "players" does not exist`. This occurred because the Node.js API attempted to query a database table before the schema migration had run. Forcing the `migrate` profile to execute synchronously during the deployment guarantees the database schema is up-to-date before the API container boots.

---

## 2. Prerequisites & Environment Variables

Create the production environment file on the VPS at `/opt/game/deploy/.env.prod`.

```env
# --- Domains ---
APP_DOMAIN=sketchy.canvasco.in
API_DOMAIN=api.canvasco.in

# --- Data stores ---
POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgres://sketchy:<strong-password>@postgres:5432/sketchy
REDIS_URL=redis://redis:6379

# --- Auth ---
JWT_SECRET=<strong-random-hex-32>
JWT_SECRET_PREVIOUS=

# --- Networking ---
CORS_ORIGINS=https://sketchy.canvasco.in
PUBLIC_WEB_URL=https://sketchy.canvasco.in
PUBLIC_API_URL=https://api.canvasco.in

# --- Observability / admin ---
LOG_LEVEL=info
ADMIN_TOKEN=<strong-random-token>

# --- Cloudflare R2 (If using file uploads) ---
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=

# --- Optional Defaults ---
EMAIL_PROVIDER=log
GOOGLE_SIGNIN_ENABLED=false
VOICE_ENABLED=false
```

**Required Cloudflare / GitHub Secrets:**
- **Cloudflare Tunnel Token**: For `canvasco.in`.
- **`WEBHOOK_SECRET`**: A strong HMAC secret for webhook validation. Added to GitHub Actions as `WEBHOOK_URL` or `WEBHOOK_SECRET`.

---

## 3. Deployment Execution Steps

### Phase 1: Stack Teardown
Clean up the old stack and volumes.
```bash
cd /opt/game/deploy
docker compose -f compose.prod.yml --env-file .env.prod down
```
*(Note: Omit `-v` if you wish to preserve the existing Postgres data. Use `-v` to start completely fresh).*

### Phase 2: Rebuild Compose Stack (Without Caddy)
1. **Modify `deploy/compose.prod.yml`:** Remove the entire `caddy` service block and its associated volumes (`caddy-data`, `caddy-config`).
2. **Start the stack:**
```bash
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile migrate build
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile migrate run --rm migrate
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d
```
3. **Verify:** Check that `deploy-api-1` and `deploy-web-1` are running smoothly without crash-loops.

### Phase 3: Cloudflare Tunnel Routing
Create a Cloudflare Tunnel container on the VPS to route traffic.
```yaml
# /opt/cloudflared-canvasco/docker-compose.yml
services:
  cloudflared-canvasco:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared-canvasco
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
    networks:
      - deploy_default

networks:
  deploy_default:
    external: true
```
**Cloudflare Dashboard Configuration:**
- `sketchy.canvasco.in` → HTTP `deploy-web-1:3000`
- `api.canvasco.in` → HTTP `deploy-api-1:4000`
- `deploy.canvasco.in` → HTTP `deploy-webhook:9000`

### Phase 4: Webhook CI/CD Listener
Update the existing webhook setup at `/opt/deploy-webhook/`.

**`hooks.json`:**
```json
[
  {
    "id": "deploy-sketchy",
    "execute-command": "/scripts/deploy.sh",
    "command-working-directory": "/opt/game",
    "trigger-rule": {
      "match": {
        "type": "payload-hmac-sha256",
        "secret": "<YOUR_WEBHOOK_SECRET>",
        "parameter": { "source": "header", "name": "X-Hub-Signature-256" }
      }
    }
  }
]
```

**`deploy.sh`:**
```bash
#!/bin/bash
set -euo pipefail
cd /opt/game
git fetch origin main
git reset --hard origin/main
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile migrate build
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile migrate run --rm migrate
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d
```

### Phase 5: GitHub Actions
Update `.github/workflows/ci.yml` (already completed in the codebase) to perform a `curl` POST request to `deploy.canvasco.in` upon a successful test pipeline on the `main` branch.

---

## 4. QA Verification Checklist

- [ ] **API Health:** `curl -I https://api.canvasco.in/v1/health` returns `200 OK`.
- [ ] **Web Frontend:** `curl -I https://sketchy.canvasco.in` returns `200 OK` or `304 Not Modified`.
- [ ] **Database Integrity:** No `relation "players" does not exist` errors in `docker logs deploy-api-1`.
- [ ] **CI/CD Pipeline:** A test push to `main` completes the GitHub Actions pipeline, triggers the webhook, and successfully restarts the containers on the VPS.
- [ ] **Caddy Removal:** `docker ps` confirms no Caddy container is running for this stack.

# Server Context Document
**Host alias:** `pb56`
**Last updated:** 2026-08-01 (same-day update: thin pool incident resolved)
**Purpose:** Give any AI assistant (Claude, ChatGPT, Gemini, Codex, etc.) full situational awareness of this server's hardware, virtualization layout, Docker stack, storage architecture, and incident history — without needing to re-explain everything from scratch.

> **Status note:** This document was assembled from live command output. A few Proxmox host-level commands (see §12) did not get captured yet — sections relying on them are marked `[PENDING]`. Everything else below is confirmed from actual output.

---

## 1. Executive Summary

This is a single physical Proxmox VE host (`pb56`) running one primary LXC container (`VMID 170`, hostname `docker`) which hosts ~45 Docker containers covering media management, self-hosted dev tools, a Coolify PaaS deployment, and a custom app stack ("sketchy"/"deploy"). There is also one stopped VM (`156`, `pbdebian12`).

**RESOLVED (2026-08-01):** The Proxmox LVM-thin pool (`pve/data`) was stuck reporting 100% data usage even after the original 183GB qBittorrent cleanup, because deleted blocks inside the guest ext4 filesystem were never reclaimed by the thin pool (classic thin-provisioning discard gap). Running `fstrim` directly against the LV from the Proxmox host (container stopped) reclaimed **321.6 GiB**, dropping the pool to a healthy **16.34% Data% / 1.17% Meta%**. Full procedure documented in §7.2. **Root cause confirmed fixed too**: qBittorrent's `/downloads` mount is correctly bound to `/mnt/data` (the dedicated media-pool disk), not the rootfs — verified via `docker inspect`. This incident chain is fully closed.

**Watch item:** `/mnt/data` itself is at 86% used (319G/373G, 54G free) — not urgent, but it's the bulk media/download disk, so worth monitoring over time.

**Current open issues (app-level, unrelated to storage):** two containers in the `deploy` project — a missing Caddy TLS cert (fix identified, not yet applied) and a missing Postgres migration (still being diagnosed) — see §9.

---

## 2. Hardware

### 2.1 Storage devices
| Device | Model | Capacity | Role |
|---|---|---|---|
| NVMe0 | Crucial CT500P3SSD8 | 500 GB | Proxmox root/LVM (boot + VM storage) |
| NVMe1 | Samsung MZVLQ512HBLU-00B00 | 512 GB | `media` storage pool (bulk data) |

**SMART health (both drives PASSED, no errors logged):**

| Metric | NVMe0 (Crucial) | NVMe1 (Samsung) |
|---|---|---|
| Temperature | 50°C | 33°C |
| Percentage Used (wear) | 36% | 23% |
| Power On Hours | 21,434 | 17,445 |
| Power Cycles | 12,584 | 33,645 |
| Unsafe Shutdowns | 11,239 | 328 |
| Data Units Read | 88.0 TB | 108 TB |
| Data Units Written | 33.6 TB | 67.9 TB |
| Media/Data Integrity Errors | 0 | 0 |
| Error Log Entries | 10,306 (all "Invalid Field in Command" — benign/harmless NVMe log noise) | 0 |

> NVMe0's 11,239 unsafe shutdowns and high error-log count are worth keeping an eye on over time, though SMART overall health still reports PASSED and there are zero data integrity errors.

### 2.2 CPU / Memory
`[PENDING]` — need output of `lscpu` and `free -h` from the Proxmox host to fill this in.

### 2.3 OS
- Kernel: `7.0.12-1-pve` (Proxmox VE, PMX build, dated 2026-06-09)
- LXC 170 guest OS: Ubuntu 24.04 LTS (Noble Numbat)

---

## 3. Proxmox Host — Virtualization Inventory

### 3.1 LXC Containers
| VMID | Name | Status | Cores | Memory | Notes |
|---|---|---|---|---|---|
| 170 | `docker` | running | 6 | 13,444 MB | Hosts entire Docker stack |

**Container 170 config (`pct config 170`):**
```
arch: amd64
cores: 6
features: nesting=1
hostname: docker
memory: 13444
mp171: media:170/vm-170-disk-0.raw,mp=/mnt/data,backup=1,size=400G
nameserver: 1.1.1.1 8.8.8.8
net0: name=eth0,bridge=vmbr0,firewall=0,hwaddr=BC:24:11:2F:05:DF,ip=dhcp,type=veth
ostype: ubuntu
rootfs: local-lvm:vm-170-disk-0,size=379G
swap: 28610
unprivileged: 1
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

Key points:
- Unprivileged container, nesting enabled (required for Docker-in-LXC).
- Root filesystem is a **379G thin-provisioned LVM volume** on `local-lvm`.
- `/mnt/data` is a **bind-mounted raw image** (`mp171`) living on the separate `media` storage pool — this is where bulk media/downloads live, **not** the thin pool.
- TUN device passthrough is enabled (needed for VPN/torrent clients like qBittorrent).

### 3.2 Virtual Machines
| VMID | Name | Status | Memory | Boot disk |
|---|---|---|---|---|
| 156 | `pbdebian12` | stopped | 8192 MB | 60 GB |

No other VMs are defined.

---

## 4. Storage Architecture

### 4.1 Diagram — Physical Layout
```
NVMe0 (Crucial 500GB)
│
├── EFI partition
├── pve-root (96G) -> Proxmox host OS
├── swap (8G)
└── local-lvm thinpool (353.12G, on /dev/nvme0n1p3)
 │
 └── vm-170-disk-0 (379G thin volume, 93.17% data used)
 │
 └── = rootfs for LXC 170 ("docker")

NVMe1 (Samsung 512GB)
│
└── "media" storage pool (dir-based, 491GB total)
 │
 └── vm-170-disk-0.raw (400G raw image)
 │
 └── bind-mounted into LXC170 as /mnt/data
```

### 4.2 Diagram — Storage inside the LXC
```
LXC 170 ("docker")
/
├── /var/lib/docker -> lives on the 379G thin LVM volume
├── /mnt/data -> bind-mounted physical raw image on NVMe1 ("media")
├── docker compose projects -> /data/compose/*, /data/coolify/*, /opt/*, /artifacts/*
```

### 4.3 Current Proxmox Storage Status — resolved as of 2026-08-01
**Before fstrim (incident state):**
```
Name Type Status Total (KiB) Used (KiB) Available (KiB) %
local dir active 100,560,696 14,588,272 85,972,424 14.51%
local-lvm lvmthin active 370,270,208 370,270,208 0 100.00%
media dir active 491,134,172 412,872,512 53,239,948 84.07%
```
```
 LV VG Attr LSize Pool Data% Meta%
 data pve twi-aotzD- <353.12g 100.00 3.69
```

**After fstrim (current, healthy state):**
```
Name Type Status Total (KiB) Used (KiB) Available (KiB) %
local dir active 100,560,696 14,588,380 85,972,316 14.51%
local-lvm lvmthin active 370,270,208 60,502,151 309,768,056 16.34%
media dir active 491,134,172 412,872,512 53,239,948 84.07%
```
```
 LV VG Attr LSize Pool Origin Data% Meta%
 data pve twi-aotz-- <353.12g 16.34 1.17
 vm-170-disk-0 pve Vwi-aotz-- 379.00g data 15.22
```
Note the `D` (data-full) flag is gone from the `data` LV's attributes — confirms the pool is no longer flagged full.

```
 VG #PV #LV #SN Attr VSize VFree
 pve 1 4 0 wz--n- <464.00g 4.00m

 PV VG Fmt Attr PSize PFree
 /dev/nvme0n1p3 pve lvm2 a-- <464.00g 4.00m
```
(VG free-space headroom is still essentially zero — see caveat in §4.4.)

### 4.4 RESOLVED: Thin Pool Data-Full Condition
**Original problem:** the `data` LV showed `Attr: twi-aotzD-` (the `D` flag = LVM's data-usage-full marker) and `pvesm status` confirmed `local-lvm` at 100.00% with 0 KiB available — despite the container's own `df -h` showing only 51G/373G (15%) used.

**Root cause of the *discrepancy* (not just the original 183GB qBittorrent fill):** thin-provisioned volumes don't automatically return freed blocks to the pool when files are deleted inside the guest filesystem. Ext4 marks blocks free within its own metadata, but never issues a `TRIM`/`discard` to the underlying block device unless explicitly told to. So even after the original cleanup, the pool still believed all those blocks were in use.

**Fix applied (2026-08-01):**
```bash
pct stop 170
lvchange -ay pve/vm-170-disk-0
mkdir -p /mnt/trim-tmp
mount /dev/pve/vm-170-disk-0 /mnt/trim-tmp
fstrim -v /mnt/trim-tmp
# -> /mnt/trim-tmp: 321.6 GiB (345325326336 bytes) trimmed
umount /mnt/trim-tmp
pct start 170
```
Result: pool dropped from 100.00% to **16.34% Data%** — confirmed via `lvs -a` and `pvesm status` post-fix (§4.3). Note this reclaimed far more than just the 183GB qBittorrent data — 321.6GB total — implying normal operational churn had also never been trimmed, possibly since this LV was first provisioned.

**Why `fstrim` had to run from the Proxmox host, not inside the container:** running `pct exec 170 -- fstrim -v /` failed with `Operation not permitted` — unprivileged LXC containers lack the capability to issue the `FITRIM` ioctl themselves, even though the underlying thin volume supports discard. It has to be run against the LV directly from the host with the container stopped.

**Ongoing action items (prevent recurrence):**
- **Schedule periodic `fstrim`** (e.g. weekly cron on the Proxmox host running the procedure above) so freed space gets reclaimed automatically instead of silently accumulating until the pool hits 100% again.
- **Check/enable the `discard` option** on the `local-lvm` storage definition in `/etc/pve/storage.cfg` (or via Datacenter → Storage → local-lvm in the GUI) — `[PENDING]`, not yet confirmed whether this is set.
- ~~Root-cause fix still needed: qBittorrent should be reconfigured to write into `/mnt/data`~~ — ** CONFIRMED ALREADY FIXED, see §7.3.** qBittorrent's `/downloads` mount correctly points at `/mnt/data`, verified via `docker inspect`.
- **VG headroom is still ~0** (`PFree: 4.00m`) — the pool now has plenty of *allocated-but-unused* space (83.66% free within the 353G it already owns), but the volume group itself has no room to *grow* the pool further without adding a new physical disk. This is fine as long as usage stays reclaimed via trim, but worth knowing before assuming you can just "extend" your way out of a future full-pool situation.
- **New watch item:** `/mnt/data` (the media/downloads disk) is at 86% used (54G free) — this is now the capacity constraint to watch, separate from the thin pool.

### 4.5 Filesystem usage inside LXC 170 (current)
```
Filesystem Size Used Avail Use% Mounted on
/dev/mapper/pve-vm--170--disk--0 373G 51G 307G 15% /
/dev/loop0 393G 319G 54G 86% /mnt/data
```
Note the discrepancy between this (healthy, 15% used) and §4.4 (pool reporting 100%) — this gap is exactly why the thin-pool metric needs investigating rather than trusting the in-container `df` alone.

### 4.6 Docker build cache — known issue
```
Error response from daemon: error getting build cache usage: failed to get usage for
xlhpm9x31szfdf8ufzav7afny: readdirent /var/lib/docker/overlay2/.../diff/app/apps/web/components: bad message
```
`docker system df` fails to report build cache size due to an overlay2 filesystem read error ("bad message" — typically an I/O/corruption-adjacent error, not necessarily disk failure). Worth a `docker builder prune` and/or `fsck` check if this persists, especially combined with the thin-pool fullness above.

---

## 5. Docker Stack (inside LXC 170)

### 5.1 Compose Projects (`docker compose ls`)
| Project | Status | Config path |
|---|---|---|
| `a4b8ne7z6zhzshlc6kig0lhu` | running(1) | `/artifacts/enxwgq2dca7esxhzmm4rxjai/docker-compose.yaml` |
| `bgcossko44gwwwscks0o0wgo` | running(1) | `/data/coolify/services/.../docker-compose.yml` |
| `c12s4enx7en90zad8oaezlmi` | running(1) | `/artifacts/zh5c2ptsbltwztqevj46a1w7/docker-compose.yaml` |
| `c890s3vr235ehbyq73hzuhb2` | running(1) | `/data/coolify/databases/.../docker-compose.yml` |
| `coolify-proxy` | running(1) | `/data/coolify/proxy/docker-compose.yml` |
| `craftyy` | running(1) | `/data/compose/3/docker-compose.yml` |
| `deploy` | **restarting(2), running(3)** | `/opt/game/deploy/compose.prod.yml` |
| `jenkins` | running(1) | `/opt/jenkins/docker-compose.yml` |
| `ngnix` | running(2) | `/opt/ngnix/docker-compose.yml` |
| `p14cgflvh3055fk6wahry5lg` | running(1) | `/artifacts/zn9ja3g9yj8tz7l8bkw54r44/docker-compose.yaml` |
| `pihole` | running(1) | `/data/compose/8/docker-compose.yml` |
| `plex-stack` | running(6) | `/data/compose/1/docker-compose.yml` |
| `prowller` | running(1) | `/data/compose/10/docker-compose.yml` |
| `qbit2` | running(1) | `/data/compose/9/docker-compose.yml` |
| `qgh9gl3kvgktj52u1akk6rr1` | running(1) | `/data/coolify/databases/.../docker-compose.yml` |
| `sonarqube` | running(1) | `/opt/sonarqube/docker-compose.yml` |
| `source` | running(4) | `/data/coolify/source/docker-compose.{yml,prod.yml}` |
| `v6hycc1rtyqreuc6ahcrl57z` | running(1) | `/artifacts/wrx3yq1zc7t4dkvygjypflgn/docker-compose.yaml` |
| `x7ruobnu56ck6az8l3yrk71w` | running(1) | `/data/coolify/services/.../docker-compose.yml` |
| `xjv7h4ugizdb8y578w52pjt8` | running(1) | `/data/coolify/databases/.../docker-compose.yml` |
| `yh5668rjfil8fdpxj2lfoqy3` | running(1) | `/data/coolify/databases/.../docker-compose.yml` |
| `z8sssok8c448gsgkow4kwc4s` | running(1) | `/artifacts/jfswi57rvuzwmaogbqtx7yk8/docker-compose.yaml` |
| `ze6yqtp0qnpikiywomxxy6gd` | running(1) | `/artifacts/cigaq60pv2qgkrlg3lrz16nx/docker-compose.yaml` |

** `deploy` project is unhealthy** — 2 of its containers are stuck in a restart loop (`deploy-caddy-1` and `deploy-api-1`, see §5.2). This has been ongoing across both snapshots taken (5 min apart), meaning it's a persistent crash-loop, not a transient blip.

### 5.2 Running Containers (`docker ps -a`)
Grouped by function:

**Coolify PaaS** (self-hosted deployment platform):
- `coolify` (v4.1.2) — healthy
- `coolify-realtime` — healthy
- `coolify-db` (postgres:15-alpine) — healthy
- `coolify-redis` (redis:7-alpine) — healthy
- `coolify-sentinel` (v0.0.21) — healthy
- `coolify-proxy` (traefik:v3.6) — healthy — binds ports 80/443/8080

**"deploy" custom app stack** — unhealthy:
- `deploy-web-1` (`sketchy-web:local`) — up, port 3064
- `deploy-api-1` (`sketchy-api:local`) — **restarting every ~20-40s**
- `deploy-caddy-1` (caddy:2) — **restarting every ~20-60s**
- `deploy-postgres-1` (postgres:16) — healthy
- `deploy-redis-1` (redis:7) — healthy
- `deploy-livekit-1` — status **Created** (never started)

**Media/Torrent stack:**
- `qbit2` (qBittorrent) — up, ports 18080, 46882
- `jellyfin` — up, ports 8096/8920
- `plex` — up, ports 32400 + related
- `prowlarr`, `jackett`, `sonarr`, `bazarr`, `overseerr` — all up
- `pihole` — DNS, ports 53/8085/8444

**Coolify-managed app instances** (auto-generated container names — these are apps deployed *through* Coolify):
- `c12s4enx7en90zad8oaezlmi-...`, `p14cgflvh3055fk6wahry5lg-...`, `ze6yqtp0qnpikiywomxxy6gd-...`, `v6hycc1rtyqreuc6ahcrl57z-...`, `a4b8ne7z6zhzshlc6kig0lhu-...`, `z8sssok8c448gsgkow4kwc4s-...` — all up
- Databases: `c890s3vr235ehbyq73hzuhb2` (redis:7.2), `xjv7h4ugizdb8y578w52pjt8` (mongo:7), `qgh9gl3kvgktj52u1akk6rr1` (redis, image `aacdfca78d28`), `yh5668rjfil8fdpxj2lfoqy3` (mongo, image `b9a64ab3cb9f`)

**Dev/ops tools:**
- `jenkins` (jenkins/jenkins:lts) — ports 8087, 50007
- `sonarqube` — port 9004
- `portainer` — ports 9443, 8005
- `n8n` (nightly) — port 5678
- `localstack` — ports 4510-4559, 4566
- `crafty` (Minecraft server controller)
- `npm` (nginx-proxy-manager) — ports 80/443/81
- `hackoverflow` (custom app) — port 3000
- `landing` (v1.0.0-65) — port 3067

**Networking:**
- 4× `cloudflared` tunnel containers (`cloudflared`, `cloudflared2`, `cloudflared-x7ruobnu...`, `cloudflared-bgcossko...`)

### 5.3 Docker Networks
`bridge`, `coolify`, `deploy_default`, `host`, `ngnix_default`, `none`, `pihole_default`, `plex-stack_default`, `prowller_prowlarr_default`, `qbit2_default`

### 5.4 Docker Volumes (local driver)
~40 volumes total, notable named ones:
`coolify-db`, `coolify-redis`, `jenkins_jenkins_home`, `portainer_data`, `sonarqube_sonarqube_{data,extensions,logs}`, `deploy_{caddy-config,caddy-data,postgres-data,redis-data,sketchy-postgres-data,sketchy-redis-data}`, plus per-app Coolify-managed volumes (`*_db-data`, `*_storage-data`, `*_uploads-data`, `*_invoices-data`, `*_pgdata`, `*_redisdata`) and 5 sets of `mongodb-db-*`/`mongodb-configdb-*` volumes tied to the mongo instances above.

---

## 6. Networking
`[PENDING]` — need `ip -br addr`, `ip route`, and `/etc/network/interfaces` from the Proxmox host.

Known so far:
- LXC 170 gets its IP via DHCP on `vmbr0` (bridged), MAC `BC:24:11:2F:05:DF`.
- DNS for the container: `1.1.1.1`, `8.8.8.8`.
- Reverse proxy / edge layer: `traefik` (coolify-proxy, ports 80/443/8080), `nginx-proxy-manager` (`npm`, ports 80/443/81), and `caddy` (deploy-caddy-1, currently crash-looping).
- 4 separate `cloudflared` tunnels suggest multiple independent Cloudflare Tunnel configs exposing different services externally without opening router ports directly.

---

## 7. Incident History

### 7.1 Thin Pool Exhaustion — Original Outage (root cause) -- RESOLVED
**Symptoms when it first happened:** LXC 170 failed to boot. Kernel logs showed `Buffer I/O error`, `JBD2: journal recovery failed`, `EXT4-fs: error loading journal` — initially looked like filesystem corruption, but was actually a *consequence* of the pool being full (writes failing → journal couldn't update → ext4 flagged errors).

**Root cause chain:**
```
qBittorrent downloads configured to write to /mnt/qbit2/downloads
 ↓ which was located on
LXC rootfs (not the dedicated /mnt/data 400G disk, which was nearly empty)
 ↓ which lives on
379G thin-provisioned volume (vm-170-disk-0)
 ↓ drawn from
local-lvm thin pool (353G physical)
 ↓ pool hit
100% data usage → new writes failed
 ↓ result
ext4 couldn't update its journal → journal recovery failed → container wouldn't boot
```

**Recovery steps taken:**
1. Mounted the container's disk manually (read-only) from the Proxmox host — confirmed the filesystem itself wasn't destroyed, just unable to write.
2. Investigated disk usage and found `/mnt/qbit2/downloads` ≈183GB sitting on the rootfs, while the dedicated `/mnt/data` 400G disk was nearly empty.
3. Remounted read-write, deleted the unnecessary downloads.
4. Container booted successfully. Post-fix `df` showed 51G/373G (15%) used.

### 7.2 Thin Pool Still Showing 100% After Cleanup -- RESOLVED (2026-08-01)
Even after the 183GB cleanup above, `lvs -a` / `pvesm status` continued to show the pool at 100% Data% with the `D` (full) flag set on the `data` LV — despite the container filesystem itself looking healthy (51G/373G).

**Why this happened:** deleting files inside a guest ext4 filesystem does not automatically return the underlying physical blocks to a thin pool. That reclamation only happens via `TRIM`/`discard`, which hadn't been run.

**Fix:** ran `fstrim` directly against the LV from the Proxmox host (see §4.4 for full command sequence and output). This reclaimed **321.6 GiB** — far more than just the original 183GB, suggesting normal operational churn had never been trimmed either. Pool dropped to **16.34% Data% / 1.17% Meta%**, confirmed via both `lvs -a` and `pvesm status`. The `D` flag is gone. Container was stopped for the trim and restarted cleanly afterward with no issues.

**Status:** fully resolved as of 2026-08-01. Recurrence prevention items are tracked in §4.4 (scheduled trim, discard mount option, and fixing the underlying qBittorrent download path so this can't build up again).

### 7.3 Root Cause Verification — CONFIRMED FIXED (2026-08-01)
Checked whether qBittorrent's download path (the original root cause in §7.1) was ever actually corrected, via:
```bash
docker inspect qbit2 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```
Result:
```
/mnt/qbit2/config -> /config
/mnt/data/qbit2downloads -> /downloads
/mnt/qbit2/watch -> /watch
```
**`/downloads` is correctly bound to `/mnt/data`** (the dedicated media-pool disk, confirmed via `df -h` showing it as the separate `/dev/loop0` device, not the rootfs). This is the fix — qBittorrent's actual torrent data now lands on the disk with headroom, not on the thin-pool-backed rootfs.

`/config` and `/watch` remain on the rootfs (`/mnt/qbit2/...` resolves to `/`), but this is fine — these hold only settings and `.torrent` watch files (negligible size), not bulk data.

**New watch item:** `/mnt/data` itself is at **86% used (319G/373G, 54G free)** as of this check. Not urgent, but this is now the disk that matters for capacity planning — worth checking periodically since it's the destination for all downloads/media growth going forward.

**Conclusion: the full incident chain (original fill → pool accounting stuck at 100% → root cause) is now closed.** No further storage action needed unless `/mnt/data` usage climbs further or the thin pool starts climbing again (in which case, re-run the fstrim procedure in §4.4).

---

## 8. Things to Never Do
- **Never point qBittorrent, media downloads, or any large/growing dataset at a path inside the LXC rootfs.** Always use `/mnt/data` (the `media`-pool bind mount). This was the original root cause of the outage and, as of this update, **has not yet been confirmed fixed at the qBittorrent config level** — only the symptom (full pool) has been cleared via fstrim.
- **Don't assume deleting files inside the container frees space in the Proxmox thin pool.** It doesn't, until a `fstrim` is run — see §4.4/§7.2. Budget for periodic trims, not just periodic cleanup.
- **Don't run `fstrim` from inside the container** (`pct exec 170 -- fstrim ...`) — unprivileged LXC containers get `Operation not permitted` on the `FITRIM` ioctl. Must be run from the Proxmox host directly against the LV, with the container stopped (§4.4 has the exact command sequence).
- Don't resize/extend `local-lvm` without first checking `vgs`/`pvs` — VG `pve` currently has essentially no free physical extents (`4.00m`), meaning growth requires adding a new PV/disk, not just extending the LV.
- Don't run `docker` commands on the Proxmox host itself — Docker isn't installed there; it lives inside LXC 170. Always prefix with `pct exec 170 -- ...`.
- Don't assume the `deploy` project's crash-looping containers are storage-related — confirmed (§9) they persisted through a full container stop/start and pool fix, so they're pure application-config issues (missing TLS cert, missing DB migration).

---

## 9. Current Known Issues (updated 2026-08-01)

1. ~~`local-lvm` thin pool at 100% data usage~~ — **RESOLVED via fstrim, see §4.4/§7.2.** Pool now at 16.34%.

2. **`deploy-caddy-1` — crash-looping, root cause confirmed:**
 ```
 Error: loading initial config: ... loading certificates: open /etc/caddy/certs/origin.pem: no such file or directory
 ```
 Caddy is configured to load a static TLS cert (`origin.pem`) that doesn't exist in the container. Confirmed this persisted through the full stop/start/fstrim cycle, so it's unrelated to storage — a pre-existing config/provisioning gap.
 **Next step:** check `pct exec 170 -- ls -la /etc/caddy/certs/` and the mounted Caddyfile to see whether the cert should be generated, copied in, or whether the Caddyfile should be switched to Caddy's automatic HTTPS instead.

3. **`deploy-api-1` — crash-looping, root cause confirmed:**
 ```
 error: relation "players" does not exist (code 42P01)
 ```
 The app (Drizzle ORM-based, per the stack trace) is querying a `players` table that was never created in `deploy-postgres-1` — a missing/un-run database migration, not a storage or infra issue.
 **Next step:** run `docker exec -it deploy-postgres-1 psql -U <user> -d <dbname> -c '\dt'` to confirm the table's absence, then run whatever migration command this app uses (likely `drizzle-kit migrate` or similar) against that Postgres instance.

4. **`deploy-livekit-1` still stuck at `Created`, never starts** — very likely blocked on `deploy-api-1` coming up healthy first (common compose dependency ordering). Should resolve on its own once issue #3 above is fixed — worth rechecking after the migration is run.

5. **`coolify-sentinel` exited (255) once after the container restart** — logs before the exit showed normal startup and a healthy `/api/health` check, so this looked like a one-off hiccup from the abrupt `pct stop`/`pct start` cycle during the fstrim procedure. A `docker restart coolify-sentinel` was issued; **not yet confirmed whether it came back healthy** — worth a quick `docker ps` check.

6. **`docker system df` build-cache query fails** with an overlay2 "bad message" read error — worth a `docker builder prune -a` and a filesystem check.

7. **NVMe0 has 11,239 unsafe shutdowns and ~10.3K NVMe error-log entries** (all benign "Invalid Field in Command," not integrity errors) — not urgent, but worth monitoring if it starts changing behavior.

8. ~~Root cause of the original outage (qBittorrent writing to rootfs instead of `/mnt/data`) has not been confirmed fixed~~ — ** CONFIRMED FIXED, see §7.3.** `docker inspect qbit2` shows `/downloads` correctly bound to `/mnt/data`.

9. **New watch item:** `/mnt/data` (media/downloads disk) is at 86% used, 54G free. Not urgent, but this is the capacity constraint to track going forward now that the thin-pool issue is closed.

---

## 10. Backup Strategy
`[PENDING — not yet documented]`. Known Proxmox config references `vzdump.cron` and `vzdump.conf` exist on the host (seen in the `/etc/pve` file listing), implying scheduled backups are configured, but contents haven't been captured yet. Worth running:
```bash
cat /etc/pve/vzdump.cron
cat /etc/pve/vzdump.conf
```
and adding the result here.

---

## 11. Troubleshooting Playbook (quick reference)

**"Container/services became unresponsive":**
1. `pvesm status` and `lvs -a` on the Proxmox host — check for thin pool at/near 100% (look for the `D` flag in the LV's `Attr` column, e.g. `twi-aotzD-`).
2. If full: identify large recent writes inside the LXC rootfs (`du -xh --max-depth=2 / | sort -rh | head -20` inside container) — do **not** search `/mnt/data`, that's a separate physical volume.
3. Delete offending data if found.
4. **Even after deleting data, the pool may still show 100%** — this is expected (see §7.2) because deleted blocks aren't returned to the pool until trimmed. Reclaim them:
 ```bash
 pct stop <vmid>
 lvchange -ay pve/<disk-lv-name> # e.g. pve/vm-170-disk-0
 mkdir -p /mnt/trim-tmp
 mount /dev/pve/<disk-lv-name> /mnt/trim-tmp
 fstrim -v /mnt/trim-tmp
 umount /mnt/trim-tmp
 pct start <vmid>
 ```
 Note: this can take anywhere from a few minutes to 30+ minutes depending on how fragmented the freed space is — don't interrupt it. `fstrim -v` only prints output after it completes, so there's no live progress bar; check via `ps aux | grep fstrim` or `iostat -x 2` in a second session if you want to confirm it's still working.
5. Confirm pool has headroom again (`lvs -a` — `D` flag should be gone, `Data%` should drop), confirm container responsive.
6. **Don't attempt `fstrim` from inside the container itself** (`pct exec <vmid> -- fstrim ...`) — unprivileged LXC containers will return `Operation not permitted`. It must be run from the host directly against the LV as shown above.

**"A specific docker-compose project keeps restarting":**
```bash
pct exec 170 -- docker logs <container_name> --tail 100
pct exec 170 -- docker compose -f <config_path_from_table_5.1> ps
```

**General host command reference:**
```bash
# Proxmox host
pveversion -v
pvesm status
lvs -a; vgs; pvs
pct list
pct config <vmid>
qm list

# Inside the docker LXC
pct exec 170 -- docker ps -a
pct exec 170 -- docker compose ls
pct exec 170 -- docker system df
pct exec 170 -- docker logs <name> --tail 100
```

---

## 12. Outstanding Data Requests
The following commands haven't produced captured output yet. Running them and appending the output to this doc will complete it:
```bash
pveversion -v
hostnamectl
cat /etc/pve/storage.cfg
cat /etc/network/interfaces
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,MODEL
lscpu
free -h
ip -br addr
ip route
cat /etc/pve/datacenter.cfg
cat /etc/pve/.version
cat /etc/pve/vzdump.cron
cat /etc/pve/vzdump.conf
```

---

## 13. AI Handoff Notes
If you're an AI assistant picking this up fresh:
- This is a **home/homelab-style server** running Proxmox VE, with almost all real workloads inside a single big Docker-in-LXC container (VMID 170).
- The owner already fully resolved a two-stage storage incident: (1) qBittorrent originally filled the thin pool by writing to the wrong path, (2) the pool stayed stuck at 100% even after cleanup because thin-provisioned volumes don't reclaim freed blocks without an explicit `fstrim`. Both are resolved, **and** the root cause (qBittorrent's download mount) was verified already pointing at `/mnt/data` correctly — the full incident chain is closed. No need to re-litigate this unless new symptoms appear.
- **New capacity watch item, not an incident:** `/mnt/data` (the media/downloads disk) is at 86% used, 54G free. Worth a passing mention if asked about storage health, but not urgent.
- The `deploy` project (custom "sketchy" app) has two confirmed, unrelated-to-storage bugs: a missing Caddy TLS cert file (fix identified: needs a Cloudflare Origin Certificate generated and placed at `/etc/caddy/certs/origin.pem` + `origin-key.pem`) and a missing Postgres migration for a `players` table (still being diagnosed as of this writing) — see §9.
- Ports/services are exposed via a mix of direct port mapping, Traefik, Nginx Proxy Manager, and 4 separate Cloudflare Tunnels — when suggesting new services, ask which exposure method is intended rather than assuming.
- If asked to help with future storage cleanups: always pair "delete the data" with "then fstrim it" — deleting alone will not show up as reclaimed pool space.