'use client';

import { useEffect } from 'react';
import type { GameState } from '@sketchy/engine/types';
import { copy } from '@/copy';
import { currentRitualPlayer, usePnpStore } from '@/stores/pnp-store';
import { PassInterstitial } from '@/components/pnp/pass-interstitial';
import { PnpClueScreen } from '@/components/pnp/clue-screen';
import { PnpDiscussionScreen } from '@/components/pnp/discussion-screen';
import { PnpGrudgeDecisionScreen } from '@/components/pnp/grudge-decision-screen';
import { PnpInterludeOverlay } from '@/components/pnp/interlude-overlay';
import { PnpJudgeDecisionScreen } from '@/components/pnp/judge-decision-screen';
import { PnpMrWhiteScreen } from '@/components/pnp/mrwhite-screen';
import { PnpPeekCard } from '@/components/pnp/peek-card';
import { PnpResumePrompt } from '@/components/pnp/resume-prompt';
import { PnpRevealScreen } from '@/components/pnp/reveal-screen';
import { PnpSetupScreen } from '@/components/pnp/setup-screen';
import { PnpVoteScreen } from '@/components/pnp/vote-screen';
import { PnpWinScreen } from '@/components/pnp/win-screen';
import { MuteToggle } from '@/components/sound/mute-toggle';
import { usePhaseSound } from '@/lib/use-phase-sound';

/**
 * The pass-and-play view router: `game.phase` (plus the ritual ui slice)
 * decides the screen — screens themselves never route. Boot order matters:
 * localStorage is only readable client-side, so the first paint is empty
 * until the mount effect either hydrates a checkpoint or seeds a fresh
 * lobby. The effect only mutates the zustand store (whose update is what
 * re-renders us) — no React state involved, so the react-hooks compiler
 * lints stay happy. A mid-game checkpoint sets `resumePromptPending` (the
 * copy.md §5 resume prompt); a lobby-phase checkpoint silently restores the
 * setup screen (names kept, nothing to "resume").
 */
export function PnpGame() {
  const game = usePnpStore((s) => s.game);
  const ritualConfirmed = usePnpStore((s) => s.ritual.confirmed);
  const confirmPass = usePnpStore((s) => s.confirmPass);
  const resumePromptPending = usePnpStore((s) => s.resumePromptPending);
  const dismissResumePrompt = usePnpStore((s) => s.dismissResumePrompt);

  useEffect(() => {
    const store = usePnpStore.getState();
    // Same-tab remount (client-side nav back to /play) — state is live; a
    // StrictMode second invocation lands here too and stays a no-op.
    if (store.game) return;
    if (store.hydrateFromCheckpoint()) return;
    store.initLobby();
  }, []);

  // Phase-transition sound — page-turn/reveal-sting/win-horn,
  // never gameplay-critical (game-design.md §1 pillar 1).
  usePhaseSound(game?.phase ?? null);

  if (!game) return null;

  if (resumePromptPending) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <PnpResumePrompt
          onResume={dismissResumePrompt}
          onStartFresh={() => usePnpStore.getState().resetToSetup()}
        />
      </main>
    );
  }

  let screen = null;
  switch (game.phase) {
    case 'lobby':
      screen = <PnpSetupScreen />;
      break;
    case 'dealing': {
      const player = currentRitualPlayer(game);
      // Engine invariant: dealing always has an un-acked player (the last
      // ack transitions to clue) — the null branch is unreachable belt.
      if (player && !ritualConfirmed) {
        screen = (
          <PassInterstitial
            title={copy.pnp.passInterstitial.prompt(player.name)}
            smallPrint={copy.pnp.passInterstitial.smallPrint}
            confirmLabel={copy.pnp.passInterstitial.confirm}
            onConfirm={confirmPass}
            testId="pnp-interstitial"
            playerName={player.name}
          />
        );
      } else if (player) {
        screen = <PnpPeekCard />;
      }
      break;
    }
    case 'clue':
    case 'tiebreak_clue':
      screen = <PnpClueScreen />;
      break;
    case 'discussion':
      screen = <PnpDiscussionScreen />;
      break;
    case 'voting':
      screen = <PnpVoteScreen />;
      break;
    case 'judge_decision':
      screen = <PnpJudgeDecisionScreen />;
      break;
    case 'grudge_decision':
      screen = <PnpGrudgeDecisionScreen />;
      break;
    case 'reveal':
      screen = <PnpRevealScreen />;
      break;
    case 'mrwhite_guess':
      screen = <PnpMrWhiteScreen />;
      break;
    case 'game_over':
      screen = <PnpWinScreen />;
      break;
  }

  return (
    <main className="min-h-screen">
      <MuteToggle />
      <div aria-live="polite" className="sr-only">
        {phaseAnnouncement(game)}
      </div>
      {screen}
      <PnpInterludeOverlay />
    </main>
  );
}

/**
 * conventions.md §4: an `aria-live` polite region announces phase changes.
 * Phases without a copy.md §6 status label (dealing, mrwhite_guess,
 * game_over) borrow the most informative line their screen already shows.
 */
function phaseAnnouncement(game: GameState): string | null {
  switch (game.phase) {
    case 'lobby':
      return copy.pnp.setup.title;
    case 'dealing': {
      const player = currentRitualPlayer(game);
      return player ? copy.pnp.passInterstitial.prompt(player.name) : null;
    }
    case 'clue':
      return copy.phases.status.roundClues(game.round);
    case 'tiebreak_clue':
      return copy.phases.status.tiebreaker;
    case 'voting':
      return game.revoteCount === 1 ? copy.phases.status.tiebreaker : copy.phases.status.theVote;
    case 'judge_decision':
      return copy.roles.special.judge.dealCardLine;
    case 'grudge_decision':
      return copy.roles.special.grudge.dealCardLine;
    case 'discussion':
      return copy.phases.status.discussion;
    case 'reveal':
      return copy.phases.status.theReveal;
    case 'mrwhite_guess':
      return copy.reveal.mrWhiteGuess.othersWaiting;
    case 'game_over':
      return copy.reveal.scoreboard.title;
  }
}
