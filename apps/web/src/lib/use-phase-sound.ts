'use client';

import { useEffect, useRef } from 'react';
import type { Phase } from '@sketchy/engine/types';
import { playSound, type SoundKey } from './sound';

/** Which sound (if any) marks a transition INTO this phase ("page
 * turn" on an ordinary phase change, a reveal sting on the two reveal-adjacent phases, the
 * win horn on game over). `lobby` is silent — re-entering it (e.g. a rematch loop that ever
 * routes back through lobby) shouldn't sound like every other phase flip. */
function soundForPhase(phase: Phase): SoundKey | null {
  switch (phase) {
    case 'reveal':
    case 'mrwhite_guess':
      return 'reveal-sting';
    case 'game_over':
      return 'win-horn';
    case 'lobby':
      return null;
    default:
      // dealing, clue, tiebreak_clue, discussion, voting, judge_decision, grudge_decision.
      return 'page-turn';
  }
}

/**
 * Plays a phase-transition sound whenever `phase` changes — never
 * on first mount/hydration, so loading straight into a game already in progress (a refresh,
 * a rejoin) doesn't fire a sound out of nowhere the instant the snapshot arrives. Shared by
 * `PnpGame` (pass-and-play) and the online room route — both derive one `Phase | null` and
 * hand it here; the mapping itself only depends on the engine's `Phase` enum, never on which
 * mode produced it.
 */
export function usePhaseSound(phase: Phase | null): void {
  const prevPhase = useRef<Phase | null>(null);

  useEffect(() => {
    const previous = prevPhase.current;
    prevPhase.current = phase;
    if (phase === null || previous === null || previous === phase) {
      return;
    }
    const key = soundForPhase(phase);
    if (key) {
      playSound(key);
    }
  }, [phase]);
}
