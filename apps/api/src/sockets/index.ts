import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyPlayerToken } from '../auth/jwt.js';
import { getRedis } from '../db/client.js';
import { getEnv } from '../env.js';
import { startMatchmaker, stopMatchmaker } from '../matchmaking/matcher.js';
import { personalRoom } from '../matchmaking/personal-room.js';
import { dequeue } from '../matchmaking/queue-store.js';
import { isSuspended, loadSuspendedIntoRedis } from '../moderation/suspension.js';
import {
  clearAllGraceTimers,
  rearmGraceTimersFromRedis,
  startAbandonSweeper,
  stopAbandonSweeper,
} from '../rooms/presence-timers.js';
import { clearAllTimers, rearmTimersFromRedis } from '../rooms/timer-wheel.js';
import { setGameNamespace } from './namespace-registry.js';
import { registerLobbyHandlers } from './lobby.js';
import { registerPlayHandlers } from './play.js';
import { registerPresenceHandlers } from './presence.js';
import { registerVoiceHandlers } from './voice.js';
import type {
  ClientToServerEvents,
  GameServer,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './types.js';

/**
 * Attaches the Socket.IO `/game` namespace to the shared Fastify HTTP server
 * (system-design.md §5). Called once from
 * `server.ts` during `buildServer()`, mirroring the other `register*`
 * helpers in this codebase (`registerAuthDecoration`, `registerGlobalRateLimit`).
 *
 * `registerPlayHandlers` (`sockets/play.ts`) wires the full gameplay event set
 * (`game:start`, `deal:ack`, `clue:submit`, `phase:advance`, `turn:skip`,
 * `timer:extend`, `vote:cast`, `mrwhite:guess`, `game:rematch`, plus the
 * special-role events) alongside the in-process timer wheel's boot re-arm
 * (`rooms/timer-wheel.ts` — system-design.md §4.6: Redis is the source of
 * truth for `phaseEndsAt` across a restart).
 */
export async function registerSockets(fastify: FastifyInstance): Promise<void> {
  const env = getEnv();

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    fastify.server,
    {
      transports: ['websocket'],
      cors: { origin: env.corsOrigins.length > 0 ? env.corsOrigins : false },
    },
  );

  // Redis adapter: dormant pass-through with a single API process, but
  // installed from day one so a future 2nd process fans out broadcasts
  // correctly with no code change (system-design.md §4.5).
  const pubClient = getRedis().duplicate();
  const subClient = getRedis().duplicate();
  // Without a listener, a connection-level 'error' event would crash the
  // process (EventEmitter default behavior) — mirrors `db/client.ts`'s
  // `getRedis()` guard.
  pubClient.on('error', (error) => fastify.log.error({ err: error }, 'redis adapter pubClient error'));
  subClient.on('error', (error) => fastify.log.error({ err: error }, 'redis adapter subClient error'));
  io.adapter(createAdapter(pubClient, subClient));

  const gameNamespace = io.of('/game');
  // Expose the namespace to the REST admin-stats route (socketsConnected gauge).
  setGameNamespace(gameNamespace);

  // Handshake auth (api-contract.md §2): verify the JWT the same way REST
  // does, attach `{playerId}` to `socket.data`. Any failure refuses the
  // connection outright — there is no "connected but unauthenticated" state
  // on this namespace.
  gameNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token as unknown;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('unauthorized'));
      return;
    }
    verifyPlayerToken(token)
      .then(async (claims) => {
        if (!claims) {
          next(new Error('unauthorized'));
          return;
        }
        // A moderation-suspended player is refused at the socket
        // handshake too (mirrors the REST `requireAuth` gate), so a suspend
        // takes effect on their live game socket, not just future REST calls.
        // Distinct `suspended` error string so the client renders the right copy.
        if (await isSuspended(claims.playerId, fastify.log)) {
          next(new Error('suspended'));
          return;
        }
        socket.data.playerId = claims.playerId;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  gameNamespace.on('connection', (socket) => {
    // Every socket joins its player's personal room so the matcher
    // can push `mm:matched` to a queued player who isn't in any GAME room yet
    // (and to every open tab). Cleaned up automatically on disconnect.
    void socket.join(personalRoom(socket.data.playerId));

    registerLobbyHandlers(gameNamespace, socket, fastify.log);
    registerPresenceHandlers(gameNamespace, socket, fastify.log);
    registerPlayHandlers(gameNamespace, socket, fastify.log);
    // voice:state/voice:roster — cosmetic to the engine, so it's its own tiny
    // handler module rather than folded into lobby/play (sockets/voice.ts doc comment).
    registerVoiceHandlers(gameNamespace, socket, fastify.log);

    // Leave the quick-join queue when the player's LAST socket drops
    // (a queued player who closes the tab shouldn't stay matchable). Checked
    // against the personal room's remaining membership so a second open tab
    // keeps them queued.
    socket.on('disconnect', () => {
      const remaining = gameNamespace.adapter.rooms.get(personalRoom(socket.data.playerId))?.size ?? 0;
      if (remaining === 0) {
        void dequeue(socket.data.playerId).catch(() => {});
      }
    });
  });

  // Boot re-arm (system-design.md §4.6): after the namespace + its handlers
  // exist (so a timer firing mid-scan can broadcast normally), scan every
  // persisted room and re-arm whichever ones have an active mid-game
  // deadline — a process restart (deploy, crash) never silently drops a
  // `phaseEndsAt`, it just loses the in-memory `setTimeout` backing it.
  const rearmedCount = await rearmTimersFromRedis(gameNamespace);
  fastify.log.info({ rearmedCount }, 'timer wheel: boot re-arm complete');

  // The SECOND timer class — re-arm running disconnect grace windows
  // (host migration survives a restart mid-grace) and start the abandon reaper.
  const rearmedGraceCount = await rearmGraceTimersFromRedis(gameNamespace);
  fastify.log.info({ rearmedGraceCount }, 'grace timers: boot re-arm complete');
  startAbandonSweeper(gameNamespace);

  // Rehydrate the fast suspended-set from Postgres (so a flushed Redis
  // never silently un-suspends anyone), then start the quick-join matcher.
  const suspendedCount = await loadSuspendedIntoRedis();
  fastify.log.info({ suspendedCount }, 'suspension set: boot rehydrate complete');
  startMatchmaker(gameNamespace, fastify.log);

  fastify.addHook('onClose', async () => {
    clearAllTimers();
    clearAllGraceTimers();
    stopAbandonSweeper();
    stopMatchmaker();
    setGameNamespace(undefined);
    await closeSockets(io, pubClient, subClient);
  });
}

/**
 * Closes the Socket.IO server and its two duplicated Redis adapter
 * connections on fastify's `onClose`.
 *
 * `io.close()` internally calls `@socket.io/redis-adapter`'s OWN `close()`,
 * which fires several unsubscribe commands on `subClient` WITHOUT awaiting
 * or catching their replies — a fire-and-forget internal detail of that
 * library, outside our control. Quitting `subClient` immediately afterward
 * can race those in-flight replies (observed empirically: sometimes within
 * a tick, sometimes a few ms later under load), and when the connection
 * then closes, ioredis rejects whichever of those commands hadn't replied
 * yet with `Connection is closed.` — an unhandled rejection ORIGINATING
 * INSIDE the adapter, on a promise we never had a handle to `.catch()`.
 * A short-lived, narrowly-scoped `unhandledRejection` listener absorbs
 * exactly that one known, benign race during this shutdown window and
 * rethrows anything else immediately, so a real bug is never silently
 * masked.
 */
async function closeSockets(io: GameServer, pubClient: Redis, subClient: Redis): Promise<void> {
  const isBenignAdapterTeardownRace = (reason: unknown): boolean =>
    reason instanceof Error && reason.message === 'Connection is closed.';

  const absorbBenignRejections = (reason: unknown): void => {
    if (!isBenignAdapterTeardownRace(reason)) {
      throw reason;
    }
  };

  process.on('unhandledRejection', absorbBenignRejections);
  try {
    await io.close();
    await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    // Give any still-in-flight adapter teardown replies (see above) a
    // moment to land before we stop watching for them.
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    process.off('unhandledRejection', absorbBenignRejections);
  }
}
