/**
 * Loud, unmissable draft flag for `/privacy` and `/terms` —
 * "Mark both clearly as 'DRAFT — product owner must review before public launch.'"
 * Undercover red is the palette's danger/destructive token (design-party-pop.md §2) —
 * repurposed here as "this isn't final," the closest existing semantic match rather than
 * inventing a new warning color.
 */
export function DraftBanner({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="rotate-1 rounded-xl border-3 border-ink bg-undercover px-4 py-3 font-ui text-sm font-bold uppercase tracking-[0.04em] text-white shadow-hard"
    >
      {text}
    </p>
  );
}
