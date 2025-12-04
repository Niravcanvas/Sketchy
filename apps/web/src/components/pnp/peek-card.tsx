'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { redactFor } from '@sketchy/engine/redact-for';
import { pairedPartnerId } from '@sketchy/engine/reducers/shared';
import type { GamePlayer, GameState, SpecialRole } from '@sketchy/engine/types';
import { HintBanner } from '@/components/hints/hint-banner';
import { IconEye } from '@/components/icons/icon-eye';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { currentRitualPlayer, usePnpStore } from '@/stores/pnp-store';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

/** Faction → Tailwind text-color token (conventions.md §2: color is never the ONLY
 * signal — the role name text is always rendered alongside it). */
const ROLE_COLOR_CLASS: Record<BaseRole, string> = {
  civilian: 'text-civilian',
  undercover: 'text-undercover',
  mrwhite: 'text-mrwhite',
};

const ROLE_COPY = {
  civilian: copy.roles.civilian,
  undercover: copy.roles.undercover,
  mrwhite: copy.roles.mrWhite,
} as const;

/**
 * Deal-card extra line for special-role holders (copy.md §3.2) — rendered in the private
 * peek, own-view only. Ghost and Mime have no deal-card line of their own (Ghost's extra
 * line shows on elimination instead, copy.md §8; Mime is a room-wide setting, never a dealt
 * holder). Mirrors `room/game/deal-screen.tsx`'s identical helper (online) — P&P has the
 * FULL local `GameState`, so it resolves the Lovebirds/Rivals partner directly via the
 * engine's own `pairedPartnerId` (reducers/shared.ts) rather than a server-computed
 * `you`-slice field.
 */
function specialRoleDealCardLine(
  specialRole: SpecialRole | null,
  playerId: string,
  players: GamePlayer[],
): string | null {
  if (specialRole === 'judge') return copy.roles.special.judge.dealCardLine;
  if (specialRole === 'jester') return copy.roles.special.jester.dealCardLine;
  if (specialRole === 'grudge') return copy.roles.special.grudge.dealCardLine;
  if (specialRole === 'mirror') return copy.roles.special.mirror.dealCardLine;
  if (specialRole === 'lovebirds') {
    const partnerId = pairedPartnerId(players, playerId, 'lovebirds');
    const partner = players.find((p) => p.id === partnerId);
    return partner ? copy.roles.special.lovebirds.dealCardLine(partner.name) : null;
  }
  if (specialRole === 'rivals') {
    const rivalId = pairedPartnerId(players, playerId, 'rivals');
    const rival = players.find((p) => p.id === rivalId);
    return rival ? copy.roles.special.rivals.dealCardLine(rival.name) : null;
  }
  return null;
}

/**
 * The deal-ritual card (game-design.md §4.2, conventions.md §4 privacy ritual) for
 * `currentRitualPlayer(game)`. Assumes the router only mounts this once that player has
 * already confirmed "That's me" (`ritual.confirmed`) — this component doesn't re-check it.
 *
 * PRIVACY INVARIANT: every role/word rendered here comes from `redactFor(game, player.id)`
 * — the viewer's OWN redacted entry — never `game.players[i].role/word` or `game.pair`
 * directly. That's what guarantees this card can only ever show the current ritual
 * player's own secret, never anyone else's.
 */
export function PnpPeekCard() {
  const game = usePnpStore((s) => s.game);
  const player = game ? currentRitualPlayer(game) : null;

  if (!game || !player) return null;

  // `key={player.id}` gives each ritual player a fresh `RitualCard` instance, so its local
  // "has THIS player peeked yet" state starts over on handoff for free — no effect needed
  // to reset it (react.dev "You Might Not Need an Effect" > resetting state on prop change).
  return <RitualCard key={player.id} game={game} player={player} />;
}

