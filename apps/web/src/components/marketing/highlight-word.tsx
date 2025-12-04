import type { ReactNode } from 'react';

/**
 * The highlight-sticker emphasis span (design-party-pop.md §7 — the exact pattern
 * already specified for the win-screen winner name: `<span className="inline-block
 * -rotate-1 rounded-lg bg-highlight px-2">`). Reused verbatim here for the landing
 * hero's key word rather than inventing a new emphasis
 * technique — the whole point of §7 is that this ONE technique covers every
 * "look here" moment in the app, marketing included.
 */
export function HighlightWord({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block -rotate-1 rounded-lg bg-highlight px-2 text-ink">
      {children}
    </span>
  );
}
