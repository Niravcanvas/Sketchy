import type { SVGProps } from 'react';

/**
 * IconArrowLeft — geometry from Lucide (lucide.dev) `arrow-left`, ISC —
 * rendered at 2.5px stroke per design-party-pop.md §6.
 */
export function IconArrowLeft({ ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}
