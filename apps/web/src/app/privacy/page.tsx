import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-json-ld';
import { DraftBanner } from '@/components/marketing/draft-banner';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: copy.marketing.privacy.meta.title,
  description: copy.marketing.privacy.meta.description,
  alternates: { canonical: '/privacy' },
  // DRAFT content (see the in-page banner) — `noindex` until the product owner reviews it,
  // so un-reviewed legal text can't be crawled/cached publicly before launch. Flip to
  // indexable (and re-add to app/sitemap.ts) in the same review pass that clears the draft
  // banner.
  robots: { index: false, follow: false },
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
 * `/privacy` — DRAFT (arch/copy.md §16.5). Rewritten in the pre-deploy audit pass to cover
 * everything shipped so far (accounts/email linking, public matchmaking, voice,
 * moderation/reports, R2 uploads, IP-based rate limiting, Sentry) — still explicitly NOT
 * final legal text pending product-owner sign-off, hence the in-page `DraftBanner` and
 * `noindex` staying in place.
 */
export default function PrivacyPage() {
  return (
    <MarketingPageShell>
      <BreadcrumbJsonLd pageName={copy.marketing.privacy.meta.title} path="/privacy" />
      <DraftBanner text={copy.marketing.privacy.draftBanner} />
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
