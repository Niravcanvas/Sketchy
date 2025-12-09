import * as Sentry from '@sentry/react';

/**
 * Client-side error tracking. Like the API side, this is
 * the ONE place that decides what context leaves the browser: only `playerId` /
 * `roomCode` tags — never clue text, votes, the `you` slice, or game state
 * (conventions.md §1 redaction rule). A no-op unless `SENTRY_DSN` is configured
 * (threaded through `next.config.mjs`'s `env`, like `PUBLIC_API_URL`).
 */

let initialized = false;

export function initWebObservability(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    // Strip anything payload-shaped Sentry might auto-attach; we only ever want
    // the explicit tags set below.
    beforeSend(event) {
      delete event.extra;
      if (event.request) delete event.request.data;
      return event;
    },
  });
  initialized = true;
}

/** Tag subsequent events with the current guest player id (or clear it). */
export function setPlayerTag(playerId: string | null): void {
  if (!initialized) return;
  Sentry.setTag('playerId', playerId ?? undefined);
}

/** Tag subsequent events with the current room code (or clear it on leave). */
export function setRoomTag(roomCode: string | null): void {
  if (!initialized) return;
  Sentry.setTag('roomCode', roomCode ?? undefined);
}
