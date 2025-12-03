/**
 * First-game contextual hints (arch/copy.md "Onboarding chrome" §10 subsection):
 * one-time dismissible callouts on the peek card, the clue input, and the vote grid.
 * Dismissal is remembered per-device in localStorage — same SSR-safe, error-swallowing
 * shape as `active-room.ts` (a game must never break just because localStorage is
 * unavailable). Not a zustand store on purpose: this is UI chrome state, not game state,
 * and lives in `lib/` alongside `active-room.ts` rather than `stores/`.
 */
const DISMISSED_HINTS_KEY = 'sketchy.dismissedHints.v1';

/** One id per hint surface (design-party-pop.md §11-adjacent onboarding chrome). Adding a
 * new hint later just means adding a new id here plus its copy — the storage shape (a set
 * of ids in one JSON array) never needs to change. */
export type HintId = 'peekCard' | 'clueInput' | 'voteGrid';

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeDismissedHints(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readDismissed(): HintId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_HINTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is HintId => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function isHintDismissed(id: HintId): boolean {
  return readDismissed().includes(id);
}

export function dismissHint(id: HintId): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readDismissed();
    if (!current.includes(id)) {
      window.localStorage.setItem(DISMISSED_HINTS_KEY, JSON.stringify([...current, id]));
    }
  } catch {
    // ignore — storage unavailable
  }
  emitChange();
}
