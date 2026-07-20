import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { copy } from '@/copy';

/**
 * Shared "Party-Pop card mock" OG image renderer (design-party-pop.md §1–§4). Every
 * marketing route's `opengraph-image.tsx` calls this with its
 * own eyebrow/title/subtitle (arch/copy.md §16.7) so every page gets a genuinely
 * distinct, correctly-titled social card instead of one generic image reused everywhere.
 *
 * RAW HEX EXCEPTION, DELIBERATE AND SCOPED: design-party-pop.md §2 bans raw hex in
 * components/app files and mandates `paletteVar()` (a CSS custom property, e.g.
 * `var(--color-ink)`) for the few JS/SVG surfaces that need a real color value. Satori
 * (the renderer behind `next/og`'s `ImageResponse`) does not run in a browser and cannot
 * resolve CSS custom properties — only literal values work. The tokens below are
 * therefore mirrored as literal hex, verbatim from design-party-pop.md §2, ONLY in this
 * file (which lives outside `apps/web/src/components` and `apps/web/src/app`, so the
 * §13 grep for raw hex still passes). If a palette token ever changes, update both
 * places. Exported (not just local consts) so `app/icon.tsx` — the one other Satori
 * render site, which unavoidably lives under `apps/web/src/app` — can reuse these
 * instead of also hardcoding hex there.
 */
export const OG_INK = '#14120B';
export const OG_PAPER_2 = '#FFFFFF';
export const OG_HIGHLIGHT = '#FFD23F';
export const OG_CIVILIAN = '#2F6FF2';
export const OG_UNDERCOVER = '#FF4D3D';
export const OG_SUCCESS = '#2FA85F';

const WIDTH = 1200;
const HEIGHT = 630;

// cwd is apps/web for `next build`/`next dev` (pnpm --filter runs scripts from
// the package directory, including at prerender time) but the Docker WORKDIR
// (the monorepo root layout `.next/standalone` preserves) for a dynamic route
// rendered per-request by the running container — so try both rather than
// assume one. (import.meta.url doesn't help here: Next's webpack bundling
// bakes it into the compiled chunk as the build stage's absolute source path,
// which doesn't exist in the runtime image, and `new URL(..., import.meta.url)`
// asset-inlining resolves to a request-relative `/_next/static/...` path that
// plain fetch() can't resolve outside a browser.)
const FONT_RELATIVE_PATH = 'src/assets/og-fonts/ArchivoBlack-Regular.ttf';
const FONT_PATH_CANDIDATES = [
  join(process.cwd(), FONT_RELATIVE_PATH),
  join(process.cwd(), 'apps/web', FONT_RELATIVE_PATH),
];

let archivoBlackPromise: Promise<Buffer> | null = null;

async function readArchivoBlack(): Promise<Buffer> {
  for (const candidate of FONT_PATH_CANDIDATES) {
    try {
      return await readFile(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Archivo Black font not found (tried: ${FONT_PATH_CANDIDATES.join(', ')})`);
}

/** Memoized so a burst of OG requests (crawlers, link unfurl retries) reads the
 * vendored font file from disk once, not once per request. */
function loadArchivoBlack(): Promise<Buffer> {
  archivoBlackPromise ??= readArchivoBlack();
  return archivoBlackPromise;
}

export interface OgImageContent {
  eyebrow: string;
  title: string;
  subtitle: string;
}

/**
 * Renders the shared OG card. `title` should stay short (≈1–4 words) — it's set in a
 * huge display size and will overflow the card past that. Never pass user-controlled or
 * per-room data here (arch/copy.md §16.7 — room cards stay fully generic).
 */
export async function renderOgImage({ eyebrow, title, subtitle }: OgImageContent) {
  const archivoBlack = await loadArchivoBlack();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          backgroundColor: OG_INK,
          padding: '72px',
          fontFamily: 'Archivo Black',
        }}
      >
        {/* Flat sticker accent shapes — texture without gradients/blur (design-party-pop.md §1). */}
        <div
          style={{
            position: 'absolute',
            top: 56,
            right: 88,
            width: 90,
            height: 90,
            borderRadius: 18,
            backgroundColor: OG_CIVILIAN,
            transform: 'rotate(8deg)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 64,
            right: 200,
            width: 56,
            height: 56,
            borderRadius: 999,
            backgroundColor: OG_SUCCESS,
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 96,
            left: 64,
            width: 64,
            height: 64,
            borderRadius: 14,
            backgroundColor: OG_UNDERCOVER,
            transform: 'rotate(-10deg)',
            display: 'flex',
          }}
        />

        {/* The hero card — same visual language as PopCard tone="hero" (design-party-pop.md §5.2). */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            width: 920,
            backgroundColor: OG_HIGHLIGHT,
            border: `10px solid ${OG_INK}`,
            borderRadius: 32,
            boxShadow: `20px 20px 0 0 ${OG_INK}`,
            transform: 'rotate(-1.5deg)',
            padding: '56px 64px',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              letterSpacing: 4,
              color: OG_INK,
              textTransform: 'uppercase',
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 84,
              lineHeight: 1.05,
              color: OG_INK,
              textTransform: 'uppercase',
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: 'flex',
              backgroundColor: OG_PAPER_2,
              border: `6px solid ${OG_INK}`,
              borderRadius: 14,
              padding: '14px 22px',
              fontSize: 26,
              color: OG_INK,
              textTransform: 'uppercase',
              alignSelf: 'flex-start',
            }}
          >
            {subtitle}
          </div>
        </div>

        {/* Wordmark tag, bottom-left, outside the card. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            bottom: 56,
            left: 72,
            fontSize: 22,
            letterSpacing: 3,
            color: OG_HIGHLIGHT,
            textTransform: 'uppercase',
          }}
        >
          {copy.brand.name}
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [{ name: 'Archivo Black', data: archivoBlack, weight: 400, style: 'normal' }],
    },
  );
}
