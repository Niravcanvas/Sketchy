# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# Copy workspace manifests first so pnpm install is cached independently of
# source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @sketchy/web...

COPY . .

# next.config.mjs's `env` block inlines these at BUILD time (Next.js bakes `env`
# and `NEXT_PUBLIC_*` values into the compiled bundle — a runtime `environment:`
# on the container does nothing for them), so they must arrive as build args,
# not container env vars. Defaults match the dev fallbacks in next.config.mjs /
# apps/api/src/env.ts so a plain `docker build` with no --build-arg still works.
ARG PUBLIC_API_URL=http://localhost:4000
ARG SENTRY_DSN=
ARG NEXT_PUBLIC_GITHUB_URL=
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
ENV PUBLIC_API_URL=$PUBLIC_API_URL \
    SENTRY_DSN=$SENTRY_DSN \
    NEXT_PUBLIC_GITHUB_URL=$NEXT_PUBLIC_GITHUB_URL \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL

RUN pnpm --filter @sketchy/web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Next standalone output preserves the monorepo layout: server.js lives under apps/web.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# og-image.tsx reads this at request time (dynamic routes like
# /r/[code]/opengraph-image aren't prerendered) — not traced into
# .next/standalone by Next's file tracer, so it needs its own COPY.
COPY --from=build /repo/apps/web/src/assets ./apps/web/src/assets
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
