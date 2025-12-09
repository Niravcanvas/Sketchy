import { renderOgImage } from '@/lib/og-image';
import { copy } from '@/copy';

export const alt = copy.marketing.faq.meta.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** OG image for `/faq`. */
export default async function Image() {
  return renderOgImage(copy.marketing.faq.og);
}
