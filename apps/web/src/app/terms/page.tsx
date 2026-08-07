import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-json-ld';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: copy.marketing.terms.meta.title,
  description: copy.marketing.terms.meta.description,
  alternates: { canonical: '/terms' },
  openGraph: {
    title: copy.marketing.terms.meta.title,
    description: copy.marketing.terms.meta.description,
    url: '/terms',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.marketing.terms.meta.title,
    description: copy.marketing.terms.meta.description,
  },
};

/**
 * `/terms` — Rewritten in the pre-deploy audit pass to
 * cover public matchmaking, voice, and moderation/enforcement.
 */
export default function TermsPage() {
  return (
    <MarketingPageShell>
      <BreadcrumbJsonLd pageName={copy.marketing.terms.meta.title} path="/terms" />
      <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
        {copy.marketing.terms.title}
      </h1>
      <p className="font-ui text-base text-graphite">{copy.marketing.terms.intro}</p>
      <div className="flex flex-col gap-6">
        {copy.marketing.terms.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="font-ui text-base font-bold uppercase tracking-[0.04em] text-ink">
              {section.heading}
            </h2>
            <p className="font-ui text-sm text-graphite">{section.body}</p>
          </section>
        ))}
      </div>
    </MarketingPageShell>
  );
}
