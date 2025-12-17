import Link from 'next/link';
import { copy } from '@/copy';

/**
 * Shared marketing-site nav ("shared accessible site header
 * used across all marketing pages"). Server Component: plain `<Link>`s, no client JS
 * needed for a handful of navigation entries.
 *
 * Deliberately minimal — wordmark + three text links, no nav CTA button. A nav-bar CTA
 * would duplicate `PopButton`'s exact class list outside `components/pop/` (that module
 * only exports the `PopButton` component, not its `cva` variants) or force
 * `PlayOnThisPhoneButton` into a width it wasn't built for; the landing hero already puts
 * every primary CTA (`Play on this phone` / `Create a room` / `Join a room`) right below
 * the fold, so the nav's only job is wayfinding. `// TODO(design)` if a future pass wants
 * a nav CTA, add a `className`/`size` prop to `PlayOnThisPhoneButton` rather than
 * duplicating button styles (design-party-pop.md §14 — quieter option chosen here).
 *
 * No mobile hamburger/drawer: design-party-pop.md doesn't spec one, and Radix (the only
 * a11y-primitive dependency already in use, conventions.md §1) has no drawer primitive
 * wired up yet. Links wrap onto a second row on narrow viewports instead — fewer moving
 * parts, nothing to keyboard-trap, nothing new to a11y-audit.
 */
export function SiteHeader() {
  return (
    <header className="border-b-3 border-ink bg-paper">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
        <Link
          href="/"
          className="inline-flex items-center py-2 font-display text-xl uppercase tracking-wide text-ink transition-transform duration-150 hover:-translate-y-0.5"
        >
          {copy.brand.name}
        </Link>
        <nav aria-label={copy.marketing.nav.navLabel} className="flex flex-wrap items-center gap-5">
          <Link
            href="/about"
            className="inline-flex items-center py-3 font-ui text-sm font-bold uppercase tracking-[0.08em] text-ink underline decoration-transparent decoration-2 underline-offset-4 transition-colors duration-150 hover:decoration-ink"
          >
            {copy.marketing.nav.about}
          </Link>
          <Link
            href="/faq"
            className="inline-flex items-center py-3 font-ui text-sm font-bold uppercase tracking-[0.08em] text-ink underline decoration-transparent decoration-2 underline-offset-4 transition-colors duration-150 hover:decoration-ink"
          >
            {copy.marketing.nav.faq}
          </Link>
          <Link
            href="/how-to-play"
            className="inline-flex items-center py-3 font-ui text-sm font-bold uppercase tracking-[0.08em] text-ink underline decoration-transparent decoration-2 underline-offset-4 transition-colors duration-150 hover:decoration-ink"
          >
            {copy.marketing.nav.howToPlay}
          </Link>
        </nav>
      </div>
    </header>
  );
}
