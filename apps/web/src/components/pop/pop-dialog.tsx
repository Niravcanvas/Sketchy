'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { IconCross } from '@/components/icons/icon-cross';

export interface PopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /**
   * Render `description` for assistive tech only (`sr-only`). Radix needs a
   * `Dialog.Description` to wire `aria-describedby`, but some dialogs have no
   * room for a visible line — this satisfies the requirement without changing
   * the visual layout.
   */
  descriptionHidden?: boolean;
  children?: ReactNode;
  trigger?: ReactNode;
  /**
   * Label for the close button. A required prop rather than a hardcoded
   * string so every string this component renders still traces back to
   * copy.ts / caller props (conventions.md §4 — no string literals in JSX).
   */
  closeLabel: string;
}

/**
 * Restyled `@radix-ui/react-dialog` (design-party-pop.md §5.4 — radix allowed
 * for a11y primitives, restyled to the Party Pop look). Radix owns focus trap,
 * `Escape`-to-close and `aria-modal` wiring; we only supply the white card
 * chrome, the 3px ink border and the hard offset shadow.
 */
export function PopDialog({
  open,
  onOpenChange,
  title,
  description,
  descriptionHidden = false,
  children,
  trigger,
  closeLabel,
}: PopDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-3 border-ink bg-paper-2 p-6 shadow-hard-lg">
          <div className="flex flex-col gap-3">
            <Dialog.Title className="pr-10 font-display text-2xl uppercase tracking-wide text-ink">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className={descriptionHidden ? 'sr-only' : 'font-ui text-graphite'}>
                {description}
              </Dialog.Description>
            ) : null}
            {children}
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label={closeLabel}
              className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-lg border-3 border-ink bg-paper-2 text-ink shadow-hard-sm transition-transform duration-150 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed"
            >
              <IconCross className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
