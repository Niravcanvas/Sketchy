'use client';

import { useRouter } from 'next/navigation';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';

/**
 * Home screen's "Play on this phone" CTA (copy.md §2 → game-design.md §2 `/play`). A tiny
 * client leaf so `page.tsx` stays a Server Component (conventions.md §1). `PopButton`
 * renders a real `<button>`; nesting one inside `next/link`'s `<a>` would be invalid HTML
 * (interactive content inside interactive content), so navigation goes through
 * `useRouter().push` instead — still a native, keyboard-operable `<button>`.
 */
export function PlayOnThisPhoneButton() {
  const router = useRouter();
  return (
    <PopButton
      variant="primary"
      size="lg"
      className="w-full"
      onClick={() => router.push('/play')}
    >
      {copy.home.primaryActions.playOnThisPhone}
    </PopButton>
  );
}
