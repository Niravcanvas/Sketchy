'use client';

import { useState } from 'react';
import type { Pack } from '@sketchy/shared/contract/packs';
import { ApiError } from '@sketchy/shared/client';
import { IconCheck } from '@/components/icons/icon-check';
import { IconCopy } from '@/components/icons/icon-copy';
import { IconLink } from '@/components/icons/icon-link';
import { PopButton } from '@/components/pop/pop-button';
import { PopDialog } from '@/components/pop/pop-dialog';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';

const COPIED_RESET_MS = 2000;

export interface SharePackPanelProps {
  pack: Pack;
  /** Called with the freshly-patched pack once sharing succeeds. */
  onShared: (pack: Pack) => void;
}

function shareErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

/**
 * Owner-only sharing panel on the pack detail screen. Two independent ways to open a pack
 * up: `Share this pack` flips `visibility:'unlisted'` and mints a `shareCode` for link-only
 * sharing (an already-shared pack shows the code with a `Copy code` action, reusing the
 * room-code copy pattern, copy.md §14); `Make public` flips `visibility:'public'`, which is
 * self-service and takes effect immediately — the pack joins the public catalog for anyone
 * to find and use. A pack that's already public just confirms that live state.
 */
export function SharePackPanel({ pack, onShared }: SharePackPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publicConfirmOpen, setPublicConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function patchVisibility(
    visibility: 'unlisted' | 'public',
    closeDialog: () => void,
  ): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    try {
      const { pack: updated } = await apiClient.patchPack(pack.id, { visibility });
      onShared(updated);
      closeDialog();
    } catch (caught) {
      setError(shareErrorCopy(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy(): Promise<void> {
    if (!pack.shareCode) return;
    try {
      await navigator.clipboard.writeText(pack.shareCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard permission denied — no confirmation, no crash (mirrors room-code-hero.tsx).
    }
  }

  // Already public: self-service + immediate, so there's nothing left to confirm — just
  // state that the pack is live in the public catalog.
  if (pack.visibility === 'public') {
    return null;
  }

  const makePublicDialog = (
    <PopDialog
      open={publicConfirmOpen}
      onOpenChange={setPublicConfirmOpen}
      title={copy.packs.sharing.makePublicConfirm.title}
      description={copy.packs.sharing.makePublicConfirm.description}
      closeLabel={copy.packs.sharing.makePublicConfirm.cancel}
      trigger={
        <PopButton type="button" variant="secondary">
          {copy.packs.sharing.makePublicButton}
        </PopButton>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <PopButton type="button" variant="secondary" onClick={() => setPublicConfirmOpen(false)}>
            {copy.packs.sharing.makePublicConfirm.cancel}
          </PopButton>
          <PopButton
            type="button"
            variant="primary"
            disabled={isSubmitting}
            onClick={() => {
              void patchVisibility('public', () => setPublicConfirmOpen(false));
            }}
          >
            {copy.packs.sharing.makePublicConfirm.confirm}
          </PopButton>
        </div>
      </div>
    </PopDialog>
  );

  if (pack.visibility === 'unlisted' && pack.shareCode) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
          {copy.packs.sharing.shareCodeLabel}
        </span>
        <span className="font-display text-2xl tracking-[0.12em] text-ink">{pack.shareCode}</span>
        <PopButton
          type="button"
          variant="secondary"
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? <IconCheck className="h-4 w-4 text-success" aria-hidden="true" /> : <IconCopy className="h-4 w-4" />}
          {copy.rooms.actions.copyCode}
        </PopButton>
        {makePublicDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <PopDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={copy.packs.sharing.shareConfirm.title}
        description={copy.packs.sharing.shareConfirm.description}
        closeLabel={copy.packs.sharing.shareConfirm.cancel}
        trigger={
          <PopButton type="button" variant="secondary">
            <IconLink className="h-4 w-4" />
            {copy.packs.sharing.shareButton}
          </PopButton>
        }
      >
        <div className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="font-ui text-sm text-undercover">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <PopButton type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {copy.packs.sharing.shareConfirm.cancel}
            </PopButton>
            <PopButton
              type="button"
              variant="primary"
              disabled={isSubmitting}
              onClick={() => {
                void patchVisibility('unlisted', () => setConfirmOpen(false));
              }}
            >
              {copy.packs.sharing.shareConfirm.confirm}
            </PopButton>
          </div>
        </div>
      </PopDialog>
      {makePublicDialog}
    </div>
  );
}
