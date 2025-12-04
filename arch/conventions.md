# Conventions — code standards, visual direction, and cross-cutting decisions

> Decisions phases must not re-make. Structure: §1 repo/code conventions, §2 visual
> direction (fonts/colors/assets — all resources verified live July 2026), §3 motion,
> §4 cross-cutting technical decisions, §5 definition of done for every phase.

## §1 Repo & code conventions

### Layout (see system-design.md §2 for the why)

```
apps/web, apps/api, packages/engine, packages/shared, packages/config
deploy/            compose files, Caddyfile, RUNBOOK.md, deploy scripts
arch/, plan/, research/   (docs — this planning corpus)
```

- **pnpm** workspaces; Node 22 LTS pinned via `.nvmrc` + `engines`.
- Package names: `@sketchy/web`, `@sketchy/api`, `@sketchy/engine`, `@sketchy/shared`,
  `@sketchy/config`.
- Dependency rule (enforced by eslint import boundaries): `engine` depends on nothing
  internal; `shared` may depend on `engine` types; apps depend on both; **apps never import
  from each other**; `web` never imports server-only modules (`pg`, `ioredis`, …).

### TypeScript & style

- `strict: true`, `noUncheckedIndexedAccess: true` everywhere. No `any` outside test
  fixtures (eslint error).
- Files: kebab-case (`clue-board.tsx`); React components: PascalCase exports; hooks:
  `use-*.ts`; one component per file; no barrel `index.ts` re-export files (they wreck
  tree-shaking and jump-to-def).
