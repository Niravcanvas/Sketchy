/**
 * Minimal, lazily-loaded wrapper over Google Identity Services (GIS).
 *
 * The GIS script (`accounts.google.com/gsi/client`) is injected ONLY when a
 * caller asks for it — which only happens when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is
 * configured and the Google button actually renders. So a deployment without a
 * provisioned client ID never loads any Google code and never lets Google set a
 * cookie (the conditional privacy claim in `copy.ts`: Sketchy sets no cookies of
 * its own; Google may, but only if you use Sign in with Google). Isolated behind
 * this module so the button component — and its test — depend on a small typed
 * surface rather than reaching into `window.google` directly.
 */

/** The credential the GIS callback delivers — `credential` is the ID token (a JWT). */
export interface GoogleCredentialResponse {
  credential: string;
}

/** The slice of `google.accounts.id` this app uses (the credential/button flow). */
export interface GoogleIdentityApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { theme?: string; size?: string; text?: string; width?: number },
  ): void;
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GisWindow extends Window {
  google?: { accounts?: { id?: GoogleIdentityApi } };
}

// Module-scoped so repeated renders (dialog open/close) inject the script at most
// once and share the same in-flight load.
let loadPromise: Promise<GoogleIdentityApi> | null = null;

/**
 * Injects the GIS script once (idempotent) and resolves with `google.accounts.id`.
 * Rejects on the server (no `window`) or if the script fails to load/initialize —
 * the caller surfaces that as a generic offline error, never a crash.
 */
export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity Services is unavailable on the server'));
  }
  const already = (window as GisWindow).google?.accounts?.id;
  if (already) return Promise.resolve(already);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = (window as GisWindow).google?.accounts?.id;
      if (api) {
        resolve(api);
      } else {
        reject(new Error('Google Identity Services loaded but did not initialize'));
      }
    };
    script.onerror = () => {
      // Let a later attempt retry from scratch rather than caching the failure.
      loadPromise = null;
      reject(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}
