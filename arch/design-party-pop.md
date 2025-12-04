# Design system — "Party Pop" (v2 visual direction)

> **Status: ACTIVE — supersedes conventions.md §2 ("the notebook") and the motion-library
> choices in §3.** Everything else in conventions.md (§1, §4, §5) still applies unchanged.
> A live visual reference of this direction lives in `mess/sample.html` (archived out of the
> repo root during pre-deploy cleanup — kept locally, out of version control): open it in a
> browser and use the **"A · Party Pop"** tab. (Ignore the "A+B · Spy Pop" tab — that
> option was NOT chosen.)
>
> This document is written to be executed by another model or engineer with **zero
> guessing**. Every color, size, duration, and file path is explicit. If you need a value
> that is not in this document, use §14 "Defaults when unspecified" — do not invent.

---

## §1 The direction in one paragraph

The game is a loud, tactile party object: flat saturated color, thick ink borders, hard
offset shadows (no blur, ever), one chunky display face for shouting and one friendly
grotesque for reading. Elements are slightly rotated like stickers slapped on a table.
Screens are calm and readable; the energy lives in **transitions** (phase color flips,
slam-in interstitials, squash-and-stretch presses) — never in idle decoration. It replaces
the "notebook" hand-drawn system: **no more wobble, no more handwriting fonts, no more
paper grain, no Rough.js.**

Five laws (apply to every screen and every new component):

1. **Everything sits on a border.** Interactive/raised elements get a `3px` solid `ink`
   border. No borderless floating cards, no soft drop shadows.
2. **Shadows are hard and offset.** `box-shadow: Npx Npx 0 <ink>` only. Blur radius is
   always `0`. Pressing an element moves it INTO its shadow (translate + smaller shadow).
3. **Color is flat and semantic.** No gradients anywhere. Role colors mean roles;
   `highlight` yellow means "look here / celebrate"; backgrounds rotate per game phase.
4. **Type is two voices.** `font-display` (Archivo Black) shouts in short uppercase bursts;
   `font-ui` (Space Grotesk) does everything else. There is no third voice (`font-hand` is
   removed).
5. **Screens calm, transitions loud.** Micro-interactions 80–250 ms; drama beats (deal,
   reveal, win) 450–1200 ms; zero idle looping animation during clue/discussion phases
   (conventions.md §3 rule — still in force).

---

## §2 Color tokens

Single source of truth: `packages/config/tailwind-preset.mjs` (Tailwind classes) mirrored
as CSS custom properties in `apps/web/src/app/globals.css` (for the few places SVG/JS needs
a raw value via `paletteVar()` from `apps/web/src/lib/palette-tokens.ts`). **Token NAMES
are unchanged** so existing `bg-paper` / `text-ink` / `text-graphite` class usage keeps
compiling; only VALUES change, plus four new phase tokens.

| Token        | OLD value | **NEW value** | Use                                                                                    |
| ------------ | --------- | ------------- | -------------------------------------------------------------------------------------- |
| `paper`      | `#FAF6EC` | **`#EFEAFF`** | Default app background (lobby, setup, deal/clue phases). Lilac.                        |
| `paper-2`    | `#F3EDDF` | **`#FFFFFF`** | Card / raised surface fill. Cards are pure white now.                                  |
| `ink`        | `#2B2926` | **`#14120B`** | Text, all borders, all hard shadows.                                                   |
| `graphite`   | `#6E6A61` | **`#5C5647`** | Secondary text, disabled, ghost players.                                               |
| `civilian`   | `#3D7BC4` | **`#2F6FF2`** | Civilian blue. Also the primary-button fill.                                           |
| `undercover` | `#C6483F` | **`#FF4D3D`** | Undercover red. Doubles as danger/destructive.                                         |
| `mrwhite`    | `#8B7BC4` | **`#8B5CF6`** | Mr. White violet.                                                                      |
| `highlight`  | `#F5C842` | **`#FFD23F`** | Yellow: selection, current turn, emphasis, celebratory fills (word card, crown chips). |
| `success`    | `#5F9E62` | **`#2FA85F`** | Ready/confirmation fills.                                                              |

New tokens (phase backgrounds — see §10):

| Token           | Value     | Use                                        |
| --------------- | --------- | ------------------------------------------ |
| `phase-discuss` | `#D9F2E2` | Discussion phase background (mint).        |
| `phase-vote`    | `#FFEFB8` | Voting phase background (butter).          |
| `phase-reveal`  | `#FFDCD6` | Reveal / elimination background (salmon).  |

Hard rules:

- **No raw hex in components** (unchanged rule). Hex lives ONLY in
  `tailwind-preset.mjs` + the mirror block in `globals.css`.
