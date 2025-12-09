import { copy } from '@/copy';

/**
 * Skip-to-content link (conventions.md §4 a11y baseline — "every interactive element
 * keyboard-reachable"). Visually hidden until focused (`sr-only focus:not-sr-only`),
 * must be the FIRST focusable element on the page, so every marketing page renders this
 * before `<SiteHeader>`. Targets `#main-content`, which every marketing page's `<main>`
 * carries.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:border-3 focus:border-ink focus:bg-highlight focus:px-4 focus:py-3 focus:font-ui focus:text-sm focus:font-bold focus:uppercase focus:tracking-[0.08em] focus:text-ink focus:shadow-hard"
    >
      {copy.marketing.nav.skipToContent}
    </a>
  );
}
