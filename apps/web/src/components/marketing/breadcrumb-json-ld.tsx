import { getSiteUrl } from '@/lib/site-url';
import { copy } from '@/copy';

/**
 * `BreadcrumbList` structured data for the one-level-deep marketing pages
 * (`/about`, `/faq`, `/privacy`, `/terms` — "BreadcrumbList
 * where sensible"). The landing page itself has no breadcrumb (it IS the root).
 */
export function BreadcrumbJsonLd({ pageName, path }: { pageName: string; path: string }) {
  const siteUrl = getSiteUrl();

  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: copy.brand.name,
        item: siteUrl,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: pageName,
        item: `${siteUrl}${path}`,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // Server-constructed JSON-LD only (built from copy.ts/site-url.ts) — never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
