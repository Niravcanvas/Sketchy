'use client';

import { useState, type ReactNode } from 'react';
import { IconCheck } from '@/components/icons/icon-check';
import { IconCopy } from '@/components/icons/icon-copy';
import { IconLink } from '@/components/icons/icon-link';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

/** How long the copy-confirmation checkmark stays swapped in before reverting. */
const COPIED_RESET_MS = 2000;

export interface RoomCodeHeroProps {
  code: string;
}

/**
 * The lobby's hero element (game-design.md §3.1/§5 — "Room code is the hero element of the
 * screen"): the code itself HUGE, plus the three copy actions (copy.md §4). `joinUrl` is
 * derived from `window.location.origin` — SSR-safe fallback to a relative path since this
 * only ever renders after the room route has already resolved client-side.
 */
export function RoomCodeHero({ code }: RoomCodeHeroProps) {
  const joinUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/r/${code}` : `/r/${code}`;

  return (
    <PopCard
      tone="hero"
      data-testid="room-code-hero"
      className="flex flex-col items-center gap-3 text-center"
    >
      <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink">
        {copy.rooms.hero.label}
      </p>
      <p className="font-display text-4xl uppercase tracking-[0.12em] text-ink">{code}</p>
      <p className="font-ui text-sm font-medium text-ink">{copy.rooms.hero.tagline}</p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <CopyButton
          testId="copy-code"
          label={copy.rooms.actions.copyCode}
          icon={<IconCopy className="h-4 w-4" />}
          getText={() => code}
        />
        <CopyButton
          testId="copy-link"
          label={copy.rooms.actions.copyLink}
          icon={<IconLink className="h-4 w-4" />}
          getText={() => joinUrl}
        />
        <CopyButton
          testId="copy-invite"
          label={copy.rooms.actions.copyInvite}
          icon={<IconCopy className="h-4 w-4" />}
          getText={() => copy.rooms.inviteMessage(code, joinUrl)}
        />
      </div>
    </PopCard>
  );
}

interface CopyButtonProps {
  testId: string;
  label: string;
  icon: ReactNode;
  getText: () => string;
}

/** One copy action: writes `getText()` to the clipboard, then swaps its icon to a checkmark
 * and announces `copy.rooms.actions.copied` via `aria-live` for ~2s (conventions.md §4 —
 * copied-confirmation needs an aria-live region, not just a visual icon swap). */
function CopyButton({ testId, label, icon, getText }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick(): Promise<void> {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard permission denied / unsupported (e.g. insecure context) — no confirmation,
      // no crash; the player can still select-and-copy the huge code manually.
    }
  }

  return (
    <PopButton
      type="button"
      variant="secondary"
      size="md"
      data-testid={testId}
      onClick={() => {
        void handleClick();
      }}
    >
      {copied ? <IconCheck className="h-4 w-4 text-success" aria-hidden="true" /> : icon}
      {label}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copy.rooms.actions.copied : ''}
      </span>
    </PopButton>
  );
}
