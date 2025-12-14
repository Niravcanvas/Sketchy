import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

/**
 * Sitemap. Scope is deliberately the marketing surface only:
 * `/`, `/about`, `/faq`, plus `/how-to-play` (linked from nav/footer).
 *
 * `/privacy` + `/terms` are DRAFT and carry `noindex`, so they're intentionally omitted
 * here — a sitemap must not advertise noindex'd URLs. Re-add them once the draft banner
 * is cleared and they're flipped indexable.
 *
 * Deliberately EXCLUDED, as a scope judgment call:
 * `/play`, `/packs`, `/packs/[id]`, `/profile` are app surfaces, not marketing content.
 * `/r/[code]` is excluded per the explicit
 * "never index room info" rule (also enforced by its own `noindex` in
 * `app/r/[code]/layout.tsx` and by `robots.ts` below).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const now = new Date();

  const routes: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }> = [
    { path: '', changeFrequency: 'weekly', priority: 1 },
    { path: '/how-to-play', changeFrequency: 'monthly', priority: 0.8 },
    { path: '/about', changeFrequency: 'monthly', priority: 0.6 },
    { path: '/faq', changeFrequency: 'monthly', priority: 0.6 },
  ];

  return routes.map(({ path, changeFrequency, priority }) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
