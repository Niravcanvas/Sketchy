'use client';

import { useState, type FormEvent } from 'react';
import { ApiError } from '@sketchy/shared/client';
import { PopButton } from '@/components/pop/pop-button';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';

function importPackErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

export interface ImportPackFormProps {
  /** Called after a successful import so the caller can refetch the "mine" list. */
  onImported: () => void;
}

/**
 * `/packs/import` entry field (copy.md §14): a share code from a
 * friend grants read-access without copying the pack — the imported pack then shows up
 * under the caller's own `Mine` tab, owner-attributed (`PackCard`).
 */
export function ImportPackForm({ onImported }: ImportPackFormProps) {
  const [shareCode, setShareCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = shareCode.trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await apiClient.importPack({ shareCode: trimmed });
      setShareCode('');
      setSuccess(true);
      onImported();
    } catch (caught) {
      setError(importPackErrorCopy(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="flex items-end gap-3"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <div className="flex-1">
        <PopInput
          label={copy.packs.sharing.importFieldLabel}
          placeholder={copy.packs.sharing.importPlaceholder}
          value={shareCode}
          onChange={(event) => {
            setShareCode(event.target.value.toUpperCase());
            setSuccess(false);
          }}
          maxLength={16}
        />
      </div>
      <PopButton type="submit" variant="secondary" disabled={!shareCode.trim() || isSubmitting}>
        {copy.packs.sharing.importSubmit}
      </PopButton>
      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="font-ui text-sm text-success">
          {copy.packs.sharing.importSuccess}
        </p>
      ) : null}
    </form>
  );
}
