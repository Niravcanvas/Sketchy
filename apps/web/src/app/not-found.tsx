'use client';

import { useRouter } from 'next/navigation';
import { IconGhost } from '@/components/icons/icon-ghost';
import { IconChip } from '@/components/pop/icon-chip';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

/**
 * The Party Pop 404 (arch/copy.md §9 "404 (page not found, phase 14, new)").
 * Next.js's special `not-found.tsx` — rendered for any unmatched route AND anywhere
 * `notFound()` is called explicitly. `'use client'` (rather than a server-rendered link)
 * because the home CTA reuses `PopButton`, a real `<button>` that can't nest inside
 * `next/link`'s `<a>` (same reasoning as `PlayOnThisPhoneButton` etc.).
 */
export default function NotFound() {
  const router = useRouter();

  return (
    <main className="dots mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <IconChip tone="danger" className="h-16 w-16 -rotate-2">
        <IconGhost className="h-7 w-7" />
      </IconChip>
      <PopCard tone="hero" className="flex flex-col items-center gap-3">
        <h1 className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.notFound.headline}
        </h1>
        <p className="font-ui text-base font-medium text-ink">{copy.notFound.body}</p>
      </PopCard>
      <PopButton type="button" variant="primary" size="lg" onClick={() => router.push('/')}>
        {copy.notFound.cta}
      </PopButton>
    </main>
  );
}
