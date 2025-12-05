'use client';

import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';

export interface PopInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label — required; every input must be labelled (conventions.md §4). */
  label: string;
}

/**
 * Labelled text input (design-party-pop.md §5.3). Focus styling comes from
 * the global `:focus-visible` rule (globals.css) — never overridden here.
 */
export const PopInput = forwardRef<HTMLInputElement, PopInputProps>(function PopInput(
  { label, className, id, ...props },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-ink"
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={clsx(
          'w-full rounded-xl border-3 border-ink bg-paper-2 px-4 py-3',
          'font-ui font-medium text-ink shadow-hard-sm placeholder:text-graphite',
          className,
        )}
        {...props}
      />
    </div>
  );
});
