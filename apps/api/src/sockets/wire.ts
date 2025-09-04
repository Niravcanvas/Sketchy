import type { ErrorCode } from '@sketchy/shared/contract/errors';
import type { FastifyBaseLogger } from 'fastify';
import type { ZodType } from 'zod';
import { captureError } from '../observability.js';
import { checkRateLimit } from '../rate-limit.js';
import { recordAction } from '../services/stats.js';
import type { GameSocket } from './types.js';

type RateLimitScope = 'join' | 'action' | 'chat';

/**
 * Every concrete `TAck` this module deals with is a `SocketAck<T>`
 * (`packages/shared/src/contract/socket.ts`): `({ok:true} & T) | {ok:false,
 * error}`. The failure branch is identical across every `T`, but a bare
 * `{ok:false, error} as TAck` doesn't typecheck for an unconstrained generic
 * (TS can't prove the object satisfies whichever concrete `TAck` the caller
 * instantiated). Routing it through `unknown` once, here, is the single
 * place that assertion is made — every call site stays a plain, un-asserted
 * `ErrorCode` string.
 */
function failAck<TAck>(error: ErrorCode): TAck {
  return { ok: false, error } as unknown as TAck;
}

/** Per-event-group limits (data-model.md §2 `rl:{scope}:{key}`, pinned
 * decision): join 10/min, ready/settings/kick/leave/sync 60/min, chat 15/min.
 * `time:ping` isn't in that enumerated list (it's a clock probe, not a room
 * action) — it rides the generous `action` bucket rather than going
 * unlimited, a deliberate judgment call. */
const RATE_LIMITS: Record<RateLimitScope, number> = { join: 10, action: 60, chat: 15 };

type AckOf<TAck> = (response: TAck) => void;

/**
 * Wraps a socket event handler with the pipeline every client→server event
 * follows (api-contract.md §2, conventions.md §1 "route files ... auth →
 * zod-validate → engine/db → reply envelope", adapted to sockets): zod-parse
 * the raw payload → per-scope rate limit (reusing the exact REST sliding-window
 * checker, `rate-limit.ts`) → run `handler` → ack. The wrapped handler NEVER
 * throws past this boundary — any unexpected error is caught, logged, and
 * turned into an `{ok:false, error:'internal'}` ack instead of crashing the
 * socket or the process. Exactly one pino line per action
 * (`playerId`/`roomCode`/`action`/`ms` — never event payload contents, so
 * clue/chat/vote text is never logged).
 */
export function wireHandler<TPayload, TAck extends { ok: boolean }>(
  logger: FastifyBaseLogger,
  socket: GameSocket,
  eventName: string,
  schema: ZodType<TPayload>,
  scope: RateLimitScope,
  handler: (payload: TPayload, ack: AckOf<TAck>) => Promise<void> | void,
): (payload: unknown, ack: AckOf<TAck>) => void {
  async function run(rawPayload: unknown, ack: AckOf<TAck>): Promise<void> {
    const safeAck: AckOf<TAck> = (response) => {
      if (typeof ack === 'function') {
        ack(response);
      }
    };

    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) {
      safeAck(failAck<TAck>('validation'));
      return;
    }

    const allowed = await checkRateLimit(scope, socket.data.playerId, RATE_LIMITS[scope], logger);
    if (!allowed) {
      safeAck(failAck<TAck>('rate_limited'));
      return;
    }

    // Stats gauge — fire-and-forget: the actions/min
    // counter must never affect an action's latency or ack.
    void recordAction().catch(() => {});

    const startedAt = Date.now();
    try {
      await handler(parsed.data, safeAck);
    } catch (error) {
      logger.error({ err: error, playerId: socket.data.playerId }, 'socket handler error');
      captureError(error, {
        playerId: socket.data.playerId,
        roomCode: socket.data.roomCode,
        action: eventName,
      });
      safeAck(failAck<TAck>('internal'));
    } finally {
      logger.info(
        {
          playerId: socket.data.playerId,
          roomCode: socket.data.roomCode,
          action: eventName,
          ms: Date.now() - startedAt,
        },
        'socket action',
      );
    }
  }

  return (rawPayload, ack) => {
    void run(rawPayload, ack);
  };
}