- Role/status colors are **fills, not text colors**. Colored text on a light background is
  forbidden below 18 px bold (contrast). State text sits ON a colored chip in `ink` or
  white.
- White text on `civilian`/`undercover`/`mrwhite`/`success` fills: allowed only at
  **≥ 14 px AND bold (700+)** — these pairs pass WCAG AA large-text (≈3.0–4.0:1), not
  normal-text. Anything smaller/lighter on a colored fill must be `ink`.
- `ink` on `paper`, `paper-2`, `highlight`, and all three phase tokens: ≥ 12:1 — always
  safe. `graphite` on `paper`/`paper-2`: ≈ 5.5:1 — safe for normal text.
- Focus indicator changes: `:focus-visible` outline becomes **`3px solid ink`**
  (offset 2px), replacing the old highlight-yellow outline (yellow-on-lilac fails the 3:1
  indicator contrast requirement). This is a global rule in `globals.css` — components
  never override it.

### Exact new `packages/config/tailwind-preset.mjs`

Replace the whole file with:

```js
import plugin from 'tailwindcss/plugin';

/**
 * Shared Tailwind v3 preset — "Party Pop" visual direction.
 * Palette + tokens verbatim from arch/design-party-pop.md §2–§4.
 * Consumers: apps/web/tailwind.config.ts (`presets: [popPreset]`).
 * @type {import('tailwindcss').Config}
 */
const popPreset = {
  theme: {
    extend: {
      colors: {
        paper: '#EFEAFF',
        'paper-2': '#FFFFFF',
        ink: '#14120B',
        graphite: '#5C5647',
        civilian: '#2F6FF2',
        undercover: '#FF4D3D',
        mrwhite: '#8B5CF6',
        highlight: '#FFD23F',
        success: '#2FA85F',
        'phase-discuss': '#D9F2E2',
        'phase-vote': '#FFEFB8',
        'phase-reveal': '#FFDCD6',
      },
      fontFamily: {
        ui: ['var(--font-ui)', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-ui)', 'sans-serif'],
      },
      borderWidth: {
        3: '3px',
      },
      boxShadow: {
        'hard-sm': '3px 3px 0 0 #14120B',
        hard: '5px 5px 0 0 #14120B',
        'hard-lg': '6px 6px 0 0 #14120B',
        'hard-pressed': '1px 1px 0 0 #14120B',
      },
      transitionTimingFunction: {
        snap: 'cubic-bezier(0.2, 1.6, 0.4, 1)',
      },
    },
  },
  plugins: [
    // Halftone dot ground for interstitials / kit panels (design-party-pop.md §9).
    plugin(({ addUtilities }) => {
      addUtilities({
        '.dots': {
          'background-image': 'radial-gradient(rgba(20, 18, 11, 0.14) 1.5px, transparent 1.5px)',
          'background-size': '13px 13px',
        },
      });
    }),
  ],
};

export default popPreset;
```

Notes: the `.wobbly` utility is **deleted** (grep for `wobbly` and remove every usage —
they become `rounded-xl` or `rounded-2xl` per §4). `font-hand` is **deleted** from
`fontFamily` (see §3 for the replacement rule). Update the import name in
`apps/web/tailwind.config.ts` (`sketchyPreset` → `popPreset`).

### Exact new `apps/web/src/app/globals.css`

Replace the whole file with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * Palette tokens as CSS custom properties, mirroring the Tailwind preset
 * (@sketchy/config/tailwind-preset, values verbatim from
 * arch/design-party-pop.md §2). Tailwind utility classes are the source of
 * truth for styling components; these custom properties exist only so
 * SVG/JS surfaces (PopTimerRing arc, avatar ink) can resolve a palette
 * token to a real color via src/lib/palette-tokens.ts. Keep in sync with
 * the preset if a token changes.
 */
:root {
  --color-paper: #efeaff;
  --color-paper-2: #ffffff;
  --color-ink: #14120b;
  --color-graphite: #5c5647;
  --color-civilian: #2f6ff2;
  --color-undercover: #ff4d3d;
  --color-mrwhite: #8b5cf6;
  --color-highlight: #ffd23f;
  --color-success: #2fa85f;
  --color-phase-discuss: #d9f2e2;
  --color-phase-vote: #ffefb8;
  --color-phase-reveal: #ffdcd6;
}

body {
  @apply bg-paper text-ink;
  min-height: 100vh;
}

/*
 * Accessibility baseline (design-party-pop.md §2): focus states always use a
 * 3px ink outline, everywhere, regardless of the element's own styling.
 * (Replaces the old highlight-yellow outline — yellow fails the 3:1 focus
 * indicator contrast requirement on the lilac ground.)
 */
