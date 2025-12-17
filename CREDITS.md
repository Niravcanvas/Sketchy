# Credits & asset licenses

Every shipped asset is recorded here with its license (arch/conventions.md §2).

| Asset                                                     | Source                                       | License                      |
| --------------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| Space Grotesk (font, `font-ui`)                           | Google Fonts, via next/font/google           | OFL 1.1                      |
| Archivo Black (font, `font-display`)                      | Google Fonts, via next/font/google           | OFL 1.1                      |
| Lucide (UI icons, `apps/web/src/components/icons/`)       | lucide.dev                                   | ISC                          |
| Open Peeps (avatar parts, `apps/web/src/components/avatar/`) | Pablo Stanley — openpeeps.com, packaged as `@dicebear/open-peeps` (github.com/dicebear/dicebear) | CC0 1.0 (art) / MIT (DiceBear packaging) |
| Paper grain (CSS `feTurbulence` technique)                | css-tricks.com/grainy-gradients              | n/a — code, no asset shipped |

## Font detail (Party Pop, 2026-07)

The "Party Pop" visual direction (arch/design-party-pop.md §3) replaces the three notebook-era
self-hosted fonts with two loaded through `next/font/google` in `apps/web/src/app/layout.tsx`.
Next self-hosts the woff2 at build time — there is no runtime request to Google, and nothing is
vendored under `apps/web/src/assets/fonts/` anymore.

- **Space Grotesk** (`font-ui`) — `Space_Grotesk` from `next/font/google`, `latin` subset,
  exposed as `--font-ui`. OFL 1.1 (github.com/floriankarsten/space-grotesk).
- **Archivo Black** (`font-display`) — `Archivo_Black` from `next/font/google`, weight `400`
  (the family's only weight), `latin` subset, exposed as `--font-display`. OFL 1.1
  (github.com/Omnibus-Type/Archivo).

(The notebook-era fonts — Shantell Sans, Excalifont, Caveat, self-hosted woff2 via
`next/font/local` — were removed with this migration.)

## Icon detail (Party Pop, 2026-07)

22 icons vendored as typed React components under `apps/web/src/components/icons/`
(`icon-<name>.tsx`, one PascalCase component per file — `IconPencil`, `IconEye`, …), each an inline
stroked `<svg>` (viewBox `0 0 24 24`, `fill="none"`, `stroke="currentColor"`, `aria-hidden` by
default) per the icon contract in arch/design-party-pop.md §6.

Source: **Lucide** (lucide.dev), ISC. The Party Pop direction replaces the notebook-era Doodle
Icons with Lucide's stroked geometry, rendered at `strokeWidth={2.5}` (instead of Lucide's default
`2`) to match the chunky Party Pop line weight. Each file transcribes the `<path>`/`<circle>`/
`<rect>`/`<line>` children verbatim from the named Lucide icon:

| Component        | Lucide icon            |
| ---------------- | ---------------------- |
| `IconArrowRight` | `arrow-right`          |
| `IconBallot`     | `vote`                 |
| `IconBook`       | `book-open`            |
| `IconChat`       | `message-circle`       |
| `IconCheck`      | `check`                |
| `IconCopy`       | `copy`                 |
| `IconCross`      | `x`                    |
| `IconCrown`      | `crown`                |
| `IconEye`        | `eye`                  |
| `IconGhost`      | `ghost`                |
| `IconHome`       | `house`                |
| `IconLink`       | `link`                 |
| `IconMic`        | `mic`                  |
| `IconMicOff`     | `mic-off`              |
| `IconPencil`     | `pencil`               |
| `IconPlay`       | `play`                 |
| `IconQuestion`   | `circle-help`          |
| `IconRefresh`    | `refresh-cw`           |
| `IconSettings`   | `sliders-horizontal`   |
| `IconTimer`      | `timer`                |
| `IconTrash`      | `trash-2`              |
| `IconUsers`      | `users`                |

(The notebook-era Doodle Icons — CC0, from the github.com/svatsa159/react-doodle-icons mirror —
were removed with this migration. Lucide ISC needs no footer attribution line.)

## Avatar detail (phase 5)

**Open Peeps** by Pablo Stanley (openpeeps.com) is CC0 1.0
(creativecommons.org/publicdomain/zero/1.0/) — modular hand-drawn "peeps" parts (head, face,
facial hair, mask, accessories). The official distribution is a Gumroad checkout, not fetchable
non-interactively, so the vendored data is a subset of the **DiceBear** project's `open-peeps`
packaging instead (github.com/dicebear/dicebear, MIT-licensed code — the CC0 artwork it embeds
stays CC0 regardless of the wrapper's own license, same reasoning as the Doodle Icons mirror
above). DiceBear's own file header credits the same original: "Design 'Open Peeps' by Pablo
Stanley licensed under CC0 1.0. / Remix of the original. Source: https://www.openpeeps.com/".

