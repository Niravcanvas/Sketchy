'use client';

import { useState } from 'react';
import type { ReportReason } from '@sketchy/shared/contract/reports';
import { PopButton } from '@/components/pop/pop-button';
import { PopDialog } from '@/components/pop/pop-dialog';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { emitKick } from '@/lib/socket';
import { useBlocksStore } from '@/stores/blocks-store';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'name', label: copy.matchmaking.moderation.reasonName },
  { value: 'chat', label: copy.matchmaking.moderation.reasonChat },
  { value: 'clue', label: copy.matchmaking.moderation.reasonClue },
  { value: 'other', label: copy.matchmaking.moderation.reasonOther },
];

type Mode = 'menu' | 'report';

/**
 * Per-player report / block / kick-&-report affordance (copy.md
 * §17.4). Rendered as a sibling of the player card (never nested in it — a
 * card is itself a button). Report captures the room's recent context
 * server-side (the client just names the reason/detail); block is a local +
 * server op; "kick & report" (host, lobby only) fires the existing `lobby:kick`
 * AND a report — a UI combination of two existing operations, so no frozen
 * socket shape changed.
 */
export function PlayerModeration({
  playerId,
  playerName,
  roomCode,
  canKick,
}: {
  playerId: string;
  playerName: string;
  roomCode: string | null;
  canKick: boolean;
}) {
  const block = useBlocksStore((state) => state.block);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [reason, setReason] = useState<ReportReason>('other');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function close(): void {
    setOpen(false);
    setMode('menu');
    setReason('other');
    setDetail('');
    setBusy(false);
    setDone(null);
  }

  async function sendReport(kick: boolean): Promise<void> {
    setBusy(true);
    if (kick) {
      await emitKick(playerId);
    }
    try {
      await apiClient.createReport({
        reportedPlayerId: playerId,
        roomCode: roomCode ?? undefined,
        reason,
        detail: detail.trim() || undefined,
      });
      setDone(copy.matchmaking.moderation.reportSentToast);
    } catch {
      setDone(copy.errors.generic500);
    } finally {
      setBusy(false);
    }
  }

  async function doBlock(): Promise<void> {
    setBusy(true);
    await block(playerId);
    setBusy(false);
    setDone(copy.matchmaking.moderation.blockedToast);
  }

  return (
    <>
      <button
        type="button"
        data-testid="player-moderation-trigger"
        data-player-id={playerId}
        aria-label={copy.matchmaking.moderation.moderateAria(playerName)}
        onClick={() => setOpen(true)}
        className="font-ui text-xs font-bold text-graphite underline"
      >
        {copy.matchmaking.moderation.report}
        {' · '}
        {copy.matchmaking.moderation.block}
      </button>

      <PopDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={
          mode === 'report'
            ? copy.matchmaking.moderation.reportTitle(playerName)
            : copy.matchmaking.moderation.blockTitle(playerName)
        }
        description={
          mode === 'report'
            ? copy.matchmaking.moderation.reportBody
            : copy.matchmaking.moderation.menuDescription(playerName)
        }
        // The menu branch has no room for a visible line above its buttons;
        // keep the Radix-required description for screen readers only.
        descriptionHidden={mode === 'menu'}
        closeLabel={copy.matchmaking.moderation.cancel}
      >
        {done ? (
          <p role="status" data-testid="moderation-done" className="font-ui text-sm text-ink">
            {done}
          </p>
        ) : mode === 'menu' ? (
          <div className="flex flex-col gap-2" data-testid="moderation-menu">
            <PopButton type="button" variant="secondary" onClick={() => setMode('report')}>
              {copy.matchmaking.moderation.report}
            </PopButton>
            <PopButton
              type="button"
              variant="secondary"
              disabled={busy}
              data-testid="moderation-block"
              onClick={() => {
                void doBlock();
              }}
            >
              {copy.matchmaking.moderation.block}
            </PopButton>
            {canKick ? (
              <PopButton
                type="button"
                variant="danger"
                disabled={busy}
                data-testid="moderation-kick-report"
                onClick={() => {
                  void sendReport(true);
                }}
              >
                {copy.matchmaking.moderation.kickAndReport}
              </PopButton>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="report-form">
            <fieldset className="flex flex-col gap-1">
              {REASONS.map((r) => (
                <label key={r.value} className="flex items-center gap-2 font-ui text-sm text-ink">
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="accent-civilian"
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <PopInput
              label={copy.matchmaking.moderation.reportDetailLabel}
              placeholder={copy.matchmaking.moderation.reportDetailPlaceholder}
              value={detail}
              maxLength={500}
              onChange={(event) => setDetail(event.target.value)}
              data-testid="report-detail"
            />
            <div className="flex justify-end gap-2">
              <PopButton type="button" variant="secondary" onClick={() => setMode('menu')}>
                {copy.matchmaking.moderation.cancel}
              </PopButton>
              <PopButton
                type="button"
                variant="primary"
                disabled={busy}
                data-testid="report-send"
                onClick={() => {
                  void sendReport(false);
                }}
              >
                {copy.matchmaking.moderation.reportSend}
              </PopButton>
            </div>
          </div>
        )}
      </PopDialog>
    </>
  );
}
