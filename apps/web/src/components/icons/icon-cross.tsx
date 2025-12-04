import type { SVGProps } from 'react';

/**
 * IconCross — geometry from Lucide (lucide.dev) `x`, ISC — see
 * CREDITS.md; rendered at 2.5px stroke per design-party-pop.md §6.
 */
export function IconCross({ ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
