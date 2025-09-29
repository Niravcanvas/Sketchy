'use client';

import { useState } from 'react';
import type { ErrorCode } from '@sketchy/shared/contract/errors';
import { PopButton } from '@/components/pop/pop-button';
import { PopDialog } from '@/components/pop/pop-dialog';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitReady, emitStartGame } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

/** `game:start` ack errors (api-contract.md §2.1) — `validation` is the engine's role-math /
 * min-players rejection (`applyStart`, packages/engine/src/reducers/deal.ts), so it gets the
 * precise §5 role-math line rather than the shared table's generic validation copy; every
 * other code reads from `copyForError`. */
function startErrorCopy(code: ErrorCode): string {
  if (code === 'validation') {
    return copy.pnp.steppers.roleMathError;
  }
  return copyForError(code);
}

/**
 * Ready toggle + the host "Start game" CTA (copy.md §4). Enabled once the server says
 * `you.canAct.start` (host, lobby, ≥3 seated — computed server-side, never re-derived here).
 * If every seated player is ready, starting is immediate; otherwise a force-start confirm
 * dialog gives the host an explicit "start anyway" (copy.md §4 ready flow).
 */
export function ReadyBar() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [forceStartOpen, setForceStartOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (!snapshot || !you) {
    return null;
  }

  const me = snapshot.players.find((player) => player.id === you.playerId);
  const isReady = me?.isReady ?? false;
  const isHost = snapshot.hostId === you.playerId;
  const canStart = you.canAct.start;
  const allReady = snapshot.players.every((player) => player.isReady);

  async function toggleReady(): Promise<void> {
    setIsSubmitting(true);
    await emitReady(!isReady);
    setIsSubmitting(false);
  }

  async function startGame(): Promise<void> {
    setIsStarting(true);
    setStartError(null);
    const ack = await emitStartGame();
    setIsStarting(false);
    if (ack.ok) {
      setForceStartOpen(false);
    } else {
      setStartError(startErrorCopy(ack.error));
    }
  }

  function handleStartClick(): void {
    if (allReady) {
      void startGame();
    } else {
      setStartError(null);
      setForceStartOpen(true);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <PopButton
        type="button"
        variant={isReady ? 'secondary' : 'primary'}
        size="lg"
        data-testid="ready-toggle"
        disabled={isSubmitting}
        onClick={() => {
          void toggleReady();
        }}
      >
        {isReady ? copy.rooms.ready.notReady : copy.rooms.ready.ready}
      </PopButton>
      {isHost ? (
        <PopButton
          type="button"
          variant="primary"
          size="lg"
          data-testid="start-game"
          disabled={!canStart || isStarting}
          onClick={handleStartClick}
        >
          {copy.glossary.startGame}
        </PopButton>
      ) : null}

      {startError && !forceStartOpen ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {startError}
        </p>
      ) : null}

      <PopDialog
        open={forceStartOpen}
        onOpenChange={setForceStartOpen}
        title={copy.rooms.ready.forceStartConfirm}
        closeLabel={copy.rooms.ready.wait}
      >
        {startError ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {startError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <PopButton
            type="button"
            variant="secondary"
            data-testid="force-start-cancel"
            onClick={() => setForceStartOpen(false)}
          >
            {copy.rooms.ready.wait}
          </PopButton>
          <PopButton
            type="button"
            variant="primary"
            disabled={isStarting}
            data-testid="force-start-confirm"
            onClick={() => {
              void startGame();
            }}
          >
            {copy.rooms.ready.start}
          </PopButton>
        </div>
      </PopDialog>
    </div>
  );
}
