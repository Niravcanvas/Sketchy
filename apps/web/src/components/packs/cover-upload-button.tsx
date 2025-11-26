'use client';

import { useRef, useState } from 'react';
import { ApiError } from '@sketchy/shared/client';
import { UPLOAD_MAX_BYTES } from '@sketchy/shared/contract/uploads';
import { IconPencil } from '@/components/icons/icon-pencil';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';

function uploadErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

export interface CoverUploadButtonProps {
  packId: string;
  hasCover: boolean;
  onUploaded: (coverUrl: string) => void;
}

/**
 * Pack cover upload: presign → PUT the file straight to R2 →
 * `PATCH /packs/:id` with the resulting `publicUrl`. In THIS dev environment R2 credentials
 * are placeholders (`.env.example` "changeme" — see `apps/api/src/uploads/r2-client.ts`), so
 * the presign step still succeeds (pure local crypto) but the actual `PUT` to R2 will fail
 * (no such account exists) — that failure surfaces as the generic network-ish error below,
 * a documented, accepted dev-environment limitation, not a bug in this component.
 */
export function CoverUploadButton({ packId, hasCover, onUploaded }: CoverUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    if (file.size > UPLOAD_MAX_BYTES || !file.type.startsWith('image/')) {
      setError(copy.errors.validation);
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      const { uploadUrl, publicUrl } = await apiClient.presignUpload({
        kind: 'packCover',
        contentType: file.type,
        sizeBytes: file.size,
      });
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`upload PUT failed: ${putRes.status}`);
      }
      const { pack } = await apiClient.patchPack(packId, { coverUrl: publicUrl });
      onUploaded(pack.coverUrl ?? publicUrl);
    } catch (caught) {
      setError(uploadErrorCopy(caught));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />
      <PopButton
        type="button"
        variant="secondary"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
      >
        <IconPencil className="h-4 w-4" />
        {hasCover ? copy.packs.manager.changeCoverButton : copy.packs.manager.addCoverButton}
      </PopButton>
      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
    </div>
  );
}
