'use client';

import { PopButton } from '@/components/pop/pop-button';

export interface PassInterstitialProps {
  /** e.g. copy.pnp.passInterstitial.prompt(name) or copy.pnp.voteHandoff(name). */
  title: string;
  /** e.g. copy.pnp.passInterstitial.smallPrint — omitted for vote handoffs. */
  smallPrint?: string;
  /** Always a copy.ts string — `That's me` in both current uses. */
  confirmLabel: string;
  onConfirm: () => void;
  testId: string;
  /** The player being handed the device — exposed for Playwright, not rendered. */
  playerName: string;
}

/**
 * Full-screen pass-the-phone gate (game-design.md §4.2/§4.4): the deal ritual
 * and the secret-ballot pass-around both funnel through this so the handoff
 * moment always looks identical. Deliberately shows NOTHING game-derived
 * beyond the recipient's name — the previous holder's secrets must never be
 * on screen when the device changes hands (pillar: privacy is a physical
 * ritual).
 */
export function PassInterstitial({
  title,
  smallPrint,
  confirmLabel,
  onConfirm,
  testId,
  playerName,
}: PassInterstitialProps) {
  return (
    <div
      data-testid={testId}
      data-player-name={playerName}
      className="dots flex min-h-screen flex-col items-center justify-center gap-8 bg-ink px-6 text-center"
    >
      {/* Pass interstitial (design-party-pop.md §10): dark ground, the recipient's
          name shouts in white display type over the highlight-yellow prompt chrome. */}
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="pnp-slam font-display text-4xl uppercase tracking-wide text-highlight">
          {title}
        </h1>
        <PopButton
          variant="accent"
          size="lg"
          data-testid="pnp-interstitial-confirm"
          onClick={onConfirm}
        >
          {confirmLabel}
        </PopButton>
        {smallPrint ? <p className="font-ui text-sm text-paper">{smallPrint}</p> : null}
      </div>
    </div>
  );
}
