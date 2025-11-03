'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/stores/session-store';

/**
 * Session bootstrap: fires `session-store`'s
 * `hydrate()` exactly once on mount, so the guest session persisted in
 * localStorage (if any) is restored before the rest of the app reads
 * `session-store`. Rendered once from `layout.tsx`, alongside `children`
 * rather than wrapping them, so the page itself stays a Server Component —
 * this is the one client leaf whose whole job is the side effect. Renders no
 * DOM of its own.
 */
export function SessionBoot() {
  const hydrate = useSessionStore((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return null;
}
