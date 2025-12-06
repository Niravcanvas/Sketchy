import clsx from 'clsx';

export interface HowItWorksStepProps {
  eyebrow: string;
  title: string;
  body: string;
  doodleSrc: string;
  doodleAlt: string;
  /** Alternates the card's sticker tilt so a row of three doesn't read as a grid of
   * identical tiles (design-party-pop.md §4 "sticker energy — used sparingly"). */
  tilt: '-rotate-1' | 'rotate-1' | '-rotate-2';
}

/**
 * One "how it works" beat (landing page, non-cliché 3-step
 * section). Deliberately NOT a numbered-circle-plus-icon row: each step is a full
 * Party-Pop sticker card carrying a real Open Doodles scene illustration, an uppercase
 * eyebrow standing in for the step number, a display headline, and a full sentence of
 * copy — closer to an editorial spread than a SaaS feature grid.
 */
export function HowItWorksStep({
  eyebrow,
  title,
  body,
  doodleSrc,
  doodleAlt,
  tilt,
}: HowItWorksStepProps) {
  return (
    <li
      className={clsx(
        'flex flex-col gap-4 rounded-2xl border-3 border-ink bg-paper-2 p-6 shadow-hard',
        tilt,
      )}
    >
      <img
        src={doodleSrc}
        alt={doodleAlt}
        width={480}
        height={360}
        loading="lazy"
        className="h-auto w-full max-w-[220px] self-center"
      />
      <p className="font-ui text-xs font-bold uppercase tracking-[0.14em] text-graphite">
        {eyebrow}
      </p>
      <h3 className="font-display text-xl uppercase tracking-wide text-ink">{title}</h3>
      <p className="font-ui text-sm text-graphite">{body}</p>
    </li>
  );
}
