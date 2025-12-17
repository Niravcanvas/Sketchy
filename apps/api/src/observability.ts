import * as Sentry from '@sentry/node';
import { getEnv } from './env.js';

/**
 * Error tracking (system-design.md §9). Sentry is wired
 * through this ONE module so the redaction rule (conventions.md §1: never log
 * words/roles/votes) is enforced in a single place: the only structured context
 * we ever attach is `playerId` / `roomCode` tags — never action payloads, clue
 * text, votes, or the game state. pino JSON logs remain the primary signal;
 * Sentry is the aggregation layer on top and is a no-op unless `SENTRY_DSN` is set.
 */

let initialized = false;

/** Initialize Sentry once at boot. Safe to call when no DSN is configured
 * (becomes a no-op) — mirrors the fail-soft posture of the store singletons. */
export function initObservability(): void {
  if (initialized) return;
  const dsn = getEnv().sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // No performance tracing at launch (free tier) — error capture only.
    tracesSampleRate: 0,
    // Belt-and-suspenders against the redaction rule: strip request bodies and
    // any payload-shaped context Sentry might otherwise attach automatically.
    beforeSend(event) {
      if (event.request) delete event.request.data;
      delete event.extra;
      return event;
    },
  });
  initialized = true;
}

export interface ErrorContext {
  playerId?: string;
  roomCode?: string;
  action?: string;
}

/**
 * Report an error to Sentry with ONLY the allowed tags. A no-op (beyond the
 * caller's own pino logging) when Sentry isn't initialized. `action` is the
 * socket event name (e.g. `clue:submit`) — the event NAME, never its payload.
 */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context.playerId) scope.setTag('playerId', context.playerId);
    if (context.roomCode) scope.setTag('roomCode', context.roomCode);
    if (context.action) scope.setTag('action', context.action);
    Sentry.captureException(error);
  });
}

/** Flush pending events on shutdown (best-effort, short deadline). */
export async function closeObservability(): Promise<void> {
  if (!initialized) return;
  await Sentry.close(2000);
  initialized = false;
}
