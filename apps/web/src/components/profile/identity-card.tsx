'use client';

import { useState } from 'react';
import type { AvatarConfig } from '@sketchy/engine/types';
import { ApiError } from '@sketchy/shared/client';
import { AvatarDoodle } from '@/components/avatar/avatar-doodle';
import { AvatarPicker } from '@/components/avatar/avatar-picker';
import { IconPencil } from '@/components/icons/icon-pencil';
import { IconChip } from '@/components/pop/icon-chip';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { useSessionStore } from '@/stores/session-store';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;

/** Maps a failed `PATCH /players/me` to one §9 error line — same mapping shape as
 * `name-prompt-card.tsx`'s `copyForSignInError`, just for the patch endpoint's error set. */
function copyForPatchError(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

/**
 * Profile identity card: the screen's one headline moment
 * (`PopCard tone="hero"`, design-party-pop.md §5.2) — doodle avatar + name, editable inline
 * via the existing `PATCH /players/me` (players.ts already implements it; this is the first
 * UI to call it for anything other than the room-join avatar picker). Read-only until the
 * pencil chip is tapped; Save/Cancel own their own local draft state so a cancelled edit
 * never touches `session-store` (and therefore never re-renders anything else on the page).
 */
export function IdentityCard() {
  const player = useSessionStore((state) => state.player);
  const updatePlayer = useSessionStore((state) => state.updatePlayer);

  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftAvatar, setDraftAvatar] = useState<AvatarConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!player) {
    return null;
  }

  // `player` is narrowed non-null above, but TS doesn't carry that through a nested function
  // declaration's closure — hence the `!`s below (this function is only ever called from the
  // read-only render branch further down, which only exists once `player` is non-null).
  function startEditing(): void {
    setDraftName(player!.displayName);
    setDraftAvatar(player!.avatar);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing(): void {
    setIsEditing(false);
    setError(null);
  }

  const trimmedName = draftName.trim();
  const isValidLength =
    trimmedName.length >= MIN_NAME_LENGTH && trimmedName.length <= MAX_NAME_LENGTH;

  async function handleSave(): Promise<void> {
    if (!isValidLength || !draftAvatar || isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const { player: updated } = await apiClient.patchMe({
        displayName: trimmedName,
        avatar: draftAvatar,
      });
      updatePlayer(updated);
      setIsEditing(false);
    } catch (caught) {
      setError(copyForPatchError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing && draftAvatar) {
    return (
      <PopCard tone="hero" className="flex w-full flex-col items-center gap-5 text-center">
        <PopInput
          label={copy.home.namePrompt.question}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          minLength={MIN_NAME_LENGTH}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
        />
        <AvatarPicker value={draftAvatar} onChange={setDraftAvatar} />
        {error ? (
          <p role="alert" className="font-ui text-sm text-ink">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <PopButton
            variant="primary"
            disabled={!isValidLength || isSaving}
            onClick={() => {
              void handleSave();
            }}
          >
            {copy.profile.identity.save}
          </PopButton>
          <PopButton variant="secondary" disabled={isSaving} onClick={cancelEditing}>
            {copy.profile.identity.cancel}
          </PopButton>
        </div>
      </PopCard>
    );
  }

  return (
    <PopCard
      tone="hero"
      className="relative flex w-full flex-col items-center gap-3 py-8 text-center"
    >
      <span className="inline-flex h-24 w-24 items-center justify-center rounded-full border-3 border-ink bg-paper-2 shadow-hard-sm">
        <AvatarDoodle config={player.avatar} size={88} title={player.displayName} />
      </span>
      <p className="font-display text-2xl uppercase tracking-wide text-ink">{player.displayName}</p>
      <button
        type="button"
        aria-label={copy.profile.identity.editAria}
        data-testid="profile-edit-identity"
        onClick={startEditing}
        className="absolute right-4 top-4"
      >
        <IconChip tone="plain">
          <IconPencil className="h-5 w-5" />
        </IconChip>
      </button>
    </PopCard>
  );
}
