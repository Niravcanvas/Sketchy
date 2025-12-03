'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { IconCross } from '@/components/icons/icon-cross';
import { copy } from '@/copy';
import { dismissDataNotice, isDataNoticeDismissed, subscribeDataNotice } from '@/lib/data-notice';

/**
 * Site-wide data-use disclosure — mounted once from `layout.tsx` alongside the other
 * `*Boot` components. Sketchy has no cookies to consent to (see `lib/data-notice.ts`), so
 * this is framed as a plain-language notice with a dismiss button, not a
 * consent/accept-reject gate. `useSyncExternalStore` avoids a first-paint flash for anyone
 * who already dismissed it, same technique `hint-banner.tsx` uses.
 */
export function DataNoticeBanner() {
  const dismissed = useSyncExternalStore(
    subscribeDataNotice,
    isDataNoticeDismissed,
    () => true, // SSR/first-paint default: hidden, never a flash of a notice already dismissed
  );

  if (dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      data-testid="data-notice-banner"
      className="fixed inset-x-0 top-0 z-50 border-b-3 border-ink bg-paper-2 px-4 py-3 shadow-hard"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-ui text-sm text-ink">
          {copy.dataNotice.body}{' '}
          <Link href="/privacy" className="font-bold underline">
            {copy.dataNotice.learnMore}
          </Link>
        </p>
        <button
          type="button"
          data-testid="data-notice-dismiss"
          onClick={() => dismissDataNotice()}
          className="flex shrink-0 items-center gap-2 rounded-lg border-3 border-ink bg-highlight px-3 py-1.5 font-ui text-sm font-bold text-ink shadow-hard-sm transition-transform duration-150 hover:-translate-y-0.5 active:translate-x-[1px] active:translate-y-[1px] active:shadow-hard-pressed"
        >
          {copy.dataNotice.dismiss}
          <IconCross className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
