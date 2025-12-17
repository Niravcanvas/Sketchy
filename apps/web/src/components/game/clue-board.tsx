'use client';

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { SKIPPED_CLUE } from '@sketchy/engine/constants';
import type { Clue } from '@sketchy/engine/types';
import { copy } from '@/copy';
import { playSound } from '@/lib/sound';

export interface ClueBoardProps {
  clues: Clue[];
  players: { id: string; name: string }[];
}

/**
 * Per-note tilt, indexed deterministically off each note's position within its round (no
 * `Math.random` in render — conventions.md §4's engine RNG ban doesn't reach apps/web, but
 * render output must still stay stable across re-renders / SSR-hydration regardless).
 */
const NOTE_ROTATIONS = [
  '-rotate-2',
  'rotate-1',
  '-rotate-1',
  'rotate-2',
  '-rotate-3',
  'rotate-3',
] as const;

/** Groups an append-only clue log by round, preserving first-seen round order. Clues are
 * always appended in non-decreasing round order (engine invariant), so insertion order into
 * the Map is already the right display order — no explicit numeric sort needed. */
function groupByRound(clues: Clue[]): [number, Clue[]][] {
  const byRound = new Map<number, Clue[]>();
  for (const clue of clues) {
    const bucket = byRound.get(clue.round);
    if (bucket) {
      bucket.push(clue);
    } else {
      byRound.set(clue.round, [clue]);
    }
  }
  return [...byRound.entries()];
}

/**
 * The clue board (game-design.md §3.3): a board of sticker-note clues grouped by round, each
 * signed with its author's name. Each note Pop-ins as it lands (design-party-pop.md §7 — the
 * `.pnp-pop-in` keyframe, with a `prefers-reduced-motion` fade fallback in globals.css);
 * notes are keyed by position so only a newly-appended clue animates, not the whole board on
 * every re-render. Pure presentational — no store access — so online phases (this component
 * is built for that reuse from day one) can render it straight off a redacted `GameState`'s
 * `clues`/`players` without any P&P-specific wiring.
 */
export function ClueBoard({ clues, players }: ClueBoardProps) {
  const nameById = new Map(players.map((p) => [p.id, p.name]));
  const rounds = groupByRound(clues);

  // Pencil-scratch sound — fires once per newly-APPENDED, genuinely
  // pinned clue (never on first mount/hydration, never for a skip: `SKIPPED_CLUE` entries
  // land here too but aren't a "pin"). `ClueBoard` is the single point both online and P&P
  // typed-clue screens render through, so this one effect covers both modes.
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    const previous = prevCount.current;
    prevCount.current = clues.length;
    if (previous === null || clues.length <= previous) {
      return;
    }
    const latest = clues[clues.length - 1];
    if (latest && latest.text !== SKIPPED_CLUE) {
      playSound('pencil-scratch');
    }
  }, [clues]);

  return (
    <div
      data-testid="clue-board"
      className="flex max-h-[28rem] flex-col gap-6 overflow-y-auto p-2"
    >
      {rounds.map(([round, roundClues]) => (
        <section key={round} className="flex flex-col gap-3">
          <h3 className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink">
            {copy.phases.status.roundClues(round)}
          </h3>
          <div className="flex flex-wrap gap-4">
            {roundClues.map((clue, index) => {
              const isSkipped = clue.text === SKIPPED_CLUE;
              const seed = `clue-note-${clue.round}-${clue.playerId}-${index}`;
              const authorName = nameById.get(clue.playerId) ?? '';

              return (
                // The Pop-in lives on this wrapper, NOT the note itself: `.pnp-pop-in`
                // animation-fills `transform: scale(1)`, which would otherwise clobber the
                // note's static sticker tilt (its own `transform: rotate(...)`). Wrapper
                // scales; inner keeps its rotation.
                <div key={seed} className="pnp-pop-in shrink-0">
                  <div
                    data-testid="clue-note"
                    data-round={clue.round}
                    data-skipped={isSkipped ? 'true' : 'false'}
                    className={clsx(
                      'w-40 rounded-xl border-3 border-ink bg-paper-2 px-4 py-3 text-center shadow-hard-sm',
                      NOTE_ROTATIONS[index % NOTE_ROTATIONS.length],
                      isSkipped && 'opacity-70',
                    )}
                  >
                    <p
                      className={clsx(
                        'font-ui text-base font-medium italic leading-snug',
                        isSkipped ? 'text-graphite' : 'text-ink',
                      )}
                    >
                      {isSkipped ? copy.phases.clue.skipped : clue.text}
                    </p>
                    {/* Mime special role: the clue-board note for whichever round
                        this was gestured, not spoken (copy.md's "🎭 (mimed)"). Never shown for
                        a skipped turn (Clue.mimed is never true for one — reducers/clue.ts). */}
                    {clue.mimed ? (
                      <p
                        data-testid="clue-note-mimed"
                        className="mt-1 font-ui text-xs font-bold text-ink"
                      >
                        {copy.roles.special.mime.cluedNote}
                      </p>
                    ) : null}
                    <p className="mt-2 font-ui text-sm font-medium italic text-graphite">
                      {authorName}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
