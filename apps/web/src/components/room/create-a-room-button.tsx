'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@sketchy/shared/client';
import { IconUsers } from '@/components/icons/icon-users';
import { PopButton } from '@/components/pop/pop-button';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { useSessionStore } from '@/stores/session-store';

function copyForCreateRoomError(error: unknown): string {
  // `account_required` (a guest trying to host a public room) reads correctly through the
  // shared table, same as every other code, instead of needing a case here.
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

/**
 * Home screen's "Create a room" CTA (copy.md §2 → game-design.md §5 "one tap from Home →
 * `POST /rooms` → land in lobby as host"). `POST /rooms` is an authed call (api-contract.md
 * §0 — every REST call needs a bearer token except guest auth/health), so this CTA is only
 * actionable once the player has a guest identity. That identity is entered in ONE place on
 * this screen — `NamePromptCard` — so the button stays disabled until sign-in flips the
 * session to `authed`, rather than duplicating the name field here. Avatar picking is
 * deliberately NOT here either: it happens once, on the room route's own join gate, right
 * before the host ever sees the lobby (the frozen engine has no in-lobby avatar-update
 * action, so that's the only place it can live this phase).
 */
export function CreateARoomButton() {
  const router = useRouter();
  const status = useSessionStore((state) => state.status);
  const player = useSessionStore((state) => state.player);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [makePublic, setMakePublic] = useState(false);

  const canSubmit = status === 'authed' && !isSubmitting;
  // Only linked accounts may host a public room (private rooms stay
  // 100% guest-accessible). The checkbox is disabled for guests, with a helper
  // pointing at account linking.
  const canHostPublic = status === 'authed' && player !== null && !player.isGuest;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const visibility = makePublic && canHostPublic ? 'public' : 'private';
      const { code } = await apiClient.createRoom({ visibility });
      router.push(`/r/${code}`);
    } catch (caught) {
      setError(copyForCreateRoomError(caught));
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <PopButton type="submit" variant="primary" size="lg" className="w-full" disabled={!canSubmit}>
        <IconUsers className="h-5 w-5" />
        {copy.home.primaryActions.createARoom}
      </PopButton>
      <label className="flex items-start gap-2 font-ui text-sm text-ink">
        <input
          type="checkbox"
          checked={makePublic}
          disabled={!canHostPublic}
          onChange={(event) => setMakePublic(event.target.checked)}
          data-testid="make-public"
          className="mt-0.5 h-4 w-4 accent-civilian"
        />
        <span>
          {copy.matchmaking.publicRoom.visibilityLabel}
          <span className="block text-xs text-graphite">
            {canHostPublic
              ? copy.matchmaking.publicRoom.visibilityHelper
              : copy.matchmaking.publicRoom.visibilityGuestHelper}
          </span>
        </span>
      </label>
      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
    </form>
  );
}
