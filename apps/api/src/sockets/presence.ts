import { applyAction } from '@sketchy/engine/apply-action';
import { SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type { FastifyBaseLogger } from 'fastify';
import { armGraceTimer, graceWindowMs } from '../rooms/presence-timers.js';
import { applyRoomAction, getConnEntry, setConnEntry } from '../rooms/room-store.js';
import { broadcastSnapshots } from '../rooms/snapshot.js';
import type { GameNamespace, GameSocket } from './types.js';

/**
 * Registers the presence lifecycle for one connected socket: on `disconnect`
 * it marks the player `connected: false`, fans out the `playerDisconnected`
 * toast, records the disconnect time durably in `conn`, and arms the 90s
 * grace window (`rooms/presence-timers.ts`) whose expiry migrates the host
 * if it was them.
 */
export function registerPresenceHandlers(
  namespace: GameNamespace,
  socket: GameSocket,
  logger: FastifyBaseLogger,
): void {
  socket.on('disconnect', () => {
    void handleDisconnect(namespace, socket, logger);
  });
}

async function handleDisconnect(
  namespace: GameNamespace,
  socket: GameSocket,
  logger: FastifyBaseLogger,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    return;
  }

  try {
    const conn = await getConnEntry(code, playerId);
    // Supersede race guard: if a NEWER socket already overwrote the `conn`
    // mapping for this player (`session:superseded`, sockets/lobby.ts
    // `bindSocketToRoom`), this disconnect event is for the OLD, already
    // replaced socket — presence must not flip back to "disconnected"
    // underneath the new socket.
    if (!conn || conn.socketId !== socket.id) {
      return;
    }

    // Record the disconnect durably: `disconnectedAt` is the source of truth the
    // grace timer re-arms from after a restart (rooms/presence-timers.ts).
    const now = Date.now();
    await setConnEntry(code, playerId, { socketId: socket.id, lastSeenAt: now, disconnectedAt: now });

    const result = await applyRoomAction(code, (state) =>
      applyAction(state, { type: 'presence', playerId, connected: false, at: now }),
    );
    if (!result.ok) {
      // Player no longer in state.players (left/kicked between bind and
      // disconnect) — nothing left to mark.
      return;
    }

    broadcastSnapshots(namespace, code, result.state, result.ver);
    const player = result.state.players.find((p) => p.id === playerId);
    namespace.to(code).emit(SERVER_EVENTS.roomEvent, {
      type: 'playerDisconnected',
      playerId,
      name: player?.name ?? '',
    });

    // Arm the 90s grace window (game-design.md §8). Its expiry migrates the host
    // if this was them; a non-host expiry is a no-op (seat held, "skipped-not-
    // removed"). A reconnect clears this timer (sockets/lobby.ts bindSocketToRoom);
    // the abandon sweeper handles the all-disconnected case separately.
    armGraceTimer(namespace, code, playerId, now + graceWindowMs());
  } catch (error) {
    logger.error({ err: error, playerId, roomCode: code }, 'presence disconnect handling failed');
  }
}
