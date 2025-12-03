import { copy } from '@/copy';
import { getSiteUrl } from '@/lib/site-url';

/**
 * Structured data for the landing page ("VideoGame or
 * SoftwareApplication (+ Organization) on the landing"). `VideoGame` is the more precise
 * schema.org type for a rules-based multiplayer party game; `Organization` gives search
 * engines a brand entity to attach to. Both objects describe ONLY the core game
 * (system-design.md §0 modes: pass-and-play + private online rooms) — deliberately no
 * mention of accounts, matchmaking, or voice, keeping this scoped to the game itself
 * rather than every feature.
 */
export function LandingJsonLd() {
  const siteUrl = getSiteUrl();

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoGame',
        name: copy.brand.name,
        description: copy.brand.oneLineDescription,
        url: siteUrl,
        genre: 'Party game, social deduction',
        playMode: 'MultiPlayer',
        numberOfPlayers: {
          '@type': 'QuantitativeValue',
          minValue: 3,
          maxValue: 20,
        },
        applicationCategory: 'Game',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
      {
        '@type': 'Organization',
        name: copy.brand.name,
        url: siteUrl,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON-LD must be a raw <script> body; the payload above is fully server-constructed
      // from copy.ts/site-url.ts, never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
