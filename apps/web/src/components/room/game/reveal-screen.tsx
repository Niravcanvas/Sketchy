'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitPhaseAdvance } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

/** Faction token names double as Tailwind color tokens — a literal lookup (never a
 * template-interpolated class name) so the content scan still finds every class string. */
const ROLE_COLOR_CLASS: Record<BaseRole, string> = {
  civilian: 'text-civilian',
  undercover: 'text-undercover',
  mrwhite: 'text-mrwhite',
};

function roleTitle(role: BaseRole): string {
  if (role === 'civilian') return copy.roles.civilian.cardTitle;
  if (role === 'undercover') return copy.roles.undercover.cardTitle;
  return copy.roles.mrWhite.cardTitle;
}

function roleRevealLine(role: BaseRole, name: string): string {
  if (role === 'civilian') return copy.reveal.roleReveal.civilian(name);
  if (role === 'undercover') return copy.reveal.roleReveal.undercover(name);
  return copy.reveal.roleReveal.misterWhite(name);
}

/**
 * The online elimination reveal (game-design.md §6.5) — one of the three sanctioned drama
 * beats (design-party-pop.md §7). Unlike pass-and-play's tap-through steps, this is
 * server-paced: the engine set an 8-s `phaseEndsAt` (the `StatusStrip` ring shows it) and the
 * timer wheel auto-advances; the host can cut it short with `phase:advance`. Whether "next"
 * is Mr. White's guess window, the next clue round, or game over is entirely the engine's
 * call — this screen never decides.
 *
 * The eliminated player's role is read straight off the redacted snapshot: `redactFor`
 * already unhides a player's role the instant they're eliminated (data-model.md §4), so no
 * private slice is needed. The word shows only when `settings.eliminationReveal ===
 * 'word_and_role'` (redaction gates it — default keeps the pair guessable).
 */
export function OnlineRevealScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [error, setError] = useState<string | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);

  if (!snapshot) {
    return null;
  }

  const player = snapshot.pendingElimination
    ? snapshot.players.find((p) => p.id === snapshot.pendingElimination)
    : null;
  if (!player) {
    return null;
  }
  const role = player.role;
  const canDismiss = you?.canAct.advancePhase ?? false;

  async function handleDismiss(): Promise<void> {
    setIsAdvancing(true);
    setError(null);
    const ack = await emitPhaseAdvance();
    setIsAdvancing(false);
    if (!ack.ok) {
      setError(copyForError(ack.error));
    }
  }

  return (
    <div
      data-testid="online-reveal-screen"
      data-player-name={player.name}
      data-role={role ?? undefined}
      className="flex flex-col items-center gap-6 py-6 text-center"
    >
      {/* Mirror bounce beat: a distinct beat explaining
          the redirect WITHOUT ever naming the Mirror — `mirrorBounced` deliberately carries
          no player id (data-model.md "Phase 13 engine extension"). */}
      {snapshot.mirrorBounced ? (
        <p
          data-testid="online-mirror-bounce"
          className="rounded-xl border-3 border-ink bg-highlight px-4 py-2 font-display text-lg uppercase tracking-wide text-ink shadow-hard-sm"
        >
          {copy.roles.special.mirror.bounceHeadline}
        </p>
      ) : null}

      {/* The OUT shout (design-party-pop.md §7/§11): slams into a tilted undercover-red sticker. */}
      <h1 className="pnp-slam inline-block rounded-2xl border-3 border-ink bg-undercover px-6 py-4 font-display text-3xl uppercase tracking-wide text-white shadow-hard-lg">
        {copy.reveal.buildup.playerIsOut(player.name)}
      </h1>

      <PopCard className="pnp-flip-card flex w-full max-w-md flex-col items-center gap-4 py-8">
        {role ? (
          <p className={clsx('font-display text-3xl', ROLE_COLOR_CLASS[role])}>{roleTitle(role)}</p>
        ) : null}
        {role ? <p className="font-ui text-lg text-ink">{roleRevealLine(role, player.name)}</p> : null}
        {player.word ? (
          <p className="font-display text-2xl uppercase tracking-wide text-ink">{player.word}</p>
        ) : null}
        {/* Lovebirds chained-reveal note: shown on EITHER half of the pair, once
            their specialRole is publicly visible (the ordinary eliminated-player rule). */}
        {player.specialRole === 'lovebirds' ? (
          <p data-testid="online-lovebirds-cascade-note" className="font-ui text-sm font-bold text-ink">
            {copy.roles.special.lovebirds.cascadeNote}
          </p>
        ) : null}
      </PopCard>

      {canDismiss ? (
        <PopButton
          type="button"
          variant="primary"
          size="lg"
          data-testid="online-reveal-continue"
          disabled={isAdvancing}
          onClick={() => {
            void handleDismiss();
          }}
        >
          {copy.roles.dealChrome.confirm}
        </PopButton>
      ) : null}

      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
    </div>
  );
}
