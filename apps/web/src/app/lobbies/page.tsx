import type { Metadata } from 'next';
import { LobbiesBrowser } from '@/components/matchmaking/lobbies-browser';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { SkipLink } from '@/components/marketing/skip-link';

export const metadata: Metadata = {
  title: 'Find a table',
  description: 'Browse public Sketchy rooms looking for players right now.',
  alternates: { canonical: '/lobbies' },
};

/**
 * `/lobbies` — the public-room browser. Server page shell; the
 * interactive browser (`LobbiesBrowser`) is a client leaf that fetches lobbies
 * and gates joins behind a linked account.
 */
export default function LobbiesPage() {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main-content" className="mx-auto w-full max-w-2xl px-6 py-12">
        <LobbiesBrowser />
      </main>
      <SiteFooter />
    </>
  );
}
