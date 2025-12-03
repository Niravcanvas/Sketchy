import { copy } from '@/copy';

/**
 * `FAQPage` structured data for `/faq`. Built from the SAME
 * `copy.marketing.faq.items` array the visible page renders, so the structured data can
 * never drift from what a visitor actually sees (a schema.org/Google rich-results
 * requirement, not just good hygiene).
 */
export function FaqJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: copy.marketing.faq.items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      // Server-constructed JSON-LD only (built from copy.ts above) — never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
