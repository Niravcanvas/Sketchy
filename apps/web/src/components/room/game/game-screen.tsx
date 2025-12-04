'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import type { Phase } from '@sketchy/engine/types';
import { ChatDrawer } from '@/components/room/chat-drawer';
import { PlayerStrip } from '@/components/room/player-strip';
import { Toasts } from '@/components/room/toasts';
import { copy } from '@/copy';
import { useRoomStore } from '@/stores/room-store';
import { ClueScreen } from './clue-screen';
import { DealScreen } from './deal-screen';
import { DiscussionScreen } from './discussion-screen';
import { GuessInterlude } from './guess-interlude';
import { OnlineGrudgeDecisionScreen } from './grudge-decision-screen';
import { OnlineJudgeDecisionScreen } from './judge-decision-screen';
import { OnlineMrWhiteScreen } from './mrwhite-screen';
import { OnlineRevealScreen } from './reveal-screen';
import { OnlineVoteScreen } from './vote-screen';
import { OnlineWinScreen } from './win-screen';
import { StatusStrip } from './status-strip';

function phaseView(phase: Phase): ReactNode {
  switch (phase) {
    case 'dealing':
      return <DealScreen />;
    case 'clue':
    case 'tiebreak_clue':
      return <ClueScreen />;
    case 'discussion':
      return <DiscussionScreen />;
    case 'voting':
      return <OnlineVoteScreen />;
    case 'judge_decision':
      return <OnlineJudgeDecisionScreen />;
    case 'grudge_decision':
      return <OnlineGrudgeDecisionScreen />;
    case 'reveal':
      return <OnlineRevealScreen />;
    case 'mrwhite_guess':
      return <OnlineMrWhiteScreen />;
    default:
      // `game_over` is handled full-bleed above; `lobby` never mounts GameScreen.
      return null;
  }
}

/** Phase → screen background (design-party-pop.md §10): the whole game view flips color as
 * play moves through deal/clue → discussion → vote → reveal. `judge_decision`/
 * `grudge_decision` reuse the vote phase's background — each is a continuation of an
 * elimination already in motion, not a new phase-color moment (design-party-pop.md §14
 * "choose the quieter option" when unspecified). */
function phaseBackground(phase: Phase): string {
  switch (phase) {
    case 'discussion':
      return 'bg-phase-discuss';
    case 'voting':
    case 'judge_decision':
    case 'grudge_decision':
      return 'bg-phase-vote';
    case 'reveal':
    case 'mrwhite_guess':
      return 'bg-phase-reveal';
    default:
      // dealing / clue / tiebreak_clue
      return 'bg-paper';
  }
}

/**
 * The non-lobby game view (game-design.md §6) — mounted by `app/r/[code]/page.tsx` for
 * every phase other than `lobby`. Composition root: `StatusStrip` (persistent chrome, §3.1)
 * + the phase-specific middle view + `PlayerStrip` (§3.2) + `ChatDrawer` (§3.4) + `Toasts`
 * (§8), reusing the exact same shared chrome components the lobby screen composes rather
 * than duplicating them.
 *
 * `game_over` is the exception: the win screen is a full-bleed winning-faction takeover
 * (design-party-pop.md §10), so it replaces the standard chrome entirely (chat + toasts stay
 * for post-game banter).
 */
export function GameScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const status = useRoomStore((state) => state.status);
  const pushLocalToast = useRoomStore((state) => state.pushLocalToast);

  // The Judge tie-announcement / Grudge drag-down toasts — purely
  // client-derived off the snapshot's own phase transition (no dedicated server
  // `room:event` for either, room-store.ts's `pushLocalToast` doc comment). Each fires
  // every time its phase is (re-)entered, not just the first (copy.md §6 "Whenever a vote
  // ties, the Judge decides"). The ref (not React state) is what makes this idempotent
  // across re-renders within the SAME judge_decision/grudge_decision instance.
  const prevPhaseRef = useRef<Phase | null>(null);
  useEffect(() => {
    if (
      snapshot &&
      snapshot.phase === 'judge_decision' &&
      prevPhaseRef.current !== 'judge_decision'
    ) {
      pushLocalToast('judgeTiebreak', copy.roles.special.judge.tieAnnouncement);
    }
    if (
      snapshot &&
      snapshot.phase === 'grudge_decision' &&
      prevPhaseRef.current !== 'grudge_decision'
    ) {
      const grudge = snapshot.players.find((p) => p.specialRole === 'grudge');
      if (grudge) {
        pushLocalToast('grudgeDecision', copy.roles.special.grudge.announcement(grudge.name));
      }
    }
    prevPhaseRef.current = snapshot?.phase ?? null;
  }, [snapshot, pushLocalToast]);

  // The Mime round toast (copy.md §3.2 "public toast") — fires whenever
  // `mimeId` changes to a new non-null holder (a fresh round's draw), keyed the same
  // client-derived way as the toasts above. The ref tracks the LAST id we've already
  // announced so a snapshot re-render within the same round never re-fires it.
  const prevMimeIdRef = useRef<string | null>(null);
  useEffect(() => {
    const mimeId = snapshot?.mimeId ?? null;
    if (mimeId && mimeId !== prevMimeIdRef.current) {
      const mime = snapshot?.players.find((p) => p.id === mimeId);
      if (mime) {
        pushLocalToast('mimeRound', copy.roles.special.mime.roundToast(mime.name));
      }
    }
    prevMimeIdRef.current = mimeId;
  }, [snapshot, pushLocalToast]);

  if (!snapshot) {
    return null;
  }

  if (snapshot.phase === 'game_over') {
    return (
      <>
        <Toasts />
        <OnlineWinScreen />
        <ChatDrawer />
      </>
    );
  }

  // Eliminated players keep watching (clue board, chat, reveals) but lose inputs
  // (game-design.md §9) — their `canAct.*` flags are already false engine-side; this banner
  // sets the "you're out, heckle away" tone. Ghost swaps to the Ghost variant
  // (copy.md §8) — they still vote, so the tone shifts from "you're done" to "haunt on".
  const me = snapshot.players.find((p) => p.id === you?.playerId);
  const isSpectator = me ? !me.alive : false;
  const ghostActive = snapshot.settings.specialRoles.includes('ghost');
  const eliminatedBannerText = ghostActive
    ? copy.roles.special.ghost.eliminatedBanner
    : copy.presence.eliminatedSelf;

  return (
    <main
      className={clsx(
        'mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12 transition-colors duration-300',
        phaseBackground(snapshot.phase),
      )}
    >
      <Toasts />
      {status === 'reconnecting' ? (
        <p role="status" className="text-center font-ui text-sm text-graphite">
          {copy.presence.reconnectingSelf}
        </p>
      ) : null}
      {isSpectator ? (
        <p
          role="status"
          data-testid="online-eliminated-banner"
          data-ghost={ghostActive}
          className={clsx(
            'rounded-xl border-3 border-ink px-4 py-2 text-center font-ui text-sm font-bold text-white shadow-hard-sm',
            ghostActive ? 'bg-graphite' : 'bg-undercover',
          )}
        >
          {eliminatedBannerText}
        </p>
      ) : null}
      <GuessInterlude />
      <StatusStrip />
      {phaseView(snapshot.phase)}
      <PlayerStrip />
      <ChatDrawer />
    </main>
  );
}