Fetched from the `v7.0.5` tag (the current `main`/`10.x` branch rewrote the library around a
Rust/WASM core and no longer ships the JS style-collection source used here) via
`raw.githubusercontent.com`:

- `https://raw.githubusercontent.com/dicebear/dicebear/v7.0.5/packages/@dicebear/open-peeps/src/index.ts`
  (the per-layer transforms/offsets: shared `0 0 704 704` viewBox, `head`/`face`/`accessories`
  each drawn into their own `<g transform="...">`)
- `https://raw.githubusercontent.com/dicebear/dicebear/v7.0.5/packages/@dicebear/open-peeps/src/types.ts`
  (the full list of upstream part ids per group)
- `https://raw.githubusercontent.com/dicebear/dicebear/v7.0.5/packages/@dicebear/open-peeps/src/components/head.ts`
- `https://raw.githubusercontent.com/dicebear/dicebear/v7.0.5/packages/@dicebear/open-peeps/src/components/face.ts`
- `https://raw.githubusercontent.com/dicebear/dicebear/v7.0.5/packages/@dicebear/open-peeps/src/components/accessories.ts`
- `https://raw.githubusercontent.com/dicebear/dicebear/v7.0.5/packages/@dicebear/open-peeps/src/utils/getComponents.ts`
  (confirms `head`/`face`/`accessories` are independent, optional layers — `facialHair`/`mask`
  weren't vendored, `AvatarConfig` has no field for either)

### Curated subset (8 heads / 8 faces / 4 accessories + `none`)

`apps/web/src/components/avatar/avatar-config.ts` has the canonical id lists. Each entry below
is `<our id>` ← `<upstream open-peeps id>`:

| Group        | Curated ids (→ upstream id if renamed)                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| head         | `afro`, `bun`, `flat-top` ← `flatTop`, `beanie` ← `hatBeanie`, `mohawk`, `long`, `shaved` ← `shaved1`, `turban`                                                    |
| face         | `smile`, `calm`, `cheeky`, `concerned`, `suspicious`, `awe`, `eyes-closed` ← `eyesClosed`, `explaining`                                                            |
| accessories  | `glasses-round` ← `glasses`, `glasses-bold` ← `glasses4`, `sunglasses`, `eyepatch`, plus `none` (no upstream part — renders no accessory layer)                    |

### Ink-only transform (the "notebook" recolor)

Open Peeps ships as flat, multi-color vector art (skin tone, clothing color, a black "ink"
layer). `<AvatarDoodle>` needs one `currentColor`-driven silhouette per conventions.md §2 ("no
raw hex in components", ink linework on paper), so every source fill was flattened at vendor
time (see the header comment in `avatar-heads.ts`/`avatar-faces.ts`/`avatar-accessories.ts`):

- Solid black (`fill="#000"`) → `fill: 'current'` (renders `currentColor`) — hair silhouettes,
  facial linework, accessory frames.
- White highlights (`fill="#fff"`, eye whites / lens glare) → `fill: 'none'` — transparent, so
  the paper background shows through instead of introducing a second hard-edged color.
- Any other stray accent fill (one face style had a `#FF8181` mouth-interior tint) → also
  `fill: 'none'`, same reasoning.
- The head silhouette's dynamic `${colors.skin}` fill (the actual skull/face shape upstream
  colors per-avatar) → `fill: 'none'` **plus** `stroke: 'current'`, `strokeWidth: 6` — an
  outlined head instead of a solid blob, since the hairstyle draws solid black on top of it and
  `AvatarConfig` has no skin-tone field to color it with anyway.

Each vendored part is stored as plain data — `AvatarShape[]` (`d`/`fill`/`stroke`/`strokeWidth`)
in `avatar-config.ts` — that `avatar-doodle.tsx` renders as real JSX `<path>` elements, not
`dangerouslySetInnerHTML` or a raw markup string.

### Shared coordinate system

All three layers were authored against the same `0 0 704 704` canvas and only line up with the
*exact* transforms DiceBear's own template uses: head via
`matrix(0.99789 0 0 1 156 62)`, face via `translate(315 248)`, accessories via
`translate(203 303)` (`avatar-doodle.tsx` hardcodes these). `<AvatarDoodle>` crops that shared
canvas to `viewBox="52 0 600 580"` — just the head — since the source canvas reserves its
bottom third for a torso this composer never vendors (Open Peeps parts assemble into full-body
illustrations upstream; `AvatarConfig` only models head/face/accessory/ink-color, a bust-style
avatar, per data-model.md).

## Sound (Phase 14)

Four short one-shot effects, self-hosted under `apps/web/public/sounds/` and played via
native HTML5 `Audio` (`apps/web/src/lib/sound.ts` — no audio library). Every file was
sourced from **freesound.org**, verified CC0 1.0 Universal by fetching the sound's own page
and confirming its license link resolves to
`creativecommons.org/publicdomain/zero/1.0/` (not just trusting the search-filter facet),
then trimmed/fade-tailed locally with `ffmpeg` (a lossless edit — trimming/fading a CC0 work
doesn't change its license) to fit this app's "small, tasteful" one-shot brief.

| File                        | Used for                        | Source                                                  | Original title              | License        |
| ---------------------------- | -------------------------------- | -------------------------------------------------------- | ---------------------------- | --------------- |
| `sounds/page-turn.mp3`       | Phase change (`use-phase-sound.ts`) | freesound.org/people/LilMati/sounds/397552/           | "Page Turn 05"               | CC0 1.0         |
| `sounds/reveal-sting.mp3`    | Elimination / Mr. White reveal   | freesound.org/people/egomassive/sounds/536757/           | "GaspM"                      | CC0 1.0         |
| `sounds/win-horn.mp3`        | Win screen                       | freesound.org/people/TiesWijnen/sounds/460496/           | "Party horn"                 | CC0 1.0         |
| `sounds/pencil-scratch.mp3`  | Clue pinned (`clue-board.tsx`)   | freesound.org/people/krismar1230/sounds/411026/          | "pencil writing.mp3"         | CC0 1.0         |

Each was downloaded from its Freesound CDN preview URL (`cdn.freesound.org/previews/...`,
publicly fetchable without an API token), trimmed to well under 2 seconds
(`page-turn.mp3` 1.0s, `reveal-sting.mp3` 0.37s original length unchanged, `win-horn.mp3`
1.8s of the original ~23s recording, `pencil-scratch.mp3` 0.65s) with a short `afade` tail
to avoid a hard click at the cut point, and re-encoded as MP3. No other edits.

## Marketing assets (Phase 14)

Assets added for the server-rendered marketing site (`/`, `/about`, `/faq`, `/privacy`,
`/terms` — plan/phase14.md task 2).

### Open Doodles (landing page "how it works" scenes)

**Open Doodles** by Pablo Stanley (opendoodles.com) — CC0 1.0
(creativecommons.org/publicdomain/zero/1.0/), "free for commercial and personal use, no
need to credit, license, or anything." Three scenes fetched directly from the project's
S3 asset bucket (`https://opendoodles.s3-us-west-1.amazonaws.com/<name>.svg`), optimized
with `svgo@3` (`--multipass`, `floatPrecision: 1`, viewBox preserved), then recolored: the
source art ships as exactly two fills (`#000000` linework, `#FF5678` accent) per doodle —
each was mapped onto Party Pop tokens (design-party-pop.md §2) as literal hex baked into
the vendored static file (these are public static assets under `apps/web/public/`, not
components — outside the §13 "no raw hex in components/app" grep's scope by design, same
reasoning as any other static image asset).

| File (`apps/web/public/doodles/`) | Source scene name | Recolored accent            | Used for                          |
| ---------------------------------- | ------------------ | ---------------------------- | ---------------------------------- |
| `unboxing.svg`                     | `unboxing`          | `#FFD23F` (`highlight`)      | Landing "how it works" step 1     |
| `selfie.svg`                       | `selfie`             | `#FF4D3D` (`undercover`)     | Landing "how it works" step 2     |
| `groovy.svg`                       | `groovy`             | `#2FA85F` (`success`)        | Landing "how it works" step 3     |

Black linework (`#000000`) was recolored to `#14120B` (`ink`) in all three files. No
gradients, embedded raster, or other fills were present in the source SVGs (verified by
grep before vendoring).

### Archivo Black (vendored TTF, OG image generation only)

`apps/web/src/assets/og-fonts/ArchivoBlack-Regular.ttf` — the SAME font already used
app-wide as `font-display` (see "Font detail" above), OFL 1.1, but vendored a second time
as a raw TTF specifically for `next/og`'s `ImageResponse` (`apps/web/src/lib/og-image.tsx`
and `apps/web/src/app/icon.tsx`). `next/font/google`'s self-hosting isn't reachable from
Satori (the renderer behind `ImageResponse`), which needs raw font bytes passed directly
in its `fonts` option — this is the standard `next/og` local-font pattern (read via
`fs/promises.readFile` at request time, memoized). Fetched from
`https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf`
(`OFL.txt` fetched alongside from the same directory). Space Grotesk was deliberately NOT
vendored for OG images: upstream only ships it as a variable font
(`SpaceGrotesk[wght].ttf`), and Satori does not reliably interpolate variable-font weight
axes — using Archivo Black alone (its type-scale rule is "ALWAYS uppercase" anyway,
design-party-pop.md §3) for every OG card avoids that risk entirely.
