import type { Metadata } from 'next';
import { HowToPlayButton } from '@/components/how-to-play-button';
import { MyScrapbookButton } from '@/components/my-scrapbook-button';
import { NamePromptCard } from '@/components/name-prompt-card';
import { PlayOnThisPhoneButton } from '@/components/play-on-this-phone-button';
import { WordPacksButton } from '@/components/word-packs-button';
import Link from 'next/link';
import { CreateARoomButton } from '@/components/room/create-a-room-button';
import { JoinARoomForm } from '@/components/room/join-a-room-form';
import { QuickJoinButton } from '@/components/matchmaking/quick-join-button';
import { RejoinPrompt } from '@/components/room/rejoin-prompt';
import { GamesTodayCounter } from '@/components/marketing/games-today-counter';
import { HighlightWord } from '@/components/marketing/highlight-word';
import { HowItWorksStep } from '@/components/marketing/how-it-works-step';
import { LandingJsonLd } from '@/components/marketing/landing-json-ld';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { SkipLink } from '@/components/marketing/skip-link';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

export const metadata: Metadata = {
  title: { absolute: copy.marketing.landing.meta.title },
  description: copy.marketing.landing.meta.description,
  alternates: { canonical: '/' },
  openGraph: {
    title: copy.marketing.landing.meta.title,
    description: copy.marketing.landing.meta.description,
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.marketing.landing.meta.title,
    description: copy.marketing.landing.meta.description,
  },
};

const HOW_IT_WORKS_TILTS = ['-rotate-1', 'rotate-1', '-rotate-2'] as const;
const HOW_IT_WORKS_DOODLES = ['/doodles/unboxing.svg', '/doodles/selfie.svg', '/doodles/groovy.svg'];

/**
 * Landing page (`/`) — arch/copy.md §16.2. Server Component;
 * the interactive leaves (`PopButton`-based CTAs, `NamePromptCard`) are all "use client".
 *
 * THE `/` DECISION: EVOLVED in
 * place rather than wrapped. The pre-existing home screen's guest-identity flow
 * (`NamePromptCard` → guest auth → localStorage → `session-store`) and its primary
 * actions (`PlayOnThisPhoneButton` / `CreateARoomButton` / `JoinARoomForm` /
 * `RejoinPrompt`) are ALL still here, unmodified, in the same right-hand action panel
 * they occupied before — only the surrounding chrome (site nav/footer, a real marketing
 * hero, "how it works", social proof) is new. The page's single `<h1>` moved from the old
 * brand-lockup block (icon chip + "Sketchy" + tagline) to the new hero headline; the
 * brand lockup itself is redundant now that `SiteHeader` carries the wordmark, so it was
 * removed rather than kept as a second, competing "Sketchy" heading.
 */
export default function HomePage() {
  return (
    <>
      <LandingJsonLd />
      <SkipLink />
      <SiteHeader />
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-5xl flex-col gap-20 px-6 py-12"
      >
        <section className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-14 lg:pt-6">
          <div className="flex w-full max-w-xl flex-col gap-6">
            <p className="inline-flex w-fit -rotate-1 items-center rounded-lg border-3 border-ink bg-paper-2 px-3 py-1 font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink shadow-hard-sm">
              {copy.marketing.landing.hero.eyebrow}
            </p>
            <h1 className="font-display text-4xl uppercase leading-[1.08] tracking-wide text-ink sm:text-5xl">
              {copy.marketing.landing.hero.headlinePrefix}{' '}
              <HighlightWord>{copy.marketing.landing.hero.headlineHighlight}</HighlightWord>
              {copy.marketing.landing.hero.headlineSuffix}
            </h1>
            <p className="font-ui text-lg text-graphite">
              {copy.marketing.landing.hero.subhead}
            </p>

            <div className="flex flex-col gap-4 pt-6">
              <RejoinPrompt />
              <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
                {copy.marketing.landing.identityPanelHeading}
              </p>
              <NamePromptCard />
            </div>
          </div>

          <div className="flex w-full max-w-sm flex-col gap-5 lg:pt-2">
            <PopCard className="flex w-full flex-col gap-5">
              <div className="flex flex-col gap-3">
                <PlayOnThisPhoneButton />
                <CreateARoomButton />
                <JoinARoomForm />
                <QuickJoinButton />
                <Link
                  href="/lobbies"
                  className="text-center font-ui text-sm font-bold text-graphite underline"
                >
                  {copy.matchmaking.publicRoom.browserTitle}
                </Link>
              </div>
              {/* Honest expectations right where a host commits to a room: clues are
                  unfiltered free text, and voice is built in but optional. */}
              <div className="flex flex-col gap-1 text-center">
                <p className="font-ui text-xs text-graphite">
                  {copy.marketing.landing.entryReassurance.clueTrust}
                </p>
                <p className="font-ui text-xs text-graphite">
                  {copy.marketing.landing.entryReassurance.voice}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <HowToPlayButton />
                <WordPacksButton />
                <MyScrapbookButton />
              </div>
            </PopCard>
            <p className="text-center font-ui text-sm text-graphite">{copy.home.footer}</p>
          </div>
        </section>

        <section aria-labelledby="how-it-works-heading" className="flex flex-col gap-8">
          <h2
            id="how-it-works-heading"
            className="font-display text-2xl uppercase tracking-wide text-ink"
          >
            {copy.marketing.landing.howItWorks.sectionHeading}
          </h2>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {copy.marketing.landing.howItWorks.steps.map((step, index) => (
              <HowItWorksStep
                key={step.title}
                eyebrow={step.eyebrow}
                title={step.title}
                body={step.body}
                doodleSrc={HOW_IT_WORKS_DOODLES[index] ?? HOW_IT_WORKS_DOODLES[0] ?? ''}
                doodleAlt={step.doodleAlt}
                tilt={HOW_IT_WORKS_TILTS[index] ?? '-rotate-1'}
              />
            ))}
          </ul>
        </section>

        <section className="flex flex-col items-start gap-6 rounded-2xl border-3 border-ink bg-phase-discuss p-8 shadow-hard">
          <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink">
            {copy.marketing.landing.secondaryCta.eyebrow}
          </p>
          <GamesTodayCounter />
          <div className="flex flex-wrap gap-3">
            <PlayOnThisPhoneButton />
            <HowToPlayButton />
          </div>
          {/* Quiet path to the FAQ, which otherwise only lived in the footer — lighter
              weight than the CTAs above it. */}
          <Link href="/faq" className="font-ui text-sm text-ink underline">
            {copy.marketing.landing.questionsLink}
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
