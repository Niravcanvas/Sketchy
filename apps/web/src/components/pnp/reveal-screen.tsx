'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { redactFor } from '@sketchy/engine/redact-for';
import { copy } from '@/copy';
import { usePnpStore } from '@/stores/pnp-store';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';

type RevealStep = 'buildup1' | 'buildup2' | 'revealed';

/** Faction token names double as Tailwind color tokens (conventions.md §2) — a literal
 * lookup (never a template-interpolated class name) so Tailwind's content scan still finds
 * every class string it needs to generate. */
const ROLE_COLOR_CLASS: Record<'civilian' | 'undercover' | 'mrwhite', string> = {
  civilian: 'text-civilian',
  undercover: 'text-undercover',
  mrwhite: 'text-mrwhite',
};

function roleTitle(role: 'civilian' | 'undercover' | 'mrwhite'): string {
  if (role === 'civilian') return copy.roles.civilian.cardTitle;
  if (role === 'undercover') return copy.roles.undercover.cardTitle;
  return copy.roles.mrWhite.cardTitle;
}

function roleRevealLine(role: 'civilian' | 'undercover' | 'mrwhite', name: string): string {
  if (role === 'civilian') return copy.reveal.roleReveal.civilian(name);
  if (role === 'undercover') return copy.reveal.roleReveal.undercover(name);
  return copy.reveal.roleReveal.misterWhite(name);
}

/**
 * game-design.md §6.5 — the elimination drama beat, one of the three sanctioned 800–1500ms
 * motion beats (conventions.md §3). P&P is untimed: every step is tap-advanced, never
 * auto-advances, so the host controls the pacing of the reveal.
 *
 * Sequence: "the table has spoken" → "{name}, you're out" → card flip revealing their role
 * → "Got it" hands control back to the engine. `continueReveal()` is the ONLY thing this
 * component asks the engine for — whether that goes to Mr. White's guess window, the next
 * clue round, or game over is entirely the engine's call (game-design.md §6.5: "Host...
 * continues → win check → next round or game over").
 *
 * Renders the eliminated player's role from `redactFor(game, 'spectator')`, never the raw
 * `game.players[]` — the engine already reveals exactly the right thing (an eliminated
 * player's role becomes public the instant the vote closes, data-model.md §4), but this
 * screen still gates showing it behind its own step state so the "card flip" reads as a
 * reveal rather than data that was secretly available the whole time.
 */
export function PnpRevealScreen() {
  const game = usePnpStore((s) => s.game);
  const continueReveal = usePnpStore((s) => s.continueReveal);
  const [step, setStep] = useState<RevealStep>('buildup1');

  if (!game || !game.pendingElimination) return null;

  const spectator = redactFor(game, 'spectator');
  const player = spectator.players.find((p) => p.id === game.pendingElimination);
  if (!player) return null;

  const revealed = step === 'revealed';
  const role = player.role;

  return (
    <div
      data-testid="pnp-reveal-screen"
      data-player-name={player.name}
      data-role={revealed && role ? role : undefined}
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-phase-reveal px-6 text-center transition-colors duration-300"
    >
      {/* Mirror bounce beat: a distinct beat explaining
          the redirect WITHOUT ever naming the Mirror — `mirrorBounced` deliberately carries
          no player id (data-model.md "Phase 13 engine extension"). */}
      {game.mirrorBounced ? (
        <p
          data-testid="pnp-mirror-bounce"
          className="rounded-xl border-3 border-ink bg-highlight px-4 py-2 font-display text-lg uppercase tracking-wide text-ink shadow-hard-sm"
        >
          {copy.roles.special.mirror.bounceHeadline}
        </p>
      ) : null}

      {step === 'buildup1' ? (
        <>
          <h1 className="font-display text-4xl uppercase tracking-wide text-ink">
            {copy.reveal.buildup.tableHasSpoken}
          </h1>
          <PopButton
            variant="primary"
            size="lg"
            data-testid="pnp-reveal-next"
            onClick={() => setStep('buildup2')}
          >
            {copy.roles.dealChrome.confirm}
          </PopButton>
        </>
      ) : null}

      {step === 'buildup2' ? (
        <>
          {/* The elimination shout (design-party-pop.md §7/§11): the OUT moment slams
              into a tilted undercover-red sticker. */}
          <h1 className="pnp-slam inline-block rounded-2xl border-3 border-ink bg-undercover px-6 py-4 font-display text-4xl uppercase tracking-wide text-white shadow-hard-lg">
            {copy.reveal.buildup.playerIsOut(player.name)}
          </h1>
          <PopButton
            variant="primary"
            size="lg"
            data-testid="pnp-reveal-next"
            onClick={() => setStep('revealed')}
          >
            {copy.roles.dealChrome.confirm}
          </PopButton>
        </>
      ) : null}

      {revealed ? (
        <PopCard
          className="pnp-flip-card flex w-full max-w-md flex-col items-center gap-4 py-10"
        >
          {role ? (
            <p className={clsx('font-display text-3xl', ROLE_COLOR_CLASS[role])}>
              {roleTitle(role)}
            </p>
          ) : null}
          {role ? <p className="font-ui text-lg text-ink">{roleRevealLine(role, player.name)}</p> : null}
          {/* eliminationReveal defaults to 'role' in P&P (pnp-store.ts PNP_SETTINGS) — the
              redacted `word` stays null and nothing renders for it (game-design.md §6.5:
              "keeps the pair guessable across rematches"). */}
          {/* Lovebirds chained-reveal note: shown on EITHER half of the pair,
              once their specialRole is publicly visible (the ordinary eliminated rule). */}
          {player.specialRole === 'lovebirds' ? (
            <p data-testid="pnp-lovebirds-cascade-note" className="font-ui text-sm font-bold text-ink">
              {copy.roles.special.lovebirds.cascadeNote}
            </p>
          ) : null}
        </PopCard>
      ) : null}

      {revealed ? (
        <PopButton
          variant="primary"
          size="lg"
          data-testid="pnp-reveal-continue"
          onClick={continueReveal}
        >
          {copy.roles.dealChrome.confirm}
        </PopButton>
      ) : null}
    </div>
  );
}
