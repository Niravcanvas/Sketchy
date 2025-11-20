'use client';

import { useEffect, useState } from 'react';
import type { Pair } from '@sketchy/shared/contract/packs';
import { BulkPasteDialog } from '@/components/packs/bulk-paste-dialog';
import { GoodPairCard } from '@/components/packs/good-pair-card';
import { PairRow } from '@/components/packs/pair-row';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';

const PAGE_LIMIT = 50;

export interface PairEditorProps {
  packId: string;
  /** Bumped by the parent whenever `pairCount` changes elsewhere, to force a refetch. */
  refreshKey: number;
  onPairsChanged: () => void;
}

/** Case-sensitive exact match, mirroring the DB's `(pack_id, word_a, word_b)` unique
 * constraint (data-model.md §1) — the inline duplicate hint some pairs get. */
function duplicateWarning(pair: Pair, all: Pair[]): string | null {
  const dupe = all.some(
    (other) => other.id !== pair.id && other.wordA === pair.wordA && other.wordB === pair.wordB,
  );
  return dupe ? copy.packs.editor.validation.duplicate : null;
}

/**
 * The pair editor: fetches every active pair for the pack (paged,
 * "load more" rather than infinite scroll — pack sizes top out at 500), renders one
 * `PairRow` each, and hosts the bulk-paste entry point + the "good pair" helper card.
 */
export function PairEditor({ packId, refreshKey, onPairsChanged }: PairEditorProps) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // `.then()`-chained (not an awaited helper) so every setState lives inside a genuinely
  // async callback, not the effect's own synchronous call stack — the shape
  // `react-hooks/set-state-in-effect` wants (see `app/r/[code]/page.tsx`'s pre-join effect
  // for the same pattern; an `async` helper function invoked via `void fn()` gets flagged
  // even when its setState calls come after an `await`, because the rule's static analysis
  // doesn't model await boundaries — only real function/closure boundaries).
  useEffect(() => {
    let cancelled = false;
    apiClient.listPackPairs(packId, { limit: PAGE_LIMIT }).then((page) => {
      if (cancelled) return;
      setPairs(page.items);
      setNextCursor(page.nextCursor);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [packId, refreshKey]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await apiClient.listPackPairs(packId, { cursor: nextCursor, limit: PAGE_LIMIT });
      setPairs((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleSaveRow(
    pairId: string,
    patch: { wordA: string; wordB: string; difficulty: Pair['difficulty'] },
  ): Promise<void> {
    const { pair } = await apiClient.patchPair(packId, pairId, patch);
    setPairs((prev) => prev.map((p) => (p.id === pairId ? pair : p)));
  }

  async function handleDeleteRow(pairId: string): Promise<void> {
    await apiClient.deletePair(packId, pairId);
    setPairs((prev) => prev.filter((p) => p.id !== pairId));
    onPairsChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
            {copy.packs.editor.sectionLabel}
          </h2>
          <p className="font-ui text-sm text-graphite">{copy.packs.editor.helper}</p>
        </div>
        <BulkPasteDialog
          packId={packId}
          existingPairs={pairs}
          onCreated={onPairsChanged}
        />
      </div>

      <GoodPairCard />

      {isLoading ? null : pairs.length === 0 ? (
        <p className="font-ui text-sm text-graphite">{copy.packs.editor.emptyPairs}</p>
      ) : (
        <div className="flex flex-col gap-2" data-testid="pair-editor-rows">
          {pairs.map((pair) => (
            <PairRow
              key={pair.id}
              pair={pair}
              warning={duplicateWarning(pair, pairs)}
              onSave={(patch) => handleSaveRow(pair.id, patch)}
              onDelete={() => handleDeleteRow(pair.id)}
            />
          ))}
        </div>
      )}

      {nextCursor ? (
        <PopButton
          type="button"
          variant="secondary"
          disabled={isLoadingMore}
          onClick={() => {
            void loadMore();
          }}
        >
          {copy.packs.editor.loadMore}
        </PopButton>
      ) : null}
    </div>
  );
}
