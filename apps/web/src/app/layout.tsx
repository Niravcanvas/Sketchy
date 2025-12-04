import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Archivo_Black, Space_Grotesk } from 'next/font/google';
import { DataNoticeBanner } from '@/components/marketing/data-notice-banner';
import { ObservabilityBoot } from '@/components/observability-boot';
import { SessionBoot } from '@/components/session-boot';
import { SoundUnlockBoot } from '@/components/sound/sound-unlock-boot';
import { copy } from '@/copy';
import { getSiteUrl } from '@/lib/site-url';
import './globals.css';

const HTML_LANG = 'en';

/**
 * App fonts (design-party-pop.md §3 — both OFL 1.1, loaded with
 * next/font/google so Next self-hosts the woff2 at build time; no runtime
 * request to Google). Each exposes the CSS variable the Tailwind preset's
 * `fontFamily` tokens read (`font-ui` / `font-display`). Sources + licenses
 * recorded in CREDITS.md.
 */
const fontUi = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

const fontDisplay = Archivo_Black({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

/**
 * `metadataBase` (arch/copy.md §16.7) makes every route's relative
 * `alternates.canonical` / OG-image reference resolve to an absolute URL. Every marketing
 * page overrides `title` with its own short string, resolved through this template
 * (root/landing sets `{ absolute: ... }` instead, so it doesn't get the suffix twice).
 */
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: copy.brand.name,
    template: copy.marketing.seo.titleTemplate,
  },
  description: copy.brand.oneLineDescription,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={HTML_LANG} className={`${fontUi.variable} ${fontDisplay.variable}`}>
      <body className="font-ui antialiased">
        <SessionBoot />
        <ObservabilityBoot />
        <SoundUnlockBoot />
        <DataNoticeBanner />
        {children}
      </body>
    </html>
  );
}
