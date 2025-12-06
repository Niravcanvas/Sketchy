import type { Metadata } from 'next';
import Link from 'next/link';
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-json-ld';
import { FaqJsonLd } from '@/components/marketing/faq-json-ld';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: copy.marketing.faq.meta.title,
  description: copy.marketing.faq.meta.description,
  alternates: { canonical: '/faq' },
  openGraph: {
    title: copy.marketing.faq.meta.title,
    description: copy.marketing.faq.meta.description,
    url: '/faq',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.marketing.faq.meta.title,
    description: copy.marketing.faq.meta.description,
  },
};

/**
 * `/faq` — arch/copy.md §16.4. Rendered as a plain
 * server-rendered list rather than a client-side accordion: every answer is visible to a
 * first-time visitor AND a crawler with zero JS, and the same `copy.marketing.faq.items`
 * array feeds `FaqJsonLd` — visible content and structured data can never drift apart.
 */
export default function FaqPage() {
  return (
    <MarketingPageShell>
      <BreadcrumbJsonLd pageName={copy.marketing.faq.meta.title} path="/faq" />
      <FaqJsonLd />
      <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
        {copy.marketing.faq.title}
      </h1>
      <p className="font-ui text-base text-graphite">{copy.marketing.faq.intro}</p>
      <dl className="flex flex-col gap-4">
        {copy.marketing.faq.items.map((item) => (
          <div
            key={item.question}
            className="flex flex-col gap-2 rounded-xl border-3 border-ink bg-paper-2 p-5 shadow-hard-sm"
          >
            <dt className="font-ui text-base font-bold text-ink">{item.question}</dt>
            <dd className="font-ui text-sm text-graphite">
              {item.answer}
              {/* A single answer may carry a trailing link (e.g. → /community);
                  rendered as an inline anchor so the plain-text `answer` still feeds
                  `FaqJsonLd` untouched. `'link' in item` narrows the readonly union. */}
              {'link' in item ? (
                <>
                  {' '}
                  <Link
                    href={item.link.href}
                    className="font-ui text-sm font-bold text-graphite underline"
                  >
                    {item.link.label}
                  </Link>
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </MarketingPageShell>
  );
}