:focus-visible {
  outline: 3px solid var(--color-ink);
  outline-offset: 2px;
}
```

Notes: the `body::before` paper-grain block is **gone** — do not port it. The old
`position: relative` on `body` and the `relative z-10` wrapper in
`apps/web/src/app/layout.tsx` existed only to layer above the grain; remove the wrapper
`div` (keep its children) when touching `layout.tsx`.

`apps/web/src/lib/palette-tokens.ts`: keep the file and the `paletteVar()` helper exactly
as-is, but extend `PALETTE_TOKENS` with `'phase-discuss' | 'phase-vote' | 'phase-reveal'`.

---

## §3 Typography

Two fonts, both OFL 1.1, loaded with `next/font/google` in `apps/web/src/app/layout.tsx`
(Next self-hosts the woff2 at build time — no runtime request to Google; this replaces the
three `next/font/local` blocks):

```tsx
import { Archivo_Black, Space_Grotesk } from 'next/font/google';

const fontUi = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

const fontDisplay = Archivo_Black({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
```

`<html className={...}>` gets `${fontUi.variable} ${fontDisplay.variable}` (the
`fontHand` variable is deleted). Then delete the vendored font directories
`apps/web/src/assets/fonts/{shantell-sans,excalifont,caveat}/` and update `CREDITS.md`
(remove those three entries; add Archivo Black and Space Grotesk, both OFL 1.1, via
Google Fonts / next/font).

| Token          | Font              | Rules                                                                                                                                                                                             |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `font-display` | **Archivo Black** | Wordmark, screen titles, the secret word, big numbers (countdowns, scores), primary-button labels, win headlines. ALWAYS `uppercase`. Usually `tracking-wide` (0.025em+). Never below 14 px. Never for body/paragraph text. |
| `font-ui`      | **Space Grotesk** | Everything else: body, labels, inputs, secondary buttons, player names, clues. Weights: 400 body, 500 emphasized body, 600 secondary-button/label, 700 names & chips.                              |

`font-hand` is **removed**. Mechanical replacement at every usage site (grep `font-hand`):
clue text and other ex-handwritten annotations become `font-ui font-medium italic` (quoted
clues keep their quotation marks from copy); numbers inside the timer ring become
`font-display`.

Type scale (mobile-first; these are the only sizes to use):

| Role                             | Classes                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| Wordmark / win headline          | `font-display text-3xl uppercase tracking-wide` (30 px)            |
| Screen title                     | `font-display text-2xl uppercase tracking-wide` (24 px)            |
| The secret word / giant numbers  | `font-display text-4xl uppercase` (36 px)                          |
| Section label ("Clues so far")   | `font-ui text-xs font-bold uppercase tracking-[0.14em]` (12 px)    |
| Body                             | `font-ui text-base` (16 px)                                        |
| Player name in a row             | `font-ui text-[15px] font-bold`                                    |
| Clue / secondary in a row        | `font-ui text-sm font-medium text-graphite` (14 px)                |
| Chip / tag text                  | `font-ui text-[11px] font-bold uppercase tracking-[0.08em]`        |
| Timer digits                     | `font-ui font-bold tabular-nums` (add `tabular-nums` to ALL timers) |

---

## §4 Shape system — borders, radius, shadow, rotation, press

| Property     | Rule                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Border       | `border-3 border-ink` on every card, button, input, chip, dialog. (The `3` width comes from the preset. Nothing gets a 1px or 2px border.)                          |
| Radius       | Chips/tags: `rounded-lg` (8 px). Buttons, inputs, player rows, small cards: `rounded-xl` (12 px). Hero cards (word card, dialogs, big panels): `rounded-2xl` (16 px). Timer chip: `rounded-lg`. Round things (avatar chips, timer ring): `rounded-full`. |
| Shadow       | Small elements (chips, player rows, inputs, secondary buttons): `shadow-hard-sm`. Primary buttons and mid cards: `shadow-hard`. Hero cards & dialogs: `shadow-hard-lg`. Pressed state: `shadow-hard-pressed`. Never any other shadow, never blur. |
| Rotation     | Sticker energy — used sparingly and statically: the hero/word card `-rotate-1`; at most ONE accent element per screen additionally rotated (`rotate-1` or `-rotate-2`). Player rows are NOT rotated at rest; special-state rows (current speaker, eliminated) may take `rotate-1`/`-rotate-1`. Never rotate body text blocks or inputs. |
| Press (JUICE)| Interactive elements move into their shadow on `:active`: `active:translate-x-[4px] active:translate-y-[4px] active:shadow-hard-pressed` (for `shadow-hard` elements) or `active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed` (for `shadow-hard-sm`). Transition: `transition-[transform,box-shadow] duration-[80ms]`. |
| Hover        | Cards/buttons: `hover:-translate-y-0.5` (and optionally `hover:-rotate-1` on buttons), `duration-150 ease-out`. Never hover effects on non-interactive elements. |

---

## §5 Component primitives — `apps/web/src/components/pop/`

The directory `apps/web/src/components/sketch/` is **renamed to
`apps/web/src/components/pop/`**, components renamed `Sketch*` → `Pop*`, and every import
updated (grep `components/sketch`; the usage list is in §12). API changes are minimal and
listed per component. `apps/web/src/components/sketch/sketch.tsx` (the Rough.js wrapper) is
**deleted with no replacement** — nothing draws SVG borders anymore; borders are CSS.

**Reference implementations below are normative** — transcribe them (adjusting only
imports/lint nits), do not redesign them.

### 5.1 `pop-button.tsx` — `PopButton` (replaces `SketchButton`)

API: same as `SketchButton` but `variant` gains `'accent' | 'danger'`. No `seed` (there
was none). Keep `forwardRef`, keep cva.

```tsx
'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import clsx from 'clsx';

const popButtonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2',
    'rounded-xl border-3 border-ink',
    'transition-[transform,box-shadow] duration-[80ms] ease-out',
    'hover:-translate-y-0.5',
    'disabled:cursor-not-allowed disabled:border-graphite disabled:bg-paper-2',
    'disabled:text-graphite disabled:shadow-none disabled:hover:translate-y-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'bg-civilian text-white shadow-hard',
          'font-display uppercase tracking-wide',
          'active:translate-x-[4px] active:translate-y-[4px] active:shadow-hard-pressed',
        ].join(' '),
        accent: [
          'bg-highlight text-ink shadow-hard',
          'font-display uppercase tracking-wide',
          'active:translate-x-[4px] active:translate-y-[4px] active:shadow-hard-pressed',
        ].join(' '),
        danger: [
          'bg-undercover text-white shadow-hard',
          'font-display uppercase tracking-wide',
          'active:translate-x-[4px] active:translate-y-[4px] active:shadow-hard-pressed',
        ].join(' '),
        secondary: [
          'bg-paper-2 text-ink shadow-hard-sm font-ui font-semibold',
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
        ].join(' '),
      },
      size: {
        md: 'px-5 py-3 text-base',
        lg: 'px-7 py-4 text-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface PopButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof popButtonVariants> {
  children: ReactNode;
}

