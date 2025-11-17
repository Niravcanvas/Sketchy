import Link from 'next/link';
import type { Pack } from '@sketchy/shared/contract/packs';
import { PackCover } from '@/components/packs/pack-cover';
import { copy } from '@/copy';

export interface PackCardProps {
  pack: Pack;
  /** True for packs the caller imported (owned by someone else) — shows "Imported from
   * {ownerName}" instead of leaving that space blank. The card can't derive this itself (it
   * doesn't know the caller's own id), so the `/packs` page computes it per pack. */
  showOwnerAttribution?: boolean;
}

/**
 * One pack tile in the `/packs` manager grid. Links to the pack
 * detail/editor route.
 */
export function PackCard({ pack, showOwnerAttribution = false }: PackCardProps) {
  const attribution = showOwnerAttribution
    ? copy.packs.manager.importedFrom(pack.ownerName ?? copy.packs.manager.importedFromFallback)
    : null;
  // Public packs are self-service and live immediately; flag the state on the owner's own
  // card so they can see at a glance which of their packs are in the public catalog.
  const isPublic = pack.visibility === 'public';

  return (
    <Link
      href={`/packs/${pack.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border-3 border-ink bg-paper-2 shadow-hard-sm transition-transform duration-150 hover:-translate-y-0.5"
      data-testid="pack-card"
    >
      <div className="h-28 w-full">
        <PackCover coverUrl={pack.coverUrl} seed={pack.id} />
      </div>
      <div className="flex flex-col gap-1 p-4">
        <span className="font-ui text-[15px] font-bold text-ink">{pack.name}</span>
        <span className="font-ui text-sm font-medium text-graphite">
          {copy.packs.manager.cardMeta(pack.pairCount)}
        </span>
        {attribution ? (
          <span className="font-ui text-xs font-medium text-graphite">{attribution}</span>
        ) : null}
        {isPublic ? (
          <span className="mt-1 inline-flex w-fit rounded-full border-2 border-ink bg-highlight px-2 py-0.5 font-ui text-xs font-bold uppercase tracking-wide text-ink">
            {copy.packs.review.publicBadge}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
