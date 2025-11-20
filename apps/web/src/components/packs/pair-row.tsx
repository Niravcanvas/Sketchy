'use client';

import { useState } from 'react';
import type { Difficulty } from '@sketchy/engine/types';
import type { Pair } from '@sketchy/shared/contract/packs';
import { IconTrash } from '@/components/icons/icon-trash';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';

const ALL_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const WORD_MAX_LENGTH = 40;
/** Decorative word-A/word-B separator — a module constant referenced via identifier, not a
 * JSX string literal (conventions.md §4 "no string literals in JSX"; same pattern as
 * pnp/setup-screen.tsx's STEP_DECREMENT/STEP_INCREMENT). */
const WORD_SEPARATOR = '/';

export interface PairRowProps {
  pair: Pair;
  /** Inline validation message from the editor's cross-row check (dupes/near-identical) —
   * purely advisory, never blocks typing. */
  warning?: string | null;
  onSave: (patch: { wordA: string; wordB: string; difficulty: Difficulty }) => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * One editable spreadsheet-style row in the pair editor: word A,
 * word B, a difficulty chip row, and a delete button. Edits are local until `Save` is
 * pressed — no silent auto-save, so a half-typed word never round-trips to the server.
 */
export function PairRow({ pair, warning, onSave, onDelete }: PairRowProps) {
  const [wordA, setWordA] = useState(pair.wordA);
  const [wordB, setWordB] = useState(pair.wordB);
  const [difficulty, setDifficulty] = useState<Difficulty>(pair.difficulty);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const dirty = wordA !== pair.wordA || wordB !== pair.wordB || difficulty !== pair.difficulty;
  const tooLong = wordA.length > WORD_MAX_LENGTH || wordB.length > WORD_MAX_LENGTH;

  async function handleSave(): Promise<void> {
    if (!dirty || isSaving || tooLong) return;
    setIsSaving(true);
    try {
      await onSave({ wordA: wordA.trim(), wordB: wordB.trim(), difficulty });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } catch {
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border-3 border-ink bg-paper-2 p-3 shadow-hard-sm"
      data-testid="pair-row"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={copy.packs.editor.wordALabel}
          value={wordA}
          maxLength={WORD_MAX_LENGTH + 10}
          onChange={(event) => setWordA(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border-3 border-ink bg-paper-2 px-3 py-2 font-ui font-medium text-ink"
        />
        <span aria-hidden="true" className="font-ui text-sm text-graphite">
          {WORD_SEPARATOR}
        </span>
        <input
          aria-label={copy.packs.editor.wordBLabel}
          value={wordB}
          maxLength={WORD_MAX_LENGTH + 10}
          onChange={(event) => setWordB(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border-3 border-ink bg-paper-2 px-3 py-2 font-ui font-medium text-ink"
        />
        <IconTrash
          role="button"
          tabIndex={0}
          aria-label={copy.glossary.delete}
          onClick={() => {
            void handleDelete();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              void handleDelete();
            }
          }}
          className="h-5 w-5 shrink-0 cursor-pointer text-graphite hover:text-undercover"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {ALL_DIFFICULTIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={difficulty === value}
              onClick={() => setDifficulty(value)}
              className={
                difficulty === value
                  ? 'rounded-lg border-3 border-ink bg-highlight px-2 py-1 font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-ink'
                  : 'rounded-lg border-3 border-ink bg-paper-2 px-2 py-1 font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-graphite'
              }
            >
              {copy.pnp.difficulty[value]}
            </button>
          ))}
        </div>
        {dirty ? (
          <PopButton
            type="button"
            variant="secondary"
            disabled={isSaving || tooLong}
            onClick={() => {
              void handleSave();
            }}
          >
            {copy.glossary.save}
          </PopButton>
        ) : null}
      </div>
      {tooLong ? (
        <p role="alert" className="font-ui text-xs font-medium text-undercover">
          {copy.packs.editor.validation.tooLong}
        </p>
      ) : warning ? (
        <p className="font-ui text-xs font-medium text-undercover">{warning}</p>
      ) : null}
    </div>
  );
}
