import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { SkipLink } from '@/components/marketing/skip-link';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: 'Community expectations',
  description: 'How we keep Sketchy fun for everyone at the table.',
  alternates: { canonical: '/community' },
};

/**
 * `/community` — the community-expectations one-pager (copy.md §17.5),
 * linked from every public flow (browser, quick-join, lobby). Server-rendered,
 * plain, and crawlable — the honest "how we play nice" the moderation rails
 * point back at.
 */
export default function CommunityPage() {
  const { community } = copy.matchmaking;
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main-content" className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl uppercase tracking-wide text-ink">{community.title}</h1>
          <p className="font-ui text-lg text-graphite">{community.intro}</p>
        </div>

        <Section heading={community.vibeHeading} items={community.vibe} />
        <Section heading={community.notCoolHeading} items={community.notCool} />

        <div className="flex flex-col gap-2">
          <h2 className="font-display text-xl uppercase tracking-wide text-ink">
            {community.toolsHeading}
          </h2>
          <p className="font-ui text-base text-ink">{community.toolsBody}</p>
        </div>

        <p className="font-ui text-base font-bold text-ink">{community.closing}</p>
        <Link
          href="/"
          className="w-fit rounded-lg border-3 border-ink bg-paper-2 px-4 py-2 font-ui font-bold text-ink shadow-hard-sm"
        >
          {community.back}
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ heading, items }: { heading: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-xl uppercase tracking-wide text-ink">{heading}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="font-ui text-base text-ink">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
