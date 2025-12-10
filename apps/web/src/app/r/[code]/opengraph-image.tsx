import { renderOgImage } from '@/lib/og-image';
import { copy } from '@/copy';

export const alt = copy.marketing.room.metaTitle;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Generic OG image for EVERY room (never leak room info). Does
 * not read the `[code]` route param at all; every room, regardless of code or contents,
 * gets this exact same card.
 */
export default async function Image() {
  return renderOgImage(copy.marketing.room.og);
}