/**
 * The button primitive for the whole app (design-party-pop.md §5.1). A real
 * `<button>`; the label is a plain DOM text node so it stays selectable,
 * translatable and screen-reader visible.
 */
export const PopButton = forwardRef<HTMLButtonElement, PopButtonProps>(function PopButton(
  { children, className, variant, size, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(popButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
});
```

Variant mapping at existing call sites: old `primary` (yellow hachure fill) → new
`primary` (blue) for the screen's main action, EXCEPT celebratory/reveal CTAs ("Reveal",
"Show my word", "Play again") which become `accent` (yellow). Old `secondary` → new
`secondary`. Destructive actions (kick player, delete pack, leave room) → `danger`.

### 5.2 `pop-card.tsx` — `PopCard` (replaces `SketchCard`)

API change: **`seed` prop is deleted** (it only fed the wobble). New optional
`tone?: 'raised' | 'hero'` (default `'raised'`).

```tsx
import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export interface PopCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  /** 'raised' = standard white card; 'hero' = the screen's one big yellow moment. */
  tone?: 'raised' | 'hero';
}

/**
 * Raised surface (design-party-pop.md §5.2). 'hero' is reserved for the one
 * headline card per screen (secret word, room code) — yellow, bigger shadow,
 * sticker tilt.
 */
export function PopCard({ children, className, tone = 'raised', ...props }: PopCardProps) {
  return (
    <div
      {...props}
      className={clsx(
        'border-3 border-ink p-6',
        tone === 'raised' && 'rounded-xl bg-paper-2 shadow-hard-sm',
        tone === 'hero' && '-rotate-1 rounded-2xl bg-highlight shadow-hard-lg',
        className,
      )}
    >
      {children}
    </div>
  );
}
```

At call sites: delete the `seed` prop; the card previously wrapping the screen's headline
moment (peek word, room code hero) gets `tone="hero"`.

### 5.3 `pop-input.tsx` — `PopInput` (replaces `SketchInput`)

Same API (`label` required). Label restyles to the §3 section-label treatment.

```tsx
'use client';

import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';

export interface PopInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label — required; every input must be labelled (conventions.md §4). */
  label: string;
}

