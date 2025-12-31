import { createApiClient } from '@sketchy/shared/client';
import { getApiUrl } from './api-url';
import { useSessionStore } from '@/stores/session-store';

/**
 * The one REST client instance for the app (conventions.md §1 — components
 * subscribe to stores, never build their own client). Wired directly to
 * `session-store`: reads the live token for the `Authorization` header on
 * every request, and feeds any silently re-issued token (api-contract.md
 * §1, `X-Refreshed-Token`) straight back into the store.
 *
 * `session-store.ts` imports `apiClient` from here, and this module imports
 * `useSessionStore` from there — a deliberate circular import. It's safe
 * because every cross-reference is inside a closure (`getToken`,
 * `onTokenRefresh`, and the store's action bodies) that only runs after both
 * modules have finished loading, never at module-evaluation time.
 */
export const apiClient = createApiClient({
  baseUrl: getApiUrl(),
  getToken: () => useSessionStore.getState().token,
  onTokenRefresh: (token) => {
    useSessionStore.getState().applyRefreshedToken(token);
  },
});
