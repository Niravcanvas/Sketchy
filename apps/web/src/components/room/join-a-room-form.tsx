'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { normalizeRoomCode } from '@sketchy/shared/room-code';
import { PopButton } from '@/components/pop/pop-button';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';

/**
 * Home screen's "Join a room" CTA (copy.md §4 "Join screen"): expands into a code-entry
 * field (auto-uppercased via `normalizeRoomCode` as the player types) and navigates to
 * `/r/CODE` on submit. Resolution errors (not found / full / in progress) are deliberately
 * NOT handled here — the room route itself runs the REST pre-join check (api-contract.md
 * §1) and renders the friendly error cards; this form's only job is getting the normalized
 * code into the URL.
 */
export function JoinARoomForm() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState('');

  function handleCodeChange(event: ChangeEvent<HTMLInputElement>): void {
    setCode(normalizeRoomCode(event.target.value));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!code) {
      return;
    }
    router.push(`/r/${code}`);
  }

  if (!expanded) {
    return (
      <PopButton
        type="button"
        variant="primary"
        size="lg"
        className="w-full"
        onClick={() => setExpanded(true)}
      >
        {copy.home.primaryActions.joinARoom}
      </PopButton>
    );
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <PopInput
        label={copy.rooms.join.title}
        placeholder={copy.rooms.join.placeholder}
        value={code}
        onChange={handleCodeChange}
        maxLength={5}
        autoComplete="off"
        autoFocus
      />
      <PopButton
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={code.length === 0}
      >
        {copy.rooms.join.submit}
      </PopButton>
    </form>
  );
}