/**
 * Labelled text input (design-party-pop.md §5.3). Focus styling comes from
 * the global `:focus-visible` rule (globals.css) — never overridden here.
 */
export const PopInput = forwardRef<HTMLInputElement, PopInputProps>(function PopInput(
  { label, className, id, ...props },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink"
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={clsx(
          'w-full rounded-xl border-3 border-ink bg-paper-2 px-4 py-3',
          'font-ui font-medium text-ink shadow-hard-sm placeholder:text-graphite',
          className,
        )}
        {...props}
      />
    </div>
  );
});
```

### 5.4 `pop-dialog.tsx` — `PopDialog` (replaces `SketchDialog`)

Same API (`open`, `onOpenChange`, `title`, `description?`, `children?`, `trigger?`,
`closeLabel`). Radix still owns a11y. Restyle only:

- `Dialog.Overlay`: `fixed inset-0 z-40 bg-ink/50`
- `Dialog.Content`: `fixed left-1/2 top-1/2 z-50 w-[min(90vw,28rem)] -translate-x-1/2
  -translate-y-1/2 rounded-2xl border-3 border-ink bg-paper-2 p-6 shadow-hard-lg`
- `Dialog.Title`: `pr-10 font-display text-2xl uppercase tracking-wide text-ink`
- `Dialog.Description`: `font-ui text-graphite`
- Close button: a 40×40 chip —
  `absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-lg
  border-3 border-ink bg-paper-2 text-ink shadow-hard-sm transition-transform
  duration-150 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]
  active:shadow-hard-pressed` with `<IconCross className="h-4 w-4" />` inside. Delete the
  old `hover:rotate-12`.
- Delete the `<Sketch>` element and its import.

### 5.5 `pop-timer-ring.tsx` — `PopTimerRing` (replaces `SketchTimerRing`)

API change: **`seed` prop deleted**; everything else identical
(`progress`, `color: PaletteToken`, `size?`, `children?`).

```tsx
import type { ReactNode } from 'react';
import { paletteVar, type PaletteToken } from '@/lib/palette-tokens';

export interface PopTimerRingProps {
  /** Fraction of the ring already elapsed, 0–1. */
  progress: number;
  /** Palette token for the progress arc — never a raw hex. */
  color: PaletteToken;
  /** Ring diameter in px. */
  size?: number;
  /** Centered slot — e.g. the countdown number. */
  children?: ReactNode;
}

/**
 * Timer ring (design-party-pop.md §5.5): a plain 3px ink circle (the track)
 * with a 6px progress arc in the given token color, hard-shadowed white disc
 * behind, display-face digits in the middle.
 */
export function PopTimerRing({ progress, color, size = 120, children }: PopTimerRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const track = 3;
  const arc = 6;
  const radius = size / 2 - arc;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center rounded-full border-3 border-ink bg-paper-2 shadow-hard-sm"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={paletteVar('ink')}
          strokeOpacity={0.12}
          strokeWidth={track}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={paletteVar(color)}
          strokeWidth={arc}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="relative z-10 flex items-center justify-center font-display text-ink">
        {children}
      </div>
    </div>
  );
}
```

### 5.6 NEW `icon-chip.tsx` — `IconChip`

New primitive in `apps/web/src/components/pop/`. Tappable icons never float bare — they
sit in a sticker chip (see §6 rules).

```tsx
import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export interface IconChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** 'plain' white, 'accent' yellow (celebration), 'danger' red (destructive). */
  tone?: 'plain' | 'accent' | 'danger';
}

/** Sticker chip container for icons (design-party-pop.md §5.6 / §6). Purely
 * presentational — when the chip is a button, wrap it: the parent `<button>`
 * carries the interaction and this stays a `<span>`. */
export function IconChip({ children, className, tone = 'plain', ...props }: IconChipProps) {
  return (
    <span
      {...props}
      className={clsx(
        'inline-flex h-10 w-10 items-center justify-center rounded-lg border-3 border-ink shadow-hard-sm',
        tone === 'plain' && 'bg-paper-2 text-ink',
        tone === 'accent' && 'bg-highlight text-ink',
        tone === 'danger' && 'bg-undercover text-white',
        className,
      )}
    >
      {children}
    </span>
  );
}
```

---

## §6 Icons — `apps/web/src/components/icons/`

Current state: 20 vendored "Doodle Icons" components (CC0, solid `fill="currentColor"`
paths, assorted viewBoxes like `0 0 150 87`). **All 20 are redrawn in place.** File names,
exported component names, and the `(props: SVGProps<SVGSVGElement>)` API stay EXACTLY the
same — only the SVG contents change, so no call site breaks.

The new icon contract (every icon, no exceptions):

```tsx
<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth={2.5}
  strokeLinecap="round"
  strokeLinejoin="round"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  {...props}
