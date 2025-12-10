'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { RedactedGamePlayer } from '@sketchy/engine/redact-for';
import type { SpecialRole } from '@sketchy/engine/types';
import { HintBanner } from '@/components/hints/hint-banner';
import { IconCheck } from '@/components/icons/icon-check';
import { IconEye } from '@/components/icons/icon-eye';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitDealAck } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

/** Faction → Tailwind text-color token (conventions.md §2: color is never the ONLY signal —
 * the role name text is always rendered alongside it). Mirrors `pnp/peek-card.tsx`'s palette
 * so the online and pass-and-play deal cards read as the same object. */
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
 * holder — packages/engine/ROLES.md). Lovebirds/Rivals (paired roles) interpolate
 * the partner's NAME — resolved from `you.lovebirdsPartnerId`/`you.rivalId` (a `you`-slice
 * concern, data-model.md "Phase 13 engine extension") against the public roster; `null` if
 * the partner can't be found (defensive — shouldn't happen given the engine's own
 * invariants).
 */
function specialRoleDealCardLine(
  specialRole: SpecialRole | null,
  lovebirdsPartnerId: string | null,
  rivalId: string | null,
  players: RedactedGamePlayer[],
): string | null {
  if (specialRole === 'judge') return copy.roles.special.judge.dealCardLine;
  if (specialRole === 'jester') return copy.roles.special.jester.dealCardLine;
  if (specialRole === 'grudge') return copy.roles.special.grudge.dealCardLine;
  if (specialRole === 'mirror') return copy.roles.special.mirror.dealCardLine;
  if (specialRole === 'lovebirds') {
    const partner = players.find((p) => p.id === lovebirdsPartnerId);
    return partner ? copy.roles.special.lovebirds.dealCardLine(partner.name) : null;
  }
  if (specialRole === 'rivals') {
    const rival = players.find((p) => p.id === rivalId);
    return rival ? copy.roles.special.rivals.dealCardLine(rival.name) : null;
  }
  return null;
}

/**
 * The online deal screen (game-design.md §6.1) — the same press-and-hold privacy ritual as
 * pass-and-play's `PnpPeekCard` (components/pnp/peek-card.tsx), rebuilt against
 * `room-store`'s `you` slice instead of a local engine instance; the role-card anatomy
 * (title / word / flavor / goal / reminder chip) is intentionally identical.
 *
 * PRIVACY INVARIANT: every role/word rendered here comes from `you.role` / `you.word` — the
 * server's redacted slice for THIS viewer — never `state.players[i].role/word`, which is
 * `null` for everyone but yourself/eliminated players/game-over by construction
 * (redact-for.ts's redaction matrix). There is no other code path to a secret here.
 */
export function DealScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [peeking, setPeeking] = useState(false);
  const [hasPeeked, setHasPeeked] = useState(false);
  // Optimistic UI for OUR OWN pending ack (api-contract.md §2.3 rule 4) — reconciled for
  // free once the next snapshot flips `me.hasSeenWord` true (that OR below covers both a
  // fresh ack and a resync/rejoin that finds we'd already acked before).
  const [ackSentLocally, setAckSentLocally] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [isAcking, setIsAcking] = useState(false);

  if (!snapshot || !you) {
    return null;
  }

  const me = snapshot.players.find((p) => p.id === you.playerId);
  const isAcked = ackSentLocally || (me?.hasSeenWord ?? false);
  const role = you.role as BaseRole | null;

  function startPeek(): void {
    setPeeking(true);
    setHasPeeked(true);
  }

  function stopPeek(): void {
    setPeeking(false);
  }

  async function handleAck(): Promise<void> {
    setIsAcking(true);
    setAckError(null);
    const ack = await emitDealAck();
    setIsAcking(false);
    if (ack.ok) {
      setAckSentLocally(true);
    } else {
      setAckError(copyForError(ack.error));
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <HintBanner
        hintId="peekCard"
        headline={copy.hints.peekCard.headline}
        body={copy.hints.peekCard.body}
      />
      <PopCard
        tone="hero"
        data-testid="online-deal-card"
        data-role={peeking && role ? role : undefined}
        data-word={peeking ? (you.word ?? '') : undefined}
        onPointerDown={startPeek}
        onPointerUp={stopPeek}
        onPointerCancel={stopPeek}
        onPointerLeave={stopPeek}
        className="flex min-h-[24rem] w-full max-w-sm select-none flex-col items-center justify-center gap-4 py-10"
      >
        {/* Deal card flip (design-party-pop.md §7 "Flip" + "Pop-in") — mirrors
            `pnp/peek-card.tsx`'s identical treatment, see that file's comment. */}
        <div key={peeking ? 'front' : 'back'} className="pnp-flip-card flex flex-col items-center gap-4">
          {peeking && role ? (
            <RoleFace
              role={role}
              word={you.word}
              specialRole={you.specialRole}
              lovebirdsPartnerId={you.lovebirdsPartnerId}
              rivalId={you.rivalId}
              players={snapshot.players}
            />
          ) : (
            <CardBack hasPeeked={hasPeeked} />
          )}
        </div>
      </PopCard>

      <PopButton
        type="button"
        variant="secondary"
        data-testid="online-peek-toggle"
        aria-pressed={peeking}
        onClick={() => (peeking ? stopPeek() : startPeek())}
      >
        <IconEye className="h-4 w-4" />
        {peeking ? copy.pnp.peekA11y.hide : copy.pnp.peekA11y.show}
      </PopButton>

      <PopButton
        type="button"
        variant="primary"
        size="lg"
        data-testid="online-deal-ack"
        disabled={isAcking || isAcked}
        onClick={() => {
          void handleAck();
        }}
      >
        {isAcked ? <IconCheck className="h-4 w-4 text-success" aria-hidden="true" /> : null}
        {copy.roles.dealChrome.confirm}
      </PopButton>

      {ackError ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {ackError}
        </p>
      ) : null}
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
  lovebirdsPartnerId,
  rivalId,
  players,
}: {
  role: BaseRole;
  word: string | null;
  specialRole: SpecialRole | null;
  lovebirdsPartnerId: string | null;
  rivalId: string | null;
  players: RedactedGamePlayer[];
}) {
  const roleCopy = ROLE_COPY[role];
  const dealCardLine = specialRoleDealCardLine(specialRole, lovebirdsPartnerId, rivalId, players);
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
          data-testid="deal-special-role-line"
          className="rounded-lg border-3 border-ink bg-highlight px-3 py-1 font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-ink shadow-hard-sm"
        >
          {dealCardLine}
        </span>
      ) : null}
    </div>
  );
}
