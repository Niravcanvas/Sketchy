import { renderOgImage } from '@/lib/og-image';
import { copy } from '@/copy';

export const alt = copy.marketing.landing.meta.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * OG image for `/` ("Party-Pop card mock"). See
 * `lib/og-image.tsx` for the shared renderer and its documented raw-hex exception.
 */
export default async function Image() {
  return renderOgImage(copy.marketing.landing.og);
}
