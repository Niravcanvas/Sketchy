import type { SVGProps } from 'react';

/**
 * IconCheck — geometry from Lucide (lucide.dev) `check`, ISC — see
 * CREDITS.md; rendered at 2.5px stroke per design-party-pop.md §6.
 */
export function IconCheck({ ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
