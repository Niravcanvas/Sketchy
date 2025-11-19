'use client';

import { useRouter } from 'next/navigation';
import { IconBook } from '@/components/icons/icon-book';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';

/**
 * Home screen's `Word packs` secondary action (copy.md §2/§11 → the `/packs` manager).
 * Same shape as `PlayOnThisPhoneButton`: a tiny client leaf so
 * `app/page.tsx` stays a Server Component, navigating via `useRouter().push` rather than
 * nesting a `<button>` inside `next/link`'s `<a>` (invalid HTML).
 */
export function WordPacksButton() {
  const router = useRouter();
  return (
    <PopButton variant="secondary" size="md" onClick={() => router.push('/packs')}>
      <IconBook className="h-4 w-4" />
      {copy.home.secondaryActions.wordPacks}
    </PopButton>
  );
}
