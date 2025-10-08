'use client';

import { useState } from 'react';
import {
  DEAL_TIMEOUT_SEC,
  MRWHITE_GUESS_SEC,
  REVEAL_AUTO_ADVANCE_SEC,
} from '@sketchy/engine/constants';
import type { RedactedGameState } from '@sketchy/engine/redact-for';
import { PopButton } from '@/components/pop/pop-button';
import { PopTimerRing } from '@/components/pop/pop-timer-ring';
import { VoicePill } from '@/components/room/voice-pill';
import { copy } from '@/copy';
import { emitTimerExtend } from '@/lib/socket';
import { useCountdown } from '@/lib/use-clock-offset';
import { useRoomStore } from '@/stores/room-store';

/** The §6 phase label (game-design.md §3.1) — `dealing` is handled separately by the
 * caller (its status-strip line is the "waiting for N to peek" count, not a phase name),
 * and phases beyond this phase's scope (`mrwhite_guess`/`game_over`) fall back to `''`
 * rather than guessing at unscripted copy — those screens own their own heading instead. */
function phaseLabel(state: RedactedGameState): string {
  switch (state.phase) {
    case 'clue':
      return copy.phases.status.roundClues(state.round);
    case 'tiebreak_clue':
      return copy.phases.status.tiebreaker;
    case 'discussion':
      return copy.phases.status.discussion;
    case 'voting':
      return copy.phases.status.theVote;
    case 'reveal':
      return copy.phases.status.theReveal;
    default:
      return '';
  }
}

/** The nominal duration (seconds) for whichever phase is currently timed, so the ring's
 * `progress` (elapsed fraction) can be computed from `useCountdown`'s remaining seconds.
 * Untimed presets (`settings.*TimerSec === null`) never reach here in practice — the server
 * only sets `phaseEndsAt` for a concrete deadline (`timerEffects`, engine/reducers/shared.ts)
 * — but the type is still nullable, so a `null` total degrades to a static full ring rather
 * than a crash. */
function totalTimerSec(state: RedactedGameState): number | null {
  switch (state.phase) {
    case 'dealing':
      return DEAL_TIMEOUT_SEC;
    case 'clue':
    case 'tiebreak_clue':
      return state.settings.clueTimerSec;
    case 'discussion':
      return state.settings.discussionTimerSec;
    case 'voting':
      return state.settings.voteTimerSec;
    case 'reveal':
      return REVEAL_AUTO_ADVANCE_SEC;
    case 'mrwhite_guess':
      return MRWHITE_GUESS_SEC;
    default:
      return null;
  }
}

/**
 * Persistent top-of-screen chrome for every non-lobby phase (game-design.md §3.1):
 * phase name + round, a hand-drawn countdown ring driven by `state.phaseEndsAt` (never a
 * client-side deadline decision — api-contract.md §2.3 rule 3), and the host's once-per-
 * phase `+60s` extend chip when `you.canAct.extendTimer`.
 */
export function StatusStrip() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [isExtending, setIsExtending] = useState(false);

  const remaining = useCountdown(snapshot?.phaseEndsAt ?? null);

  if (!snapshot) {
    return null;
  }

  const totalSec = totalTimerSec(snapshot);
  const progress = remaining !== null && totalSec ? 1 - remaining / totalSec : 0;

  const waitingCount =
    snapshot.phase === 'dealing'
      ? snapshot.players.filter((p) => p.alive && !p.hasSeenWord).length
      : 0;

  async function handleExtend(): Promise<void> {
    setIsExtending(true);
    setExtendError(null);
    const ack = await emitTimerExtend();
    setIsExtending(false);
    if (!ack.ok) {
      setExtendError(copy.errors.generic500);
    }
  }

  return (
    <div data-testid="status-strip" className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center justify-between gap-4">
        <p
          className="font-display text-2xl uppercase tracking-wide text-ink"
          data-testid="status-strip-label"
        >
          {snapshot.phase === 'dealing'
            ? copy.roles.dealChrome.waitingForPeek(waitingCount)
            : phaseLabel(snapshot)}
        </p>
        {you?.canAct.extendTimer ? (
          <PopButton
            type="button"
            variant="secondary"
            data-testid="extend-timer"
            disabled={isExtending}
            onClick={() => {
              void handleExtend();
            }}
          >
            {copy.glossary.extendTimer}
          </PopButton>
        ) : null}
      </div>

      {remaining !== null ? (
        <PopTimerRing progress={progress} color="highlight" size={72}>
          {/* key per tick so each new second pops in (design-party-pop.md §7). */}
          <span key={remaining} className="pnp-pop-in tabular-nums">
            {remaining}
          </span>
        </PopTimerRing>
      ) : null}

      {extendError ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {extendError}
        </p>
      ) : null}

      {/* In-game "Join voice" pill (game-design.md §10) — the same
          component the lobby renders in `cheat-sheet-card.tsx`. */}
      <VoicePill />
    </div>
  );
}
