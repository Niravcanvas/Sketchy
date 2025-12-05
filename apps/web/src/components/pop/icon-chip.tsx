import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export interface IconChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** 'plain' white, 'accent' yellow (celebration), 'danger' red (destructive). */
  tone?: 'plain' | 'accent' | 'danger';
}

/** Sticker chip container for icons (design-party-pop.md §5.6 / §6). Purely
 * presentational — when the chip is a button, wrap it: the parent `<button>`
 * carries the interaction and this stays a `<span>`. */
export function IconChip({ children, className, tone = 'plain', ...props }: IconChipProps) {
  return (
    <span
      {...props}
      className={clsx(
        'inline-flex h-10 w-10 items-center justify-center rounded-lg border-3 border-ink shadow-hard-sm',
        tone === 'plain' && 'bg-paper-2 text-ink',
        tone === 'accent' && 'bg-highlight text-ink',
        tone === 'danger' && 'bg-undercover text-white',
        className,
      )}
    >
      {children}
    </span>
  );
}
