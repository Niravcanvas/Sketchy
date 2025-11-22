import type { SVGProps } from 'react';

/**
 * IconChat — geometry from Lucide (lucide.dev) `message-circle`, ISC — see
 * CREDITS.md; rendered at 2.5px stroke per design-party-pop.md §6.
 */
export function IconChat({ ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}
