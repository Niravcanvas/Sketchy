import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { copy } from '@/copy';

/**
 * Metadata for the room route (`/r/[code]`) — "Room links get a
 * GENERIC OG card and are excluded from the sitemap + noindex — never leak or index room
 * info." `page.tsx` in this segment is a client component ("use client", conventions.md
 * §1 — it's fed by the socket/engine), and a client component cannot itself export
 * `metadata`; this sibling `layout.tsx` is the standard Next.js way to attach static
 * metadata to a route whose page can't carry it. Deliberately does NOT read the `[code]`
 * param anywhere — the title/description/OG card are fully generic and identical for
 * every room, by design (a link pasted into a group chat must never reveal who's playing
 * or what room it is).
 */
export const metadata: Metadata = {
  title: copy.marketing.room.metaTitle,
  description: copy.marketing.room.metaDescription,
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: copy.marketing.room.metaTitle,
    description: copy.marketing.room.metaDescription,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.marketing.room.metaTitle,
    description: copy.marketing.room.metaDescription,
  },
};

export default function RoomLayout({ children }: { children: ReactNode }) {
  return children;
}
