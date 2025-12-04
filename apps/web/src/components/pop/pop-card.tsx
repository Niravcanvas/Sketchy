import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export interface PopCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  /** 'raised' = standard white card; 'hero' = the screen's one big yellow moment. */
  tone?: 'raised' | 'hero';
}

/**
 * Raised surface (design-party-pop.md §5.2). 'hero' is reserved for the one
 * headline card per screen (secret word, room code) — yellow, bigger shadow,
 * sticker tilt.
 */
export function PopCard({ children, className, tone = 'raised', ...props }: PopCardProps) {
  return (
    <div
      {...props}
      className={clsx(
        'border-3 border-ink p-6',
        tone === 'raised' && 'rounded-xl bg-paper-2 shadow-hard-sm',
        tone === 'hero' && '-rotate-1 rounded-2xl bg-highlight shadow-hard-lg',
        className,
      )}
    >
      {children}
    </div>
  );
}
