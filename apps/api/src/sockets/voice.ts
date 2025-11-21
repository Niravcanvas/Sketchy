import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  voiceStatePayloadSchema,
} from '@sketchy/shared/contract/socket';
import type { BasicAck, VoiceStatePayload } from '@sketchy/shared/contract/socket';
import type { FastifyBaseLogger } from 'fastify';
import { getEnv } from '../env.js';
import { deleteVoiceEntry, getVoiceRoster, setVoiceMute } from '../rooms/voice-store.js';
import type { GameNamespace, GameSocket } from './types.js';
import { wireHandler } from './wire.js';

/**
 * Sends the CURRENT full mute roster for `code` to `socket` only (not a
 * broadcast) — api-contract.md §2.2 `voice:roster`'s "(b)" delivery case: a
 * just-(re)joined socket sees who's muted immediately, without waiting for
 * someone else to toggle their mic. Called from `sockets/lobby.ts`'s
 * `bindSocketToRoom` (the one place both `room:join` and rejoin funnel
 * through), so a late joiner and a reconnect both get it for free. A no-op
 * payload (`{}` roster) is still sent when nobody has touched voice yet —
 * simpler for the client than "sometimes you get this event, sometimes you
 * don't".
 */
export async function sendVoiceRosterTo(socket: GameSocket, code: string): Promise<void> {
  const muted = await getVoiceRoster(code);
  socket.emit(SERVER_EVENTS.voiceRoster, { muted });
}

/**
 * Broadcasts the full mute roster to every socket currently in the
 * Socket.IO room `code` — api-contract.md §2.2 `voice:roster`'s "(a)"
 * delivery case, fired whenever any player's `voice:state` changes. Full
 * map (not a `{playerId, muted}` delta) on purpose: rooms top out at 20
 * players, so this stays tiny, and a full replace is simpler and
 * self-healing (no ordering/drop concerns) than a diff protocol.
 */
async function broadcastVoiceRoster(namespace: GameNamespace, code: string): Promise<void> {
  const muted = await getVoiceRoster(code);
  namespace.to(code).emit(SERVER_EVENTS.voiceRoster, { muted });
}

/**
 * Drops a departed player's roster entry and re-broadcasts (`sockets/lobby.ts`'s
 * `room:leave`/`lobby:kick` handlers) so a left/kicked player never lingers as
 * "muted"/"unmuted" in a player strip they're no longer seated in. Best-effort by design —
 * called AFTER the engine's own leave/kick already succeeded, so a failure here would never
 * roll back a seat change; voice state is explicitly allowed to be eventually-consistent
 * (system-design.md §8, cosmetic to the engine).
 */
export async function removeFromVoiceRoster(
  namespace: GameNamespace,
  code: string,
  playerId: string,
): Promise<void> {
  await deleteVoiceEntry(code, playerId);
  await broadcastVoiceRoster(namespace, code);
}

/**
 * Registers `voice:state` for one connected socket (api-contract.md §2.1).
 * No engine involvement whatsoever — voice
 * presence is cosmetic (system-design.md §8), so this never touches
 * `applyRoomAction`/`GameState`; it only persists to the small Redis mirror
 * (`rooms/voice-store.ts`) and fans out `voice:roster`. No phase/turn/alive
 * restriction: Ghosts and pre-game lobby chatter are both legal
 * (game-design.md §9, §10).
 */
export function registerVoiceHandlers(
  namespace: GameNamespace,
  socket: GameSocket,
  logger: FastifyBaseLogger,
): void {
  socket.on(
    CLIENT_EVENTS.voiceState,
    wireHandler(
      logger,
      socket,
      CLIENT_EVENTS.voiceState,
      voiceStatePayloadSchema,
      'action',
      (payload, ack) => handleVoiceState(namespace, socket, payload, ack),
    ),
  );
}

async function handleVoiceState(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: VoiceStatePayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  if (!getEnv().voiceEnabled) {
    ack({ ok: false, error: 'voice_disabled' });
    return;
  }

  await setVoiceMute(code, playerId, payload.muted);
  await broadcastVoiceRoster(namespace, code);
  ack({ ok: true });
}
