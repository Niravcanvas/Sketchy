'use client';

import { useSyncExternalStore } from 'react';
import { IconCross } from '@/components/icons/icon-cross';
import { copy } from '@/copy';
import {
  dismissHint,
  isHintDismissed,
  subscribeDismissedHints,
  type HintId,
} from '@/lib/onboarding-hints';

export interface HintBannerProps {
  hintId: HintId;
  headline: string;
  body: string;
}

/**
 * A first-game contextual hint (arch/copy.md "Onboarding chrome" §10 subsection):
 * a small dismissible callout that sits directly above the surface it explains (peek card,
 * clue input, vote grid) rather than a floating/anchored tooltip — a plain flow element
 * avoids portal/positioning complexity across very different layouts, and reads as the same
 * "sticker chip" vocabulary the rest of Party Pop already uses (design-party-pop.md §14:
 * the quieter option when a treatment isn't explicitly specified).
 *
 * Dismissal is per-device (localStorage, `lib/onboarding-hints.ts`) and permanent once
 * dismissed — `useSyncExternalStore` (not `useState` + an effect) so the very first render
 * already matches localStorage with no post-mount flash, the same technique
 * `lib/active-room.ts`'s consumers use.
 */
export function HintBanner({ hintId, headline, body }: HintBannerProps) {
  const dismissed = useSyncExternalStore(
    subscribeDismissedHints,
    () => isHintDismissed(hintId),
    () => true, // SSR/first-paint default: hidden, never a flash of a hint that's already dismissed
  );

  if (dismissed) {
    return null;
  }

  return (
    <div
      data-testid={`hint-${hintId}`}
      className="pnp-pop-in mx-auto flex w-full max-w-md items-start gap-3 rounded-xl border-3 border-ink bg-highlight px-4 py-3 text-left shadow-hard-sm"
    >
      <div className="flex-1">
        <p className="font-ui text-sm font-bold uppercase tracking-[0.04em] text-ink">{headline}</p>
        <p className="font-ui text-sm font-medium text-ink">{body}</p>
      </div>
      <button
        type="button"
        aria-label={copy.hints.dismissAria}
        data-testid={`hint-${hintId}-dismiss`}
        onClick={() => dismissHint(hintId)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-3 border-ink bg-paper-2 text-ink shadow-hard-sm transition-transform duration-150 hover:-translate-y-0.5 active:translate-x-[1px] active:translate-y-[1px] active:shadow-hard-pressed"
      >
        <IconCross className="h-3 w-3" />
      </button>
    </div>
  );
}
