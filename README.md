# Sketchy

A social-deduction party game for 3–20 players: everyone gets a secret word — except the
players who got a slightly different one, and the one who got nothing at all.

## Prerequisites

- Node 22 (`.nvmrc`) and pnpm 9 (`corepack enable`)
- Docker (for local Postgres + Redis)

## Run it locally

```sh
docker compose -f deploy/compose.dev.yml up -d   # postgres :5432, redis :6379
cp .env.example .env                             # dev defaults work out of the box
pnpm install
pnpm dev                                         # web on :3000, api on :4000
```

Checks: `pnpm lint && pnpm typecheck && pnpm test`.

## Layout

| Path                          | What                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `apps/web`                    | Next.js game client + marketing pages                                    |
| `apps/api`                    | Fastify REST + Socket.IO backend (only process touching Postgres/Redis)  |
| `packages/engine`             | Pure TS game engine — same reducer in browser (pass-and-play) and server |
| `packages/shared`             | Zod contract schemas, typed REST client, shared constants                |
| `packages/config`             | Shared tsconfig / eslint / prettier / tailwind preset                    |
| `deploy/`                     | Compose files, deploy scripts, runbook                                   |
| `docs/`                       | Operator setup guide (`ENV_GUIDE.md`) + post-launch backlog              |
| `arch/`, `research/`          | Design docs — start with `arch/system-design.md`                         |

Asset licenses are tracked in [CREDITS.md](CREDITS.md).
