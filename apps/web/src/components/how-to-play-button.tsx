'use client';

import { useRouter } from 'next/navigation';
import { IconQuestion } from '@/components/icons/icon-question';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';

export interface HowToPlayButtonProps {
  /** Where `/how-to-play`'s Skip/finish returns to — a same-origin relative path (e.g.
   * `/r/ABCDE`). Omit for the home screen's own default (`/`). */
  from?: string;
  variant?: 'primary' | 'secondary' | 'accent' | 'danger';
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * The `How to play` entry point (copy.md §2/§10), reused from the home screen, the lobby's
 * cheat-sheet card, and the room join gate ("linked from home / lobby
 * / join flows"). Same shape as `PlayOnThisPhoneButton`/`WordPacksButton`: a real `<button>`
 * navigating via `useRouter().push` rather than nesting a button inside `next/link`'s `<a>`.
 */
export function HowToPlayButton({
  from,
  variant = 'secondary',
  size = 'md',
  className,
}: HowToPlayButtonProps) {
  const router = useRouter();
  const href = from ? `/how-to-play?from=${encodeURIComponent(from)}` : '/how-to-play';
  return (
    <PopButton
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => router.push(href)}
    >
      <IconQuestion className="h-4 w-4" />
      {copy.home.secondaryActions.howToPlay}
    </PopButton>
  );
}
