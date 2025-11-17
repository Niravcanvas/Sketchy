import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';

/**
 * The pair editor's "good pair" helper card: quotes the design
 * principle from research/02-WORD-PAIRS.md ("same category, one meaningful difference")
 * with the difficulty-ladder examples that doc collects, so a first-time pack author has a
 * concrete target rather than a blank spreadsheet.
 */
export function GoodPairCard() {
  return (
    <PopCard className="flex flex-col gap-2" data-testid="good-pair-card">
      <h3 className="font-display text-lg uppercase tracking-wide text-ink">
        {copy.packs.editor.goodPairCard.headline}
      </h3>
      <p className="font-ui text-sm text-graphite">{copy.packs.editor.goodPairCard.body}</p>
      <p className="font-ui text-sm font-medium text-ink">
        {copy.packs.editor.goodPairCard.examples}
      </p>
    </PopCard>
  );
}
