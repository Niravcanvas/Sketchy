'use client';

import { useState, type TouchEvent } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { IconArrowRight } from '@/components/icons/icon-arrow-right';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

/** Horizontal swipe distance (px) that counts as a deliberate next/back gesture, not an
 * incidental drag/scroll wobble. */
const SWIPE_THRESHOLD_PX = 48;

export interface HowToPlayViewProps {
  /** Same-origin relative path to return to on Skip/finish — validated here (never trust a
   * raw query param as a redirect target) and defaulting to home. */
  from: string | null;
}

function safeDestination(from: string | null): string {
  if (from && from.startsWith('/') && !from.startsWith('//')) {
    return from;
  }
  return '/';
}

/**
 * The `/how-to-play` sequence (game-design.md §2, copy.md §10): the
 * four onboarding cards as a swipeable, skippable, CSS-animated Party Pop sequence — each
 * card Slams in (design-party-pop.md §7) as it becomes current. `key={index}` on the animated
 * card forces a fresh mount per card change, which is what re-triggers the `.pnp-slam`
 * animation (a plain CSS class, no JS animation library) — including its
 * `prefers-reduced-motion` fallback (globals.css drops the animation entirely, so every card
 * is still fully legible, just without the entrance motion).
 */
export function HowToPlayView({ from }: HowToPlayViewProps) {
  const router = useRouter();
  const destination = safeDestination(from);
  const cards = copy.howToPlay.cards;
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const card = cards[index];
  const isLast = index === cards.length - 1;

  function finish(): void {
    router.push(destination);
  }

  function next(): void {
    setIndex((current) => {
      if (current >= cards.length - 1) {
        return current;
      }
      return current + 1;
    });
  }

  function back(): void {
    setIndex((current) => Math.max(current - 1, 0));
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>): void {
    setTouchStartX(event.touches[0]?.clientX ?? null);
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>): void {
    if (touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX;
    const delta = endX - touchStartX;
    setTouchStartX(null);
    if (delta <= -SWIPE_THRESHOLD_PX) next();
    else if (delta >= SWIPE_THRESHOLD_PX) back();
  }

  if (!card) {
    return null;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-6 bg-paper px-6 py-12">
      <div aria-live="polite" className="sr-only">
        {copy.howToPlay.nav.progress(index + 1, cards.length)}
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex w-full flex-col items-center gap-6"
      >
        <PopCard
          key={index}
          tone="hero"
          data-testid="how-to-play-card"
          data-index={index}
          className="pnp-slam flex min-h-[20rem] w-full flex-col items-center justify-center gap-4 py-10 text-center"
        >
          <h1 className="font-display text-2xl uppercase tracking-wide text-ink">
            {card.headline}
          </h1>
          <p className="font-ui text-base font-medium text-ink">{card.body}</p>
        </PopCard>

        <div className="flex items-center gap-2">
          {cards.map((c, i) => (
            <button
              key={c.headline}
              type="button"
              aria-label={copy.howToPlay.nav.progress(i + 1, cards.length)}
              aria-current={i === index}
              data-testid="how-to-play-dot"
              onClick={() => setIndex(i)}
              className={clsx(
                'h-3 w-3 rounded-full border-3 border-ink transition-colors duration-150',
                i === index ? 'bg-highlight' : 'bg-paper-2',
              )}
            />
          ))}
        </div>

        <div className="flex w-full items-center justify-between gap-2">
          <PopButton
            type="button"
            variant="secondary"
            disabled={index === 0}
            data-testid="how-to-play-back"
            onClick={back}
          >
            {copy.howToPlay.nav.back}
          </PopButton>
          <PopButton
            type="button"
            variant="secondary"
            data-testid="how-to-play-skip"
            onClick={finish}
          >
            {copy.howToPlay.nav.skip}
          </PopButton>
          <PopButton
            type="button"
            variant="primary"
            data-testid="how-to-play-next"
            onClick={isLast ? finish : next}
          >
            {isLast ? copy.roles.dealChrome.confirm : copy.howToPlay.nav.next}
            <IconArrowRight className="h-4 w-4" />
          </PopButton>
        </div>
      </div>
    </main>
  );
}
