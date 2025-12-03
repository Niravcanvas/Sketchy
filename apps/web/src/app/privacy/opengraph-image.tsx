import { renderOgImage } from '@/lib/og-image';
import { copy } from '@/copy';

export const alt = copy.marketing.privacy.meta.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** OG image for `/privacy`. */
export default async function Image() {
  return renderOgImage(copy.marketing.privacy.og);
}
