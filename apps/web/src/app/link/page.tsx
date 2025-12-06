import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LinkVerify } from '@/components/account/link-verify';
import { SiteHeader } from '@/components/marketing/site-header';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: 'Linking your account',
  robots: { index: false, follow: false },
};

/**
 * `/link` — the magic-link landing page. `LinkVerify` reads the
 * `?token=` query, so it must sit inside a `<Suspense>` boundary (Next App
 * Router requirement for `useSearchParams`). Never indexed (it only ever
 * carries a single-use token).
 */
export default function LinkPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="mx-auto w-full max-w-5xl px-6 py-12">
        <Suspense
          fallback={
            <p className="mt-16 text-center font-ui text-lg text-ink">
              {copy.matchmaking.account.verifyLoading}
            </p>
          }
        >
          <LinkVerify />
        </Suspense>
      </main>
    </>
  );
}