function RitualCard({ game, player }: { game: GameState; player: GamePlayer }) {
  const peeking = usePnpStore((s) => s.ritual.peeking);
  const setPeeking = usePnpStore((s) => s.setPeeking);
  const ackCurrent = usePnpStore((s) => s.ackCurrent);

  // Tracks whether this player has peeked at least once, so the face-down card can switch
  // from the "press and hold" hint to the "hidden again" chrome after their first release
  // (copy.md §3.1). "Adjust state while rendering" (react.dev), not an effect: a plain
  // derivation from the previous `peeking` value, computed synchronously during render.
  const [prevPeeking, setPrevPeeking] = useState(peeking);
  const [hasPeeked, setHasPeeked] = useState(peeking);
  if (peeking !== prevPeeking) {
    setPrevPeeking(peeking);
    if (peeking) setHasPeeked(true);
  }

  const redacted = redactFor(game, player.id);
  const self = redacted.players.find((p) => p.id === player.id);
  // Engine invariant: `currentRitualPlayer` only ever returns a seated player, so their own
  // redacted entry always exists — the fallback is purely to satisfy strict null checks.
  const role = self?.role ?? null;
  const word = self?.word ?? null;
  const specialRole = self?.specialRole ?? null;

  // The ritual's last stop: whoever is left un-acked once nobody else needs the phone.
  const isLastPlayer = game.players.filter((p) => p.alive && !p.hasSeenWord).length === 1;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <HintBanner
        hintId="peekCard"
        headline={copy.hints.peekCard.headline}
        body={copy.hints.peekCard.body}
      />
      <PopCard
        tone="hero"
        data-testid="pnp-peek-card"
        data-role={peeking && role ? role : undefined}
        data-word={peeking ? (word ?? '') : undefined}
        onPointerDown={() => setPeeking(true)}
        onPointerUp={() => setPeeking(false)}
        onPointerCancel={() => setPeeking(false)}
        onPointerLeave={() => setPeeking(false)}
        className="flex min-h-[24rem] w-full max-w-sm select-none flex-col items-center justify-center gap-4 py-10"
      >
        {/* Deal card flip (design-party-pop.md §7 "Flip" + "Pop-in"): `.pnp-flip-card`
            (globals.css) turns the card face over on every peek/hide toggle — a real CSS
            transform under normal motion, a fade under prefers-reduced-motion (never remove
            information, only the movement). `key={peeking}` forces a fresh mount per side so
            the animation re-triggers every toggle, same technique the reveal screens use. */}
        <div key={peeking ? 'front' : 'back'} className="pnp-flip-card flex flex-col items-center gap-4">
          {peeking && role ? (
            <RoleFace
              role={role}
              word={word}
              specialRole={specialRole}
              playerId={player.id}
              players={game.players}
            />
          ) : (
            <CardBack hasPeeked={hasPeeked} />
          )}
        </div>
      </PopCard>

      <PopButton
        type="button"
        variant="secondary"
        data-testid="pnp-peek-toggle"
        aria-pressed={peeking}
        onClick={() => setPeeking(!peeking)}
      >
        <IconEye className="h-4 w-4" />
        {peeking ? copy.pnp.peekA11y.hide : copy.pnp.peekA11y.show}
      </PopButton>

      <PopButton
        type="button"
        variant="primary"
        size="lg"
        data-testid="pnp-ack"
        onClick={ackCurrent}
      >
        {isLastPlayer ? copy.pnp.afterPeek.lastPlayer : copy.pnp.afterPeek.passItOn}
      </PopButton>
    </div>
  );
}

function CardBack({ hasPeeked }: { hasPeeked: boolean }) {
  return (
    <>
      <IconEye className="h-12 w-12 text-ink" />
      <p className="font-ui text-base font-medium text-ink">
        {hasPeeked ? copy.roles.dealChrome.onRelease : copy.roles.dealChrome.pressAndHold}
      </p>
    </>
  );
}

function RoleFace({
  role,
  word,
  specialRole,
  playerId,
  players,
}: {
  role: BaseRole;
  word: string | null;
  specialRole: SpecialRole | null;
  playerId: string;
  players: GamePlayer[];
}) {
  const roleCopy = ROLE_COPY[role];
  const dealCardLine = specialRoleDealCardLine(specialRole, playerId, players);
  return (
    <div className="flex flex-col items-center gap-3">
      <h2
        className={clsx(
          'pnp-pop-in font-display text-3xl uppercase tracking-wide',
          ROLE_COLOR_CLASS[role],
        )}
      >
        {roleCopy.cardTitle}
      </h2>
      <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink">
        {roleCopy.wordLine}
      </p>
      {role === 'mrwhite' ? (
        <p className="pnp-pop-in border-b-3 border-dashed border-ink px-6 font-display text-2xl uppercase text-ink">
          {copy.roles.mrWhite.blankLine}
        </p>
      ) : (
        <p className="pnp-pop-in font-display text-4xl uppercase text-ink">{word}</p>
      )}
      <p className="font-ui text-sm font-medium text-ink">{roleCopy.flavor}</p>
      <p className="font-ui text-sm font-medium text-ink">{roleCopy.goalLine}</p>
      <span className="rounded-lg border-3 border-ink bg-paper-2 px-3 py-1 font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-ink shadow-hard-sm">
        {roleCopy.reminderChip}
      </span>
      {dealCardLine ? (
        <span
          data-testid="pnp-deal-special-role-line"
          className="rounded-lg border-3 border-ink bg-highlight px-3 py-1 font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-ink shadow-hard-sm"
        >
          {dealCardLine}
        </span>
      ) : null}
    </div>
  );
}
