import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

/**
 * Robots directives. `/r/` is disallowed here as belt-and-braces
 * on top of the per-route `noindex` in `app/r/[code]/layout.tsx` — a crawler that ignores
 * `noindex` (some do) still shouldn't be fetching room pages at all.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/r/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
