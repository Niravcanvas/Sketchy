/**
 * Maps the `@sketchy/config` Tailwind palette tokens (arch/design-party-pop.md
 * §2) to the CSS custom properties declared in `globals.css`.
 *
 * A few surfaces paint into a bare SVG rather than through Tailwind utility
 * classes (the PopTimerRing arc, avatar ink), so they need an actual CSS
 * color value, not a class name. This is the one place a palette token name
 * resolves to a color — components should never inline raw hex themselves.
 */
export const PALETTE_TOKENS = [
  'paper',
  'paper-2',
  'ink',
  'graphite',
  'civilian',
  'undercover',
  'mrwhite',
  'highlight',
  'success',
  'phase-discuss',
  'phase-vote',
  'phase-reveal',
] as const;

export type PaletteToken = (typeof PALETTE_TOKENS)[number];

/** Resolves a palette token name to the CSS custom property that carries it. */
export function paletteVar(token: PaletteToken): string {
  return `var(--color-${token})`;
}
