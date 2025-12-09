import Link from 'next/link';
import { copy } from '@/copy';

/**
 * Shared marketing-site footer. Server Component.
 *
 * Background: `bg-ink` with white/`highlight` text — this is NOT a new color pairing.
 * design-party-pop.md §10 already sanctions exactly this combination for the pass
 * interstitial ("bg-ink, white + highlight type"); reusing it here for the site's other
 * full-bleed dark moment keeps the palette's vocabulary small instead of inventing a
 * "footer gray" that doesn't exist anywhere else in the system.
 *
 * The GitHub link only renders when `NEXT_PUBLIC_GITHUB_URL` is set (footer spec:
 * "GitHub — only if a repo URL actually exists, otherwise omit, don't invent
 * one"). Left unset by default: the working repo is currently private, and a public
 * marketing footer must not hardcode a private-repo URL (a dead link for visitors, and it
 * leaks the owner's account path). The owner sets the env var if/when the repo goes public.
 */
const REPO_URL = process.env.NEXT_PUBLIC_GITHUB_URL;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t-3 border-ink bg-ink text-paper-2">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <p className="font-display text-lg uppercase tracking-wide text-highlight">
            {copy.brand.name}
          </p>
          <p className="font-ui text-sm text-paper-2/80">{copy.marketing.footer.tagline}</p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-paper-2/60">
            {copy.marketing.footer.columnHeadings.product}
          </p>
          <Link
            href="/how-to-play"
            className="inline-block py-1.5 font-ui text-sm font-medium text-paper-2 transition-colors duration-150 hover:text-highlight"
          >
            {copy.marketing.footer.links.howToPlay}
          </Link>
          <Link
            href="/about"
            className="inline-block py-1.5 font-ui text-sm font-medium text-paper-2 transition-colors duration-150 hover:text-highlight"
          >
            {copy.marketing.footer.links.about}
          </Link>
          <Link
            href="/faq"
            className="inline-block py-1.5 font-ui text-sm font-medium text-paper-2 transition-colors duration-150 hover:text-highlight"
          >
            {copy.marketing.footer.links.faq}
          </Link>
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-paper-2/60">
            {copy.marketing.footer.columnHeadings.legal}
          </p>
          <Link
            href="/privacy"
            className="inline-block py-1.5 font-ui text-sm font-medium text-paper-2 transition-colors duration-150 hover:text-highlight"
          >
            {copy.marketing.footer.links.privacy}
          </Link>
          <Link
            href="/terms"
            className="inline-block py-1.5 font-ui text-sm font-medium text-paper-2 transition-colors duration-150 hover:text-highlight"
          >
            {copy.marketing.footer.links.terms}
          </Link>
          {REPO_URL ? (
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-block py-1.5 font-ui text-sm font-medium text-paper-2 transition-colors duration-150 hover:text-highlight"
            >
              {copy.marketing.footer.links.github}
            </a>
          ) : null}
        </div>

        <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
          <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-paper-2/60">
            {copy.marketing.footer.columnHeadings.credits}
          </p>
          <p className="font-ui text-sm text-paper-2/80">{copy.marketing.footer.creditsLine}</p>
        </div>
      </div>

      <div className="border-t-3 border-paper-2/20">
        <p className="mx-auto w-full max-w-5xl px-6 py-4 font-ui text-xs text-paper-2/60">
          {copy.marketing.footer.copyright(year)}
        </p>
      </div>
    </footer>
  );
}
