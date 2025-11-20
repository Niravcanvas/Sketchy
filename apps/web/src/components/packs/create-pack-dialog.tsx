'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@sketchy/shared/client';
import { IconPencil } from '@/components/icons/icon-pencil';
import { PopButton } from '@/components/pop/pop-button';
import { PopDialog } from '@/components/pop/pop-dialog';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';

function createPackErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    // `pair_limit` is the packs-per-account cap here (not the per-pack pairs cap); the shared
    // baseline can't tell which, so this surface keeps its own `packLimit` line. Everything
    // else reads from the shared table.
    if (error.code === 'pair_limit') {
      return copy.errors.packLimit(20);
    }
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

/**
 * `Create a pack` flow: a small dialog collecting name +
 * description, then `POST /packs` and navigate straight to the new pack's editor —
 * the natural next step is adding pairs, not admiring an empty card.
 */
export function CreatePackDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setName('');
    setDescription('');
    setError(null);
    setIsSubmitting(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const { pack } = await apiClient.createPack({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setOpen(false);
      reset();
      router.push(`/packs/${pack.id}`);
    } catch (caught) {
      setError(createPackErrorCopy(caught));
      setIsSubmitting(false);
    }
  }

  return (
    <PopDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      title={copy.packs.manager.title}
      closeLabel={copy.glossary.cancel}
      trigger={
        <PopButton type="button" variant="primary">
          <IconPencil className="h-4 w-4" />
          {copy.packs.manager.createButton}
        </PopButton>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <PopInput
          label={copy.packs.manager.createForm.nameLabel}
          placeholder={copy.packs.manager.createForm.namePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          autoFocus
        />
        <PopInput
          label={copy.packs.manager.createForm.descriptionLabel}
          placeholder={copy.packs.manager.createForm.descriptionPlaceholder}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={200}
        />
        {error ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {error}
          </p>
        ) : null}
        <PopButton type="submit" variant="primary" disabled={!name.trim() || isSubmitting}>
          {copy.packs.manager.createButton}
        </PopButton>
      </form>
    </PopDialog>
  );
}
