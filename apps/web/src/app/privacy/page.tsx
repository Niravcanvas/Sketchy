import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-json-ld';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: copy.marketing.privacy.meta.title,
  description: copy.marketing.privacy.meta.description,
  alternates: { canonical: '/privacy' },
  openGraph: {
    title: copy.marketing.privacy.meta.title,
    description: copy.marketing.privacy.meta.description,
    url: '/privacy',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.marketing.privacy.meta.title,
    description: copy.marketing.privacy.meta.description,
  },
};

/**
 * `/privacy` — Rewritten in the pre-deploy audit pass to cover
 * everything shipped so far (accounts/email linking, public matchmaking, voice,
 * moderation/reports, R2 uploads, IP-based rate limiting, Sentry).
 */
export default function PrivacyPage() {
  return (
    <MarketingPageShell>
      <BreadcrumbJsonLd pageName={copy.marketing.privacy.meta.title} path="/privacy" />
      <h1 className="font-display text-3xl uppercase tracking-wide text-ink">
        {copy.marketing.privacy.title}
      </h1>
      <p className="font-ui text-base text-graphite">{copy.marketing.privacy.intro}</p>
      <div className="flex flex-col gap-6">
        {copy.marketing.privacy.sections.map((section) => (
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
