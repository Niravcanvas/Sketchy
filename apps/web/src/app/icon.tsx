import { ImageResponse } from 'next/og';
import { OG_HIGHLIGHT, OG_INK } from '@/lib/og-image';
import { copy } from '@/copy';

/**
 * Favicon (Next's `app/icon.tsx` file convention — auto-wires `<link rel="icon">`).
 * A minimal Party-Pop sticker: ink-bordered highlight square, the brand's first letter.
 *
 * Color values come from `lib/og-image.tsx`'s exported `OG_INK`/`OG_HIGHLIGHT` rather
 * than being hardcoded here — this file lives under `apps/web/src/app`, which the §13
 * raw-hex grep scans, so the literal hex values stay confined to `lib/og-image.tsx`
 * (outside `components`/`app`, see that file's doc comment for the full rationale: Satori
 * can't resolve the app's normal `paletteVar()` CSS-custom-property indirection).
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: OG_HIGHLIGHT,
          border: `3px solid ${OG_INK}`,
          borderRadius: 7,
          color: OG_INK,
          fontSize: 20,
          fontWeight: 700,
        }}
      >
        {copy.brand.name.slice(0, 1)}
      </div>
    ),
    { ...size },
  );
}
