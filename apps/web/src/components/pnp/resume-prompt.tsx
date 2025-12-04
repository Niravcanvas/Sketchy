'use client';

import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

export interface PnpResumePromptProps {
  onResume: () => void;
  onStartFresh: () => void;
}

/**
 * "Resume last game?" gate (game-design.md §4.6) — shown by the router when
 * `/play` boots into a mid-game localStorage checkpoint. This component only
 * renders the choice; the router owns what Resume/Start fresh actually do
 * (hydrate the live game vs. clear the checkpoint and go to setup).
 */
export function PnpResumePrompt({ onResume, onStartFresh }: PnpResumePromptProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <PopCard className="flex w-full max-w-md flex-col items-center gap-6 py-10">
        <p className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.pnp.resume.prompt}
        </p>
        <div className="flex gap-4">
          <PopButton
            variant="primary"
            size="lg"
            data-testid="pnp-resume"
            onClick={onResume}
          >
            {copy.pnp.resume.resume}
          </PopButton>
          <PopButton
            variant="secondary"
            size="lg"
            data-testid="pnp-start-fresh"
            onClick={onStartFresh}
          >
            {copy.pnp.resume.startFresh}
          </PopButton>
        </div>
      </PopCard>
    </div>
  );
}
