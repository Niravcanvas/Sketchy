'use client';

import { useRouter } from 'next/navigation';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';

/**
 * Home screen's "My scrapbook" secondary action (copy.md §2 → `/profile`).
 * Same tiny-client-leaf pattern as `play-on-this-phone-button.tsx` — `page.tsx` stays a
 * Server Component; navigation goes through `useRouter().push` rather than nesting `PopButton`
 * (a real `<button>`) inside `next/link`'s `<a>`, which would be invalid HTML.
 */
export function MyScrapbookButton() {
  const router = useRouter();
  return (
    <PopButton
      variant="secondary"
      size="md"
      data-testid="my-scrapbook-button"
      onClick={() => router.push('/profile')}
    >
      {copy.home.secondaryActions.myScrapbook}
    </PopButton>
  );
}
