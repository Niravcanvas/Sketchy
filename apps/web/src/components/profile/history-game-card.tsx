'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { Faction } from '@sketchy/engine/types';
import type { GameHistoryItem } from '@sketchy/shared/contract/players';
import { IconArrowRight } from '@/components/icons/icon-arrow-right';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { RoundSummary } from './round-summary';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

function roleTitle(role: BaseRole): string {
  if (role === 'civilian') return copy.roles.civilian.cardTitle;
  if (role === 'undercover') return copy.roles.undercover.cardTitle;
  return copy.roles.mrWhite.cardTitle;
}

/** Winner faction label(s) — mirrors `win-screen.tsx`'s local `winnerLabels`, joined for the
 * compact card layout rather than rendered as separate chips. */
function winnerFactionLabel(faction: Faction): string {
  if (faction === 'civilian') return copy.roles.civilian.cardTitle;
  if (faction === 'undercover') return copy.roles.undercover.cardTitle;
  if (faction === 'mrwhite') return copy.roles.mrWhite.cardTitle;
  return `${copy.roles.undercover.cardTitle} & ${copy.roles.mrWhite.cardTitle}`;
}

const ROLE_TEXT_CLASS: Record<BaseRole, string> = {
  civilian: 'text-civilian',
  undercover: 'text-undercover',
  mrwhite: 'text-mrwhite',
};

function formatGameDate(endedAtMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(endedAtMs));
}

/** Assembles the card's meta line as ONE string (date/mode/room-code data, not copy — same
 * "format outside copy.ts, render as a single expression" pattern `avatar-picker.tsx`'s
 * `formatPartLabel` uses) so the "·" separators never appear as bare JSX text nodes. */
function formatMetaLine(item: GameHistoryItem): string {
  return `${formatGameDate(item.endedAt)} · ${copy.profile.history.modeLabels[item.mode]} · ${item.roomCode}`;
}

export function HistoryGameCard({ item }: { item: GameHistoryItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <PopCard className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-ui text-sm font-medium text-graphite">{formatMetaLine(item)}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'font-display text-sm uppercase tracking-wide',
              ROLE_TEXT_CLASS[item.myRole],
            )}
          >
            {roleTitle(item.myRole)}
          </span>
          <span className="font-display text-xl text-ink">{item.myPoints}</span>
        </div>
        <span className="font-ui text-sm font-medium text-graphite">
          {item.winnerFaction
            ? winnerFactionLabel(item.winnerFaction)
            : copy.profile.history.abandoned}
        </span>
      </div>

      <p className="font-ui text-sm text-ink">
        {copy.reveal.fullReveal.pairLine(item.civilianWord, item.undercoverWord)}
      </p>

      <button
        type="button"
        data-testid="history-round-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex items-center gap-2 self-start font-ui text-sm font-semibold text-ink"
      >
        <IconArrowRight className={clsx('h-4 w-4 transition-transform', expanded && 'rotate-90')} />
        {copy.profile.history.roundByRoundToggle}
      </button>

      {expanded ? <RoundSummary gameId={item.gameId} /> : null}
    </PopCard>
  );
}