- Zod schema next to the type it validates, in `packages/shared/src/contract/`.
- ESLint (flat config) + Prettier from `packages/config`; CI fails on warnings.
- Comments: explain constraints and invariants, not narration. The engine gets doc comments
  on every action type (it's the rules encyclopedia).

### React / Next.js

- App Router. Marketing/static pages are Server Components; the room route (`/r/[code]`)
  and pass-and-play (`/play`) are client components ("use client") fed by the socket/engine.
- Client state: **zustand** — one store per domain (`room-store` holds latest snapshot +
  `you` slice; `session-store` holds token/player). No Redux, no context pyramids. Server
  cache state (packs, history): **TanStack Query** over the typed REST client from
  `@sketchy/shared`.
- Socket handling lives in one module (`apps/web/src/lib/socket.ts`): connect, resync on
  reconnect/visibility, snapshot → store. Components subscribe to the store, never to the
  socket.
- Tailwind: tokens only (§2 palette/fonts via the preset in `@sketchy/config`); no raw hex
  in components; component variants via `cva`. No component library (shadcn/radix allowed
  for a11y primitives — dialog, popover — restyled to sketch look).

### API (Fastify)

- Route files by resource (`routes/rooms.ts`), socket handlers by event group
  (`sockets/lobby.ts`, `sockets/play.ts`). Every handler: auth → zod-validate → engine/db →
  reply envelope. No business logic in handlers — that's the engine's job (or a `services/`
  module for non-game logic).
- Logging: pino, one JSON line per request/action with `playerId`, `roomCode`, `action`,
  `ver`, `ms`. Never log words/roles/votes (they're the whole game).

### Testing

- **Vitest** everywhere. `packages/engine` is the crown jewel: every action × phase
  combination, win-condition table tests mirroring research/01 §5, property tests (e.g.
  "exactly one pair in play; role counts always match settings; eliminated players never
  act"). Engine target: ~100% branch coverage — it's pure functions, no excuse.
- API: integration tests against real Postgres+Redis from compose (`vitest --project api`),
  including multi-socket game simulations (phase 8 makes these a bot harness).
- Web: component tests for tricky widgets (peek card, vote grid); Playwright smoke for the
  two golden paths (P&P full game; online 3-player full game) from phase 8 on.

### Git

- Trunk-based: `main` always deployable; short-lived feature branches `phaseN/topic`.
- Conventional commits (`feat:`, `fix:`, `chore:`…). CI (lint+typecheck+test) required to
  merge.

## §2 Visual direction — "the notebook"

> **SUPERSEDED (2026-07-09): the visual direction is now "Party Pop" — see
> `arch/design-party-pop.md`, which replaces this whole section (palette, fonts, textures,
> sketch rendering) and the motion-library choices in §3. §2/§3 are kept for historical
> context only; do not build new UI against them.**

The entire game looks like it was **scribbled into a shared notebook**: paper background,
ink linework, marker accents, wobbly borders, handwritten type. Human, warm, slightly
chaotic — never flat-corporate. Every resource below was verified live (license checked).

### Fonts (all OFL 1.1, self-hosted woff2 via `next/font`)

| Token          | Font                                                                  | Use                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `font-ui`      | **Shantell Sans** (Google Fonts / github.com/arrowtype/shantell-sans) | Body & UI workhorse — marker-style variable font, legible at small sizes, 380+ language coverage (our i18n insurance). Weight 400–700; use its "informality" axis sparingly. |
| `font-display` | **Excalifont** (plus.excalidraw.com/excalifont, OFL)                  | Headlines, role-card titles, win screens — the whiteboard-sketch voice. Latin-focused: fall back to Shantell Sans for non-Latin.                                             |
| `font-hand`    | **Caveat** (Google Fonts, variable)                                   | Handwritten annotations ≥18 px: clue notes, scoreboard numbers, "signed" avatar names. Never below 16 px.                                                                    |

(Considered and available as substitutes: Patrick Hand — neater small-size alternative to
Shantell; Kalam — adds Devanagari; Gaegu — Korean. Recorded here so localization phases
don't re-research.)

### Palette (Tailwind tokens in `@sketchy/config`; no raw hex in components)

| Token        | Hex       | Use                                                    |
| ------------ | --------- | ------------------------------------------------------ |
| `paper`      | `#FAF6EC` | App background (with grain, §2 textures)               |
| `paper-2`    | `#F3EDDF` | Cards / raised surfaces                                |
| `ink`        | `#2B2926` | Primary text & all Rough.js strokes                    |
| `graphite`   | `#6E6A61` | Secondary text, disabled, ghost players                |
| `civilian`   | `#3D7BC4` | Civilian blue (marker)                                 |
| `undercover` | `#C6483F` | Undercover red (marker) — doubles as danger            |
| `mrwhite`    | `#8B7BC4` | Mister White violet (used with dashed "blank" styling) |
| `highlight`  | `#F5C842` | Highlighter yellow: selection, current turn, emphasis  |
| `success`    | `#5F9E62` | Confirmations, "ready" state                           |

Contrast: all text pairs meet WCAG AA on `paper`/`paper-2` (ink 12.1:1, graphite 4.9:1);
faction colors are never the _only_ signal (always icon + label). Dark mode is explicitly
**out of scope** for this roadmap (paper _is_ the brand; a "chalkboard" theme is a future
idea, don't half-ship it).

### Asset sources (chosen; licenses verified)

| Purpose                                                      | Source                                                                                                                                                    | License / note                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| UI icons                                                     | **Doodle Icons** — khushmeen.com/icons.html                                                                                                               | CC0, 400+ SVGs. Vendor into `apps/web/src/assets/icons/` (no npm pkg). ⭐ primary icon set                                                   |
| Icon gaps                                                    | **Streamline Freehand** via `@iconify/react` (icon-sets.iconify.design/streamline-freehand)                                                               | CC BY 4.0 — 1,000 icons; **requires attribution** → credit line in app footer + `CREDITS.md`                                                 |
| Player avatars                                               | **Open Peeps** — openpeeps.com                                                                                                                            | CC0. Modular hand-drawn parts → we build `<AvatarDoodle config>` composer (head/face/accessory/ink-color = `AvatarConfig` in data-model). ⭐ |
| Scene illustrations (empty states, how-to-play, win screens) | **Open Doodles** — opendoodles.com                                                                                                                        | CC0, sketchy people scenes ⭐                                                                                                                |
| Bespoke art pipeline                                         | **Excalidraw** (+ excalidraw-libraries)                                                                                                                   | Draw custom props (cards, magnifying glass, crown) in Excalidraw, export SVG — style-matches Excalifont automatically                        |
| Dev placeholders                                             | **Doodle Ipsum** — doodleipsum.com                                                                                                                        | Blush license, free; dev-only, self-host anything that ships                                                                                 |
| Paper grain                                                  | CSS `feTurbulence` grain (css-tricks.com/grainy-gradients) as inline data-URI; optional scanned texture from **ambientCG Paper** (CC0) compressed to AVIF | No runtime deps; keep texture <60 KB                                                                                                         |

`CREDITS.md` at repo root tracks every asset + license from phase 1 on (CC0 sets listed
too — good hygiene); the Streamline attribution line ships in the footer the first time one
of its icons does.

### Sketch rendering (how UI elements get the hand-drawn look)

- **Rough.js** (MIT, rough-stuff/rough) is the primitive for hand-drawn borders, frames,
  circles, vote marks. Wrapped once in our own `<Sketch>` React component (draws into an
  SVG via ref in `useEffect`, props: `shape`, `roughness`, `seed`) — **seed pinned per
  element ID** so borders don't re-wobble every render. No third-party React wrapper
  (they're unmaintained; wrapping is ~50 lines).
- **react-rough-notation** (MIT) for animated emphasis: circle the current turn-taker, box
  the tied players, underline the winner, strike-through the eliminated.
- **wired-elements is rejected** (dormant, web-component/SSR friction) — we build the small
  set we need on Rough.js: `SketchButton`, `SketchCard`, `SketchInput`, `SketchDialog`,
  `SketchTimerRing` (phase 1 establishes these).
- Cheap wobble without JS: the asymmetric border-radius trick
  (`border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px`) as a `.wobbly` utility
  for low-stakes elements.

## §3 Motion

- **vivus.js** (MIT) for stroke-draw-on: icons and clue notes "draw themselves" (~400 ms).
  Only works on stroked paths — our icon sets qualify.
- **excalidraw-animate** (MIT) pipeline for the big set pieces: how-to-play scenes and win
  screens as progressively-drawn SVG animations (pre-rendered, no runtime cost).
- rough-notation animations for reveals (see §2). Lottie only if a specific need survives
  review (free LottieFiles hand-doodle pieces are individually licensed — check per item);
  prefer the SVG-native techniques above.
- Rules: 150–250 ms micro-interactions; 800–1500 ms only for the three drama beats
  (deal, reveal, win); everything respects `prefers-reduced-motion` (swap draws for fades,
  never remove information); no idle looping animation during clue/discussion (it's a
  thinking game).

## §4 Cross-cutting technical decisions

- **Room codes**: 5 chars, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars — no
  0/O/1/I/L), always rendered uppercase, inputs normalize case. Constant lives in
  `@sketchy/shared`.
- **RNG**: engine takes an injected seeded PRNG (mulberry32 over a string seed). Server
  seeds from `crypto.randomUUID()`; tests use fixed seeds. `Math.random()` is banned in
  `engine` (eslint rule).
- **Time**: epoch ms numbers everywhere; server clock is truth (api-contract §2.3).
- **IDs**: UUIDv4 from the DB/`crypto.randomUUID()`; no incremental IDs exposed.
- **Env vars**: every var documented in `.env.example` (root) — `DATABASE_URL`, `REDIS_URL`,
  `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `CORS_ORIGINS`, `R2_*`, `SENTRY_DSN`,
  `ADMIN_TOKEN`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL`, `VOICE_ENABLED` (phase 15 — self-hosted
  LiveKit voice, system-design.md §8; `VOICE_ENABLED=false` is the kill-switch).
- **Profanity filter**: single shared word list + normalizer (leet/diacritics) in
  `@sketchy/shared`, applied to names, clues, chat, pack content. English-only at launch;
  documented limitation.
- **i18n posture**: not built in this roadmap, but ALL strings route through
  `apps/web/src/copy.ts` keyed per copy.md — extraction later is mechanical. No string
  literals in JSX (eslint warning).
- **Accessibility baseline**: every interactive element keyboard-reachable; peek-to-reveal
  has a toggle alternative (hold is an enhancement); focus states use the `highlight`
  token; color-independent state signaling (see §2 contrast note); `aria-live` polite
  region announces phase changes.

## §5 Definition of done (every phase, no exceptions)

1. `pnpm lint && pnpm typecheck && pnpm test` green in CI.
2. New user-facing strings come from copy.md (add to copy.md in the same PR if genuinely
   new — matching §12 tone rules).
3. API/socket changes reflected in `packages/shared` schemas AND api-contract.md
   (contract checklist, api-contract §4).
4. Schema changes = a committed Drizzle migration + data-model.md update.
5. New assets recorded in `CREDITS.md` with license.
6. The phase's "Verify" checklist (bottom of each plan file) executed manually.
7. No TODOs without a linked phase/issue reference.
