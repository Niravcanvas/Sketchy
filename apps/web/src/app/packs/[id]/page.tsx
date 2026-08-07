'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@sketchy/shared/client';
import type { Pack } from '@sketchy/shared/contract/packs';
import { CoverUploadButton } from '@/components/packs/cover-upload-button';
import { PackCover } from '@/components/packs/pack-cover';
import { PairEditor } from '@/components/packs/pair-editor';
import { SharePackPanel } from '@/components/packs/share-pack-panel';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopDialog } from '@/components/pop/pop-dialog';
import { PopInput } from '@/components/pop/pop-input';
import { NavBackButton } from '@/components/nav-back-button';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { useSessionStore } from '@/stores/session-store';

function patchErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

interface PackDetailsFormProps {
  pack: Pack;
  onSaved: (pack: Pack) => void;
}

/**
 * Owner-editable name/description, split into its own component so `useState(pack.name)`
 * seeds ONCE from the initializer rather than needing an effect to sync local state from a
 * prop (React's own recommended shape for "adjust state when a prop changes" —
 * https://react.dev/learn/you-might-not-need-an-effect — and the one that satisfies
 * `react-hooks/set-state-in-effect`, which flags a synchronous `setState` inside an effect
 * body). This mounts once `pack` is known and stays mounted as `pack` is later replaced by
 * `onSaved`'s cache write, so an in-flight unsaved edit is never clobbered by a refetch.
 */
function PackDetailsForm({ pack, onSaved }: PackDetailsFormProps) {
  const [name, setName] = useState(pack.name);
  const [description, setDescription] = useState(pack.description);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== pack.name || description !== pack.description;

  async function handleSave(): Promise<void> {
    if (!dirty) return;
    setError(null);
    try {
      const { pack: updated } = await apiClient.patchPack(pack.id, {
        name: name.trim(),
        description: description.trim(),
      });
      onSaved(updated);
    } catch (caught) {
      setError(patchErrorCopy(caught));
    }
  }

  return (
    <>
      <PopInput
        label={copy.packs.manager.createForm.nameLabel}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
      />
      <PopInput
        label={copy.packs.manager.createForm.descriptionLabel}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={200}
      />
      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
      {dirty ? (
        <PopButton
          type="button"
          variant="primary"
          onClick={() => {
            void handleSave();
          }}
        >
          {copy.glossary.save}
        </PopButton>
      ) : null}
    </>
  );
}

function PackDetail({ id }: { id: string }) {
  const router = useRouter();
  const player = useSessionStore((state) => state.player);
  const queryClient = useQueryClient();
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const packQuery = useQuery({
    queryKey: ['packs', id],
    queryFn: () => apiClient.getPack(id),
  });

  const pack = packQuery.data?.pack;

  if (packQuery.isLoading) {
    return null;
  }
  if (!pack) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <NavBackButton href="/packs" />
        <PopCard>
          <p role="alert" className="font-ui text-base text-ink">
            {copy.errors.notFound}
          </p>
        </PopCard>
      </main>
    );
  }

  const isOwner = pack.ownerId !== null && pack.ownerId === player?.id;

  function applyUpdatedPack(updated: Pack): void {
    queryClient.setQueryData(['packs', id], { pack: updated });
  }

  async function handleDelete(): Promise<void> {
    setIsDeleting(true);
    try {
      await apiClient.deletePack(id);
      router.push('/packs');
    } catch {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 bg-paper px-6 py-12">
      <NavBackButton href="/packs" />
      <div className="h-48 w-full overflow-hidden rounded-2xl">
        <PackCover coverUrl={pack.coverUrl} seed={pack.id} />
      </div>

      {isOwner ? (
        <div className="flex flex-col gap-4">
          {pack.visibility === 'public' ? (
            <div className="flex flex-col gap-1 rounded-xl border-3 border-ink bg-highlight px-4 py-3 shadow-hard-sm">
              <span className="font-ui text-xs font-bold uppercase tracking-wide text-ink">
                {copy.packs.review.publicBadge}
              </span>
              <span className="font-ui text-sm text-ink">{copy.packs.review.publicHelper}</span>
            </div>
          ) : null}
          <PackDetailsForm pack={pack} onSaved={applyUpdatedPack} />
          <div className="flex flex-wrap items-center gap-3">
            <CoverUploadButton
              packId={id}
              hasCover={Boolean(pack.coverUrl)}
              onUploaded={(coverUrl) => applyUpdatedPack({ ...pack, coverUrl })}
            />
            <SharePackPanel pack={pack} onShared={applyUpdatedPack} />
            <PopDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={copy.packs.deleteConfirm.title}
              description={copy.packs.deleteConfirm.description(pack.name)}
              closeLabel={copy.packs.deleteConfirm.cancel}
              trigger={
                <PopButton type="button" variant="danger">
                  {copy.glossary.delete}
                </PopButton>
              }
            >
              <div className="flex justify-end gap-3">
                <PopButton type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
                  {copy.packs.deleteConfirm.cancel}
                </PopButton>
                <PopButton
                  type="button"
                  variant="danger"
                  disabled={isDeleting}
                  onClick={() => {
                    void handleDelete();
                  }}
                >
                  {copy.packs.deleteConfirm.confirm}
                </PopButton>
              </div>
            </PopDialog>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl uppercase tracking-wide text-ink">{pack.name}</h1>
          {pack.description ? (
            <p className="font-ui text-sm text-graphite">{pack.description}</p>
          ) : null}
        </div>
      )}

      {isOwner ? (
        <PairEditor
          packId={id}
          refreshKey={refreshKey}
          onPairsChanged={() => {
            setRefreshKey((k) => k + 1);
            void queryClient.invalidateQueries({ queryKey: ['packs', id] });
          }}
        />
      ) : (
        <p className="font-ui text-sm text-graphite">{copy.packs.manager.cardMeta(pack.pairCount)}</p>
      )}
    </main>
  );
}

/**
 * `/packs/:id` — pack detail (owner: full editor; anyone with read access: a light summary).
 * A dynamic route needs its own `QueryClientProvider` instance, same pattern as `/play` and
 * `/r/[code]` (both "scoped here rather than the root layout" per their own doc comments).
 */
export default function PackDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const status = useSessionStore((state) => state.status);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );

  if (status === 'loading' || !id) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PackDetail id={id} />
    </QueryClientProvider>
  );
}
