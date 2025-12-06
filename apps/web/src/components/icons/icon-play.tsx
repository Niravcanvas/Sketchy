import type { SVGProps } from 'react';

/**
 * IconPlay — geometry from Lucide (lucide.dev) `play`, ISC — see
 * CREDITS.md; rendered at 2.5px stroke per design-party-pop.md §6.
 */
export function IconPlay({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 5.914v12.172a1 1 0 0 0 1.554.832l9.128-6.086a1 1 0 0 0 0-1.664L6.554 5.082A1 1 0 0 0 5 5.914z" />
    </svg>
  );
}
