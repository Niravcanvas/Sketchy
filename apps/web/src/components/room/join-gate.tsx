'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { AvatarConfig } from '@sketchy/engine/types';
import { ApiError } from '@sketchy/shared/client';
import { AvatarPicker } from '@/components/avatar/avatar-picker';
import { HowToPlayButton } from '@/components/how-to-play-button';
import { IconArrowRight } from '@/components/icons/icon-arrow-right';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { defaultAvatar } from '@/lib/default-avatar';
import { useSessionStore } from '@/stores/session-store';

/** Matches `guestAuthRequestSchema` (`@sketchy/shared/contract/players`) — mirrors
 * `name-prompt-card.tsx`'s constants so a submit that passes this check never fails the
 * server's zod parsing. */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;

function copyForJoinGateError(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

export interface JoinGateProps {
  /** Called once identity (guest sign-in, if needed) and the chosen avatar are both
   * persisted server-side — the room route then proceeds to the REST pre-join check
   * (api-contract.md §1) and, from there, the socket connect. */
  onReady: () => void;
  /** The room code this gate is standing in front of — passed through to `/how-to-play`'s
   * `from` so Skip/finish returns to THIS room. */
  code: string;
}

/**
 * The pre-join gate (game-design.md §5, this phase's pinned design — see arch/copy.md §4's
 * avatar-picker note): the ONLY moment a player can set their doodle before playing, since
 * the frozen engine has no in-lobby avatar-update action. Two flows share this one
 * component: an anonymous visitor also gets the guest sign-in name prompt (the SIGN-IN
 * PATTERN mirrors `name-prompt-card.tsx`, deliberately not reusing that component itself —
 * it's home-screen-specific and doesn't carry an avatar picker); an already-authed player
 * joining a (possibly new) room just confirms their doodle before knocking.
 */
export function JoinGate({ onReady, code }: JoinGateProps) {
  const status = useSessionStore((state) => state.status);
  const player = useSessionStore((state) => state.player);
  const signIn = useSessionStore((state) => state.signIn);
  const updatePlayer = useSessionStore((state) => state.updatePlayer);

  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarConfig>(() => player?.avatar ?? defaultAvatar(0));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') {
    return null;
  }

  const isAnonymous = status === 'anonymous';
  const trimmedName = name.trim();
  const nameValid =
    !isAnonymous ||
    (trimmedName.length >= MIN_NAME_LENGTH && trimmedName.length <= MAX_NAME_LENGTH);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (!nameValid) {
      setError(copy.home.namePrompt.validation);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (isAnonymous) {
        await signIn(trimmedName);
      }
      const response = await apiClient.patchMe({ avatar });
      updatePlayer(response.player);
      onReady();
    } catch (caught) {
      setError(copyForJoinGateError(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 bg-paper px-6 py-16">
      <PopCard data-testid="room-join-gate" className="flex w-full flex-col gap-5 text-left">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          {isAnonymous ? (
            <div className="flex flex-col gap-2">
              <p className="font-display text-2xl uppercase tracking-wide text-ink">
                {copy.home.namePrompt.question}
              </p>
              <PopInput
                label={copy.home.namePrompt.question}
                placeholder={copy.home.namePrompt.placeholder}
                value={name}
                onChange={handleNameChange}
                minLength={MIN_NAME_LENGTH}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="off"
                required
              />
              <p className="font-ui text-sm text-graphite">{copy.home.namePrompt.helper}</p>
            </div>
          ) : null}

          <AvatarPicker value={avatar} onChange={setAvatar} />

          {error ? (
            <p role="alert" className="font-ui text-sm text-undercover">
              {error}
            </p>
          ) : null}

          <PopButton
            type="submit"
            variant="primary"
            size="lg"
            className="self-center"
            disabled={isSubmitting}
          >
            {copy.rooms.join.submit}
            <IconArrowRight className="h-4 w-4" />
          </PopButton>
        </form>
      </PopCard>
      <HowToPlayButton from={`/r/${code}`} />
    </main>
  );
}
