'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AvatarDoodle } from '@/components/avatar/avatar-doodle';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { defaultAvatar } from '@/lib/default-avatar';
import { useBlocksStore } from '@/stores/blocks-store';

/** Cache key for `GET /blocks` — its own entry so an unblock can invalidate just this
 * list without disturbing the profile's stats/history queries. */
const BLOCKS_QUERY_KEY = ['blocks'] as const;

/** `GET /blocks` returns only opaque player ids (no display name or stored avatar — see
 * contract/blocks.ts `blockItemSchema`). Fold an id into a small non-negative integer so
 * `defaultAvatar` (a seat→look helper) yields a STABLE doodle per blocked player: the same
 * id always draws the same face, giving each row a recognizable identity without inventing
 * a fake name. Not security-sensitive — any deterministic spread over the curated sets is fine. */
function avatarSeedFromId(id: string): number {
  let acc = 0;
  for (let i = 0; i < id.length; i += 1) {
    acc = (acc + id.charCodeAt(i)) % 4096;
  }
  return acc;
}

/** First UUID segment — a short, stable handle to show (and read out) in place of a name we
 * don't have. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

function LoadingSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-20 w-full animate-pulse rounded-xl border-3 border-ink bg-paper-2"
    />
  );
}

/**
 * "Blocked players" review/unblock section of `/profile`. Reads the caller's block list via
 * `GET /blocks` (TanStack Query, same convention as the surrounding stats/history sections)
 * and lets them undo any block — the block affordance elsewhere is one-way without this.
 *
 * Unblocking goes through `blocks-store.unblock` (not a bare `apiClient` call) so the local
 * chat-hiding filter's `blockedIds` stays in sync in the same tick; the query cache is then
 * invalidated so the row disappears from this list too (mirrors the packs manager's
 * write-then-invalidate pattern).
 */
export function BlockedList() {
  const queryClient = useQueryClient();
  const unblock = useBlocksStore((state) => state.unblock);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: BLOCKS_QUERY_KEY,
    queryFn: () => apiClient.listBlocks(),
  });

  const items = query.data?.items ?? [];

  async function handleUnblock(blockedPlayerId: string): Promise<void> {
    // Guard against a double-tap kicking off a second unblock before the first settles.
    if (unblockingId) {
      return;
    }
    setUnblockingId(blockedPlayerId);
    try {
      const ok = await unblock(blockedPlayerId);
      if (ok) {
        await queryClient.invalidateQueries({ queryKey: BLOCKS_QUERY_KEY });
      }
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <section className="flex w-full flex-col gap-3">
      <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
        {copy.matchmaking.moderation.blockedListHeading}
      </h2>

      {query.isPending ? <LoadingSkeleton /> : null}

      {!query.isPending && items.length === 0 ? (
        <PopCard className="text-center">
          <p className="font-ui text-sm text-graphite">
            {copy.matchmaking.moderation.blockedListEmpty}
          </p>
        </PopCard>
      ) : null}

      {items.map((item) => {
        const label = shortId(item.blockedPlayerId);
        return (
          <PopCard
            key={item.blockedPlayerId}
            className="flex w-full items-center justify-between gap-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-3 border-ink bg-paper-2 shadow-hard-sm">
                <AvatarDoodle
                  config={defaultAvatar(avatarSeedFromId(item.blockedPlayerId))}
                  size={40}
                  title={label}
                />
              </span>
              <span className="truncate font-ui text-sm font-semibold tracking-wide text-ink">
                {label}
              </span>
            </div>
            <PopButton
              variant="secondary"
              disabled={unblockingId === item.blockedPlayerId}
              aria-label={`${copy.matchmaking.moderation.unblock} ${label}`}
              onClick={() => {
                void handleUnblock(item.blockedPlayerId);
              }}
            >
              {copy.matchmaking.moderation.unblock}
            </PopButton>
          </PopCard>
        );
      })}
    </section>
  );
}
