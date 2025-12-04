import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-json-ld';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: copy.marketing.about.meta.title,
  description: copy.marketing.about.meta.description,
  alternates: { canonical: '/about' },
  openGraph: {
    title: copy.marketing.about.meta.title,
    description: copy.marketing.about.meta.description,
    url: '/about',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.marketing.about.meta.title,
    description: copy.marketing.about.meta.description,
  },
};

/**
 * `/about` — brand story (arch/copy.md §16.3). Fully static
 * Server Component: no client JS needed for a page of prose.
 */
export default function AboutPage() {
  return (
    <MarketingPageShell>
      <BreadcrumbJsonLd pageName={copy.marketing.about.meta.title} path="/about" />
      <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
        {copy.marketing.about.title}
      </h1>
      <div className="flex flex-col gap-5">
        {copy.marketing.about.paragraphs.map((paragraph) => (
          <p key={paragraph} className="font-ui text-base text-graphite">
            {paragraph}
          </p>
        ))}
      </div>
      <p className="font-ui text-sm font-medium italic text-ink">
        {copy.marketing.about.closingLine}
      </p>
    </MarketingPageShell>
  );
}
