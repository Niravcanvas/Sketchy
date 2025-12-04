'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError } from '@sketchy/shared/client';
import { PopButton } from '@/components/pop/pop-button';
import { PopInput } from '@/components/pop/pop-input';
import { PopDialog } from '@/components/pop/pop-dialog';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { GoogleSignInButton } from './google-signin-button';

function linkErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

export interface LinkEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `'upsell'` (profile "claim your scrapbook") vs `'gate'` (a guest tapped a
   * public-matchmaking action). Only the heading/body copy differs. */
  variant?: 'upsell' | 'gate';
}

/**
 * The account magic-link dialog (copy.md §17.1). Requests a link to
 * the player's email — enumeration-safe, so the confirmation is identical
 * whether or not the email was free. Clicking the emailed link lands on
 * `/link`, which verifies + adopts the upgraded session.
 */
export function LinkEmailDialog({ open, onOpenChange, variant = 'upsell' }: LinkEmailDialogProps) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heading = variant === 'gate' ? copy.matchmaking.account.gateHeading : copy.matchmaking.account.upsellHeading;
  const body = variant === 'gate' ? copy.matchmaking.account.gateBody : copy.matchmaking.account.upsellBody;

  function reset(): void {
    setEmail('');
    setSending(false);
    setSent(false);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sending || email.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      await apiClient.requestEmailLink({ email: email.trim() });
      setSent(true);
    } catch (caught) {
      setError(linkErrorCopy(caught));
    } finally {
      setSending(false);
    }
  }

  return (
    <PopDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={heading}
      description={body}
      closeLabel={copy.matchmaking.account.gateKeepPrivate}
    >
      {sent ? (
        <p role="status" data-testid="link-sent" className="font-ui text-sm text-ink">
          {copy.matchmaking.account.sentConfirmation}
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <PopInput
            type="email"
            label={copy.matchmaking.account.emailLabel}
            placeholder={copy.matchmaking.account.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="link-email-input"
            required
          />
          {error ? (
            <p role="alert" className="font-ui text-sm text-undercover">
              {error}
            </p>
          ) : null}
          <PopButton type="submit" variant="primary" disabled={sending} data-testid="link-email-send">
            {copy.matchmaking.account.sendButton}
          </PopButton>
          {/* Optional Google link method — self-hides (renders null) unless a
              Google client ID is configured, so with the feature off the form is
              exactly the email-only flow it was before. */}
          <GoogleSignInButton />
          {/* 13+ requirement at the point of account creation — applies to both the
              email link and the Google button above it. Privacy/terms state it too. */}
          <p className="font-ui text-xs text-graphite">
            {copy.matchmaking.account.ageDisclosure}
          </p>
          {variant === 'gate' ? (
            <Link href="/community" className="font-ui text-sm font-bold text-graphite underline">
              {copy.matchmaking.community.footerLink}
            </Link>
          ) : null}
        </form>
      )}
    </PopDialog>
  );
}
