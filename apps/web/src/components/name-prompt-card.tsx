'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError } from '@sketchy/shared/client';
import { IconArrowRight } from '@/components/icons/icon-arrow-right';
import { IconCheck } from '@/components/icons/icon-check';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { useSessionStore } from '@/stores/session-store';

/** Matches `guestAuthRequestSchema` (`@sketchy/shared/contract/players`) so a
 * submit that passes this client-side check never fails server zod parsing. */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;

/**
 * Maps a failed `signIn` to one §9 error line. `ApiError` (api-contract.md
 * §0 envelope) has an `ErrorCode` the shared `copyForError` table maps
 * exhaustively; anything else is a raw `fetch` throw — the shared client only
 * ever wraps non-2xx *responses* into `ApiError`, so a network-level failure
 * (offline, DNS, CORS) surfaces as-is here, covered by the "network offline"
 * line.
 */
function copyForSignInError(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

/**
 * Home-screen name prompt (copy.md §2) — the guest-first identity bootstrap.
 * Three states driven by `session-store`:
 *
 * - `loading`: session not hydrated yet (see `session-boot.tsx`) — render
 *   nothing rather than flash the wrong prompt.
 * - `anonymous`: the real name form — submit calls `signIn`, which POSTs
 *   guest auth and persists the token.
 * - `authed`: no need to ask twice — a small "signed" state showing the
 *   player's name like a signature.
 */
export function NamePromptCard() {
  const status = useSessionStore((state) => state.status);
  const player = useSessionStore((state) => state.player);
  const signIn = useSessionStore((state) => state.signIn);

  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') {
    return null;
  }

  if (status === 'authed' && player) {
    return (
      <PopCard
        className="flex w-full max-w-sm flex-col items-center gap-2 py-8 text-center"
      >
        <IconCheck className="h-5 w-5 text-success" />
        <p className="font-display text-2xl uppercase tracking-wide text-ink">
          {player.displayName}
        </p>
      </PopCard>
    );
  }

  const trimmedName = name.trim();
  const isValidLength =
    trimmedName.length >= MIN_NAME_LENGTH && trimmedName.length <= MAX_NAME_LENGTH;

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!isValidLength || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await signIn(trimmedName);
    } catch (caught) {
      setError(copyForSignInError(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PopCard className="flex w-full max-w-sm flex-col gap-4 text-left">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
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
        {error ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {error}
          </p>
        ) : null}
        <PopButton
          type="submit"
          variant="primary"
          size="md"
          className="self-start"
          disabled={!isValidLength || isSubmitting}
        >
          {copy.home.namePrompt.submit}
          <IconArrowRight className="h-4 w-4" />
        </PopButton>
      </form>
    </PopCard>
  );
}