>
  {/* paths */}
</svg>
```

Geometry source — do not invent shapes: use **Lucide** (lucide.dev, ISC license) path data
for each icon, rendered at `strokeWidth={2.5}` instead of Lucide's default 2. Copy the
`<path>`/`<circle>`/`<rect>`/etc. children verbatim from the named Lucide icon. Mapping:

| File                  | Export          | Lucide icon name       |
| --------------------- | --------------- | ---------------------- |
| `icon-arrow-right.tsx`| `IconArrowRight`| `arrow-right`          |
| `icon-ballot.tsx`     | `IconBallot`    | `vote`                 |
| `icon-book.tsx`       | `IconBook`      | `book-open`            |
| `icon-chat.tsx`       | `IconChat`      | `message-circle`       |
| `icon-check.tsx`      | `IconCheck`     | `check`                |
| `icon-copy.tsx`       | `IconCopy`      | `copy`                 |
| `icon-cross.tsx`      | `IconCross`     | `x`                    |
| `icon-crown.tsx`      | `IconCrown`     | `crown`                |
| `icon-eye.tsx`        | `IconEye`       | `eye`                  |
| `icon-ghost.tsx`      | `IconGhost`     | `ghost`                |
| `icon-home.tsx`       | `IconHome`      | `house`                |
| `icon-link.tsx`       | `IconLink`      | `link`                 |
| `icon-pencil.tsx`     | `IconPencil`    | `pencil`               |
| `icon-play.tsx`       | `IconPlay`      | `play`                 |
| `icon-question.tsx`   | `IconQuestion`  | `circle-help`          |
| `icon-refresh.tsx`    | `IconRefresh`   | `refresh-cw`           |
| `icon-settings.tsx`   | `IconSettings`  | `sliders-horizontal`   |
| `icon-timer.tsx`      | `IconTimer`     | `timer`                |
| `icon-trash.tsx`      | `IconTrash`     | `trash-2`              |
| `icon-users.tsx`      | `IconUsers`     | `users`                |

Update each file's doc comment (attribution: "Geometry from Lucide (lucide.dev), ISC —
see CREDITS.md; rendered at 2.5px stroke per design-party-pop.md §6") and swap the
Doodle-Icons entry in `CREDITS.md` for Lucide (ISC).

Usage rules:

- Inline beside text: bare icon, `h-4 w-4` (or `h-5 w-5` next to `text-base`), same
  `currentColor` as the text.
- Tappable / standalone: wrap in `IconChip` (§5.6), icon `h-5 w-5`.
- Never scale an icon above `h-8 w-8` — for bigger art moments use type or layout, not a
  blown-up UI icon.

---

## §7 Motion

Replaces the library choices in conventions.md §3 (**vivus.js, excalidraw-animate, and
react-rough-notation are all removed** — stroke-drawing animation makes no sense without
hand-drawn strokes). The §3 RULES survive: micro 150–250 ms, drama beats limited to
deal/reveal/win, `prefers-reduced-motion` always respected (fade instead of move, never
remove information), no idle loops during clue/discussion.

The Party Pop motion vocabulary (CSS-only, no new dependencies):

| Name        | Spec                                                                                                        | Used for                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Press       | `active:` translate into shadow, 80 ms (see §4)                                                              | every button/chip                                            |
| Lift        | `hover:-translate-y-0.5`, 150 ms ease-out                                                                     | buttons, interactive cards                                   |
| **Slam**    | keyframes from `scale(2.2) rotate(-14deg) opacity-0` to `scale(1) rotate(-3deg) opacity-1`, **450 ms**, easing `snap` (`cubic-bezier(0.2, 1.6, 0.4, 1)`, in the preset) | interstitial titles, win headline, "OUT" tags appearing      |
| **Pop-in**  | keyframes from `scale(1.6)` to `scale(1)`, 500 ms `snap`                                                      | countdown digits, score bumps                                |
| Flip        | phase background color change: `transition-colors duration-300` on the screen wrapper                        | phase changes (§10)                                          |
| Confetti    | existing fall pattern, restyled pieces (§8)                                                                   | win screen only                                              |

Replacements for the two `react-rough-notation` usage sites (then remove the dependency):

- `components/room/player-strip.tsx` (circling the current speaker): the speaker's row/chip
  instead flips to `bg-civilian text-white` with `rotate-1` (see the "SPEAKING" row in
  `sample.html` tab A), transition 150 ms.
- `components/pnp/win-screen.tsx` (underline/emphasis on the winner): winner name gets a
  highlight block instead — wrap in
  `<span className="inline-block -rotate-1 rounded-lg bg-highlight px-2">`.

---

## §8 Confetti — `apps/web/src/components/pnp/scribble-confetti.tsx`

Keep the file, the deterministic seeded layout, the `count` prop, the reduced-motion
fallback, and the keyframes exactly as they are. Change ONLY the pieces from scribble
strokes to flat geometric stickers: replace the `SHAPES` path array + `<path>` rendering
with index-cycled `<rect x="4" y="4" width="16" height="16" rx="3">` /
`<circle cx="12" cy="12" r="8">` / triangle `<path d="M12 4 L20 20 L4 20 Z">`, each
`fill="currentColor"` `stroke="none"`, keeping the existing `COLOR_CLASSES` token cycling
(`text-civilian` etc.). Rename nothing.

---

## §9 Texture

- Paper grain (`body::before` feTurbulence) — **deleted**, no replacement on the body.
- The `.dots` utility (halftone dot grid, in the preset) is the only texture. Allowed on:
  interstitial/overlay backgrounds, empty states, the win screen ground. Never behind
  body text paragraphs, never on cards holding form controls.

---

## §10 Phase backgrounds (the "never one color" rule)

The full-screen wrapper of each game screen sets a background token +
`transition-colors duration-300`. Mapping (both pass-and-play `components/pnp/*` and
online `components/room/game/*`):

| Screen / phase                                          | Background class    |
| ------------------------------------------------------- | ------------------- |
| Home, lobby, setup, name prompts, join gate             | `bg-paper`          |
| Deal / peek / clue-giving screens                       | `bg-paper`          |
| Discussion screens                                      | `bg-phase-discuss`  |
| Vote screens                                            | `bg-phase-vote`     |
| Reveal / elimination / Mr. White guess screens          | `bg-phase-reveal`   |
| Win screen                                              | winning-faction color as a full-bleed takeover: `bg-civilian`, `bg-undercover`, or `bg-mrwhite`, with `.dots` overlay allowed and white/`highlight` display type per §2 contrast rules |
| Pass interstitial (pass-and-play hand-off)              | `bg-ink`, white + `highlight` type, next player's name in `font-display text-4xl` with the Slam animation |

---

## §11 Signature moments (restyle, keep every mechanic)

- **Peek card** (`components/pnp/peek-card.tsx`): THE identity moment. The word card is
  `PopCard tone="hero"` (yellow, `-rotate-1`, `shadow-hard-lg`); label
  "your secret word" in section-label style; the word itself
  `font-display text-4xl uppercase`. Keep the existing peek/hold/toggle reveal mechanics
  and a11y exactly as implemented — restyle surfaces only.
- **Room code hero** (`components/room/room-code-hero.tsx`): the code becomes the lobby's
  hero sticker — `PopCard tone="hero"` with `font-display text-4xl tracking-[0.12em]`,
  copy-link button as `PopButton variant="secondary"` with `IconLink` inline.
- **Eliminated players** (player strips, vote/reveal screens): row goes
  `bg-undercover text-white -rotate-1` with an `ink` tag chip reading the role (e.g.
  "OUT · UNDERCOVER" — text from `copy.ts`, style:
  `rounded-lg bg-ink px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white`).
  See the Zoe row in `sample.html` tab A.
- **Current speaker**: `bg-civilian text-white rotate-1` row (never color-only — keep
  whatever icon/label the component already renders alongside).
- **Toasts** (`components/room/toasts.tsx`): white `rounded-xl border-3 border-ink
  shadow-hard` cards sliding in with the Slam easing (translate + settle, 250 ms).
- **Avatars** (`components/avatar/avatar-doodle.tsx` + `avatar-config.ts`): Open Peeps
  line art is KEPT (figurative illustration reads fine inside Party Pop). Each avatar
  renders inside a sticker circle: `rounded-full border-3 border-ink bg-paper-2
  shadow-hard-sm`. If `AVATAR_INK_COLORS` in `avatar-config.ts` contains any of the OLD
  palette hexes, update them to the §2 replacements; if it references tokens, no change.

---

## §12 File-by-file migration map

Design-system files (the mechanism):

| File                                                | Action                                                        |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `packages/config/tailwind-preset.mjs`               | Replace with §2 code                                          |
| `apps/web/tailwind.config.ts`                       | Rename imported preset binding                                |
| `apps/web/src/app/globals.css`                      | Replace with §2 code                                          |
| `apps/web/src/app/layout.tsx`                       | §3 fonts; drop `fontHand`; remove grain-era `relative z-10` wrapper div |
| `apps/web/src/lib/palette-tokens.ts`                | Add 3 phase tokens to `PALETTE_TOKENS`                        |
| `apps/web/src/components/sketch/` → `components/pop/` | Rename dir; components per §5; DELETE `sketch.tsx`; keep `sketch-button.test.tsx` renamed `pop-button.test.tsx` with assertions updated to the new classes/API |
| `apps/web/src/components/icons/*` (20 files)        | Redraw per §6                                                 |
| `apps/web/src/components/pnp/scribble-confetti.tsx` | Pieces per §8                                                 |
| `apps/web/package.json`                             | Remove `roughjs` + `react-rough-notation` deps (`pnpm install` after) |
| `apps/web/src/assets/fonts/*`                       | Delete all three font dirs                                    |
| `CREDITS.md`                                        | Fonts + icons + removed libs per §3/§6                        |
| `arch/conventions.md`                               | §2/§3 already annotated as superseded — leave as is           |

Consumer files (every one imports the primitives, uses `wobbly`, `font-hand`, or
`rough-notation` — restyle each against §3–§11; this list was generated by grep and is
exhaustive as of 2026-07-09):

`app/page.tsx` · `app/r/[code]/page.tsx` · `components/name-prompt-card.tsx` ·
`components/play-on-this-phone-button.tsx` · `components/session-boot.tsx` (check only) ·
`components/game/clue-board.tsx` · `components/room/join-a-room-form.tsx` ·
`components/room/cheat-sheet-card.tsx` · `components/room/create-a-room-button.tsx` ·
`components/room/settings-drawer.tsx` · `components/room/room-code-hero.tsx` ·
`components/room/ready-bar.tsx` · `components/room/chat-drawer.tsx` ·
`components/room/join-gate.tsx` · `components/room/player-strip.tsx` ·
`components/room/lobby-screen.tsx` · `components/room/toasts.tsx` ·
`components/room/game/game-screen.tsx` · `components/room/game/deal-screen.tsx` ·
`components/room/game/clue-screen.tsx` · `components/room/game/discussion-screen.tsx` ·
`components/room/game/status-strip.tsx` · `components/room/game/voting-placeholder.tsx` ·
`components/avatar/avatar-picker.tsx` · `components/avatar/avatar-doodle.tsx` ·
`components/pnp/setup-screen.tsx` · `components/pnp/peek-card.tsx` ·
`components/pnp/pass-interstitial.tsx` · `components/pnp/clue-screen.tsx` ·
`components/pnp/discussion-screen.tsx` · `components/pnp/vote-screen.tsx` ·
`components/pnp/reveal-screen.tsx` · `components/pnp/mrwhite-screen.tsx` ·
`components/pnp/win-screen.tsx` · `components/pnp/interlude-overlay.tsx` ·
`components/pnp/resume-prompt.tsx`

Explicitly NOT touched: `packages/engine/*`, `packages/shared/*`, `apps/api/*`,
`apps/web/src/copy.ts` (copy is a separate concern — do not rewrite strings),
`apps/web/src/stores/*`, `apps/web/src/lib/socket.ts`, `apps/web/src/lib/api-*`, all
`*.test.ts(x)` semantics (update style/class assertions only), `apps/web/e2e/*`
(they assert on roles/labels — they must pass unmodified; if one fails, the regression is
in your change, not the test).

---

## §13 Verification (definition of done for any change under this doc)

1. `pnpm lint && pnpm typecheck && pnpm test` green at repo root (conventions.md §5).
2. `pnpm --filter @sketchy/web test:e2e` green, unmodified.
3. `grep -rn "wobbly\|font-hand\|roughjs\|rough-notation\|Sketch" apps/web/src` returns
   nothing (case-sensitive `Sketch` — the `@sketchy/*` package scope stays and is fine).
4. `grep -rn "#[0-9a-fA-F]\{6\}" apps/web/src/components apps/web/src/app` returns no NEW
   raw hex (allowed: none — tokens only).
5. Manual pass on mobile viewport (390×844): home → create room → lobby, and home → play
   on this phone → deal → clue → discussion → vote → reveal → win. Every screen shows:
   white cards / 3px ink borders / hard shadows / correct phase background / no serif or
   handwriting glyph anywhere / focus outline visible when tabbing.

## §14 Defaults when unspecified

If a surface or state has no explicit spec in this document: white (`paper-2`) container,
`border-3 border-ink`, `rounded-xl`, `shadow-hard-sm`, `font-ui` text at §3 scale, no
rotation, no animation beyond Press/Lift, background inherited from the screen's phase
token. If two rules seem to conflict, the more specific section wins; if still ambiguous,
choose the QUIETER option (Party Pop's loudness lives in designated moments, not
everywhere) and leave a `// TODO(design)` comment naming this section.
