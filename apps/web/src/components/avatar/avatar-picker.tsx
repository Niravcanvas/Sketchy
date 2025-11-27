'use client';

import clsx from 'clsx';
import type { AvatarConfig } from '@sketchy/engine/types';
import { IconArrowRight } from '@/components/icons/icon-arrow-right';
import { IconCheck } from '@/components/icons/icon-check';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { AvatarDoodle } from './avatar-doodle';
import {
  AVATAR_ACCESSORY_IDS,
  AVATAR_FACE_IDS,
  AVATAR_HEAD_IDS,
  AVATAR_INK_COLORS,
  isKnownAvatarId,
  type AvatarInkColor,
} from './avatar-config';

/**
 * Tailwind needs each `bg-*` class name to appear verbatim somewhere in the source (its
 * scanner is textual, not runtime) — this map is what makes that true for a token picked at
 * render time, and it doubles as the single place mapping an ink token to its swatch color
 * (conventions.md §2 — no raw hex in components).
 */
const INK_SWATCH_CLASS: Record<AvatarInkColor, string> = {
  civilian: 'bg-civilian',
  undercover: 'bg-undercover',
  mrwhite: 'bg-mrwhite',
  success: 'bg-success',
  highlight: 'bg-highlight',
};

/**
 * Formats a curated part id ('flat-top', 'eyes-closed', 'none', …) into a short display
 * label ('Flat top', 'Eyes closed', 'None'). Pure data formatting, not UI copy — like a
 * player name or pack title, the id itself never routes through copy.ts, only the static
 * strings around it do (conventions.md §4).
 */
function formatPartLabel(id: string): string {
  return id
    .split('-')
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

interface PartRowProps<T extends string> {
  part: 'head' | 'face' | 'accessory';
  label: string;
  ids: readonly T[];
  current: T;
  onCycle: (nextId: T) => void;
}

/** One prev/current/next cycling row. Every state change goes through a real `<button>`
 * (conventions.md §4 — keyboard-reachable, no swipe/drag-only control). */
function PartRow<T extends string>({ part, label, ids, current, onCycle }: PartRowProps<T>) {
  function cycle(direction: 1 | -1): void {
    const currentIndex = ids.indexOf(current);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (safeIndex + direction + ids.length) % ids.length;
    onCycle(ids[nextIndex]!);
  }

  return (
    <div className="flex w-full items-center gap-3">
      <span className="w-16 shrink-0 text-left font-ui text-sm text-graphite">{label}</span>
      <div className="flex flex-1 items-center justify-center gap-3">
        <PopButton
          size="md"
          variant="secondary"
          aria-label={copy.avatar.picker.previous(label)}
          data-testid={`avatar-part-prev-${part}`}
          onClick={() => cycle(-1)}
        >
          <IconArrowRight className="h-4 w-4 -scale-x-100" />
        </PopButton>
        <span
          className="min-w-24 text-center font-ui text-base font-bold text-ink"
          data-testid={`avatar-part-current-${part}`}
        >
          {formatPartLabel(current)}
        </span>
        <PopButton
          size="md"
          variant="secondary"
          aria-label={copy.avatar.picker.next(label)}
          data-testid={`avatar-part-next-${part}`}
          onClick={() => cycle(1)}
        >
          <IconArrowRight className="h-4 w-4" />
        </PopButton>
      </div>
    </div>
  );
}

export interface AvatarPickerProps {
  value: AvatarConfig;
  onChange: (next: AvatarConfig) => void;
  className?: string;
}

/**
 * Controlled Open Peeps avatar picker (conventions.md §2/§4; `AvatarConfig` in
 * arch/data-model.md). No store access — whatever screen mounts this (the online lobby,
 * per arch/conventions.md §2) owns persistence. A live `<AvatarDoodle>` preview sits above
 * three prev/next cycling rows (head/face/extras) and 5 ink swatches; the selected swatch is
 * never color-only — it carries a ring plus a check mark, and `aria-pressed`, so the state
 * reads without relying on color perception (conventions.md §2 contrast note / §4
 * color-independent signaling).
 */
export function AvatarPicker({ value, onChange, className }: AvatarPickerProps) {
  const head = isKnownAvatarId(AVATAR_HEAD_IDS, value.head) ? value.head : AVATAR_HEAD_IDS[0];
  const face = isKnownAvatarId(AVATAR_FACE_IDS, value.face) ? value.face : AVATAR_FACE_IDS[0];
  const accessory = isKnownAvatarId(AVATAR_ACCESSORY_IDS, value.accessory)
    ? value.accessory
    : AVATAR_ACCESSORY_IDS[0];

  return (
    <PopCard
      data-testid="avatar-picker"
      className={clsx('flex w-full max-w-sm flex-col items-center gap-5 text-center', className)}
    >
      <div className="flex flex-col items-center gap-1">
        <p className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.avatar.picker.heading}
        </p>
        <p className="font-ui text-sm text-graphite">{copy.avatar.picker.helper}</p>
      </div>

      {/* Avatar in its sticker circle (design-party-pop.md §11). */}
      <span className="inline-flex h-36 w-36 items-center justify-center rounded-full border-3 border-ink bg-paper-2 shadow-hard-sm">
        <AvatarDoodle config={value} size={128} />
      </span>

      <div className="flex w-full flex-col gap-3">
        <PartRow
          part="head"
          label={copy.avatar.picker.rows.head}
          ids={AVATAR_HEAD_IDS}
          current={head}
          onCycle={(nextHead) => onChange({ ...value, head: nextHead })}
        />
        <PartRow
          part="face"
          label={copy.avatar.picker.rows.face}
          ids={AVATAR_FACE_IDS}
          current={face}
          onCycle={(nextFace) => onChange({ ...value, face: nextFace })}
        />
        <PartRow
          part="accessory"
          label={copy.avatar.picker.rows.accessory}
          ids={AVATAR_ACCESSORY_IDS}
          current={accessory}
          onCycle={(nextAccessory) => onChange({ ...value, accessory: nextAccessory })}
        />
      </div>

      <div className="flex items-center gap-3">
        {AVATAR_INK_COLORS.map((token) => {
          const selected = value.inkColor === token;
          return (
            <button
              key={token}
              type="button"
              aria-pressed={selected}
              aria-label={copy.avatar.picker.inkColorNames[token]}
              data-testid={`avatar-ink-${token}`}
              onClick={() => onChange({ ...value, inkColor: token })}
              className={clsx(
                'relative h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-paper-2',
                INK_SWATCH_CLASS[token],
                selected ? 'ring-ink' : 'ring-transparent',
              )}
            >
              {selected ? (
                <IconCheck
                  className="absolute inset-0 m-auto h-4 w-4 text-paper"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </PopCard>
  );
}
