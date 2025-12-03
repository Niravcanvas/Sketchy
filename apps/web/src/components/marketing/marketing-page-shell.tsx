import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { SkipLink } from '@/components/marketing/skip-link';

/**
 * Shared chrome for the secondary marketing pages (`/about`, `/faq`, `/privacy`,
 * `/terms`). The landing page assembles its own hero layout
 * directly (its `<main>` needs a wider, multi-section structure), but these four simpler
 * single-column pages share this exact wrapper: skip link, nav, a max-width readable
 * column, footer.
 */
export function MarketingPageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main-content" className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-14">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
