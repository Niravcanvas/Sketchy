import { applyAction } from '@sketchy/engine/apply-action';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  chatSendPayloadSchema,
  lobbyKickPayloadSchema,
  lobbyReadyPayloadSchema,
  lobbySettingsPayloadSchema,
  roomJoinPayloadSchema,
  roomLeavePayloadSchema,
  roomSyncPayloadSchema,
  timePingPayloadSchema,
} from '@sketchy/shared/contract/socket';
import type {
  BasicAck,
  ChatSendPayload,
  JoinAck,
  LobbyKickPayload,
  LobbyReadyPayload,
  LobbySettingsPayload,
  RoomJoinPayload,
  SyncAck,
  TimePingAck,
} from '@sketchy/shared/contract/socket';
import { containsProfanity } from '@sketchy/shared/profanity';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { getDb, getRedis } from '../db/client.js';
import { players } from '../db/schema.js';
import { allPackIdsAccessible } from '../routes/pack-access.js';
import { resolveAvatar } from '../rooms/default-avatar.js';
import { clearGraceTimer, migrateHostTo, pickMigrationHost } from '../rooms/presence-timers.js';
import { delistPublicLobby } from '../rooms/public-lobbies.js';
import {
  applyRoomAction,
  chatLogKey,
  deleteConnEntry,
  getConnEntry,
  loadRoom,
  ROOM_TTL_SECONDS,
  setConnEntry,
} from '../rooms/room-store.js';
import { broadcastSnapshots, buildSnapshot } from '../rooms/snapshot.js';
import type { GameNamespace, GameSocket } from './types.js';
import { removeFromVoiceRoster, sendVoiceRosterTo } from './voice.js';
import { wireHandler } from './wire.js';

/**
 * Registers every lobby/room/chat client→server event for one connected
 * socket (api-contract.md §2.1). Game-phase events
 * (`game:start`, `clue:submit`, ...) are registered separately —
 * `sockets/index.ts` documents why leaving them unregistered today is safe.
 */
export function registerLobbyHandlers(
  namespace: GameNamespace,
  socket: GameSocket,
  logger: FastifyBaseLogger,
): void {
  socket.on(
    CLIENT_EVENTS.roomJoin,
    wireHandler(logger, socket, CLIENT_EVENTS.roomJoin, roomJoinPayloadSchema, 'join', (payload, ack) =>
      handleRoomJoin(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.roomLeave,
    wireHandler(logger, socket, CLIENT_EVENTS.roomLeave, roomLeavePayloadSchema, 'action', (_payload, ack) =>
      handleRoomLeave(namespace, socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.roomSync,
    wireHandler(logger, socket, CLIENT_EVENTS.roomSync, roomSyncPayloadSchema, 'action', (_payload, ack) =>
      handleRoomSync(socket, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.lobbyReady,
    wireHandler(logger, socket, CLIENT_EVENTS.lobbyReady, lobbyReadyPayloadSchema, 'action', (payload, ack) =>
      handleLobbyReady(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.lobbySettings,
    wireHandler(
      logger,
      socket,
      CLIENT_EVENTS.lobbySettings,
      lobbySettingsPayloadSchema,
      'action',
      (payload, ack) => handleLobbySettings(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.lobbyKick,
    wireHandler(logger, socket, CLIENT_EVENTS.lobbyKick, lobbyKickPayloadSchema, 'action', (payload, ack) =>
      handleLobbyKick(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.chatSend,
    wireHandler(logger, socket, CLIENT_EVENTS.chatSend, chatSendPayloadSchema, 'chat', (payload, ack) =>
      handleChatSend(namespace, socket, payload, ack),
    ),
  );
  socket.on(
    CLIENT_EVENTS.timePing,
    wireHandler(logger, socket, CLIENT_EVENTS.timePing, timePingPayloadSchema, 'action', (_payload, ack) =>
      handleTimePing(ack),
    ),
  );
}

/**
 * Session-supersede (api-contract.md §2): if `playerId` already maps to a
 * DIFFERENT live socket in `conn`, that older socket is told
 * `session:superseded`, removed from the Socket.IO room, and then
 * disconnected — in that order, so by the time its own `disconnect` handler
 * (`sockets/presence.ts`) runs, `conn` already points at the NEW socket and
 * the "am I still the mapped socket" guard there correctly no-ops.
 */
async function bindSocketToRoom(
  namespace: GameNamespace,
  socket: GameSocket,
  code: string,
  playerId: string,
): Promise<void> {
  const existingConn = await getConnEntry(code, playerId);
  const oldSocket =
    existingConn && existingConn.socketId !== socket.id
      ? namespace.sockets.get(existingConn.socketId)
      : undefined;

  await socket.join(code);
  socket.data.roomCode = code;

  if (oldSocket) {
    oldSocket.emit(SERVER_EVENTS.sessionSuperseded);
    await oldSocket.leave(code);
    oldSocket.data.roomCode = undefined;
  }

  // A (re)connection ends any grace window for this player — `lastSeenAt`
  // with NO `disconnectedAt` is the "currently connected" record. This is also
  // what makes a session-supersede/device-switch instant rather than a 90s hole
  // (the superseded old socket's disconnect no-ops via the conn-ownership guard
  // in presence.ts, and this bind has already cleared any timer it might arm).
  await setConnEntry(code, playerId, { socketId: socket.id, lastSeenAt: Date.now() });
  clearGraceTimer(code, playerId);

  // A fresh join AND a rejoin both funnel through here, so this is the one place
  // that guarantees a (re)connecting socket sees the room's CURRENT voice mute roster right
  // away, rather than waiting for someone else to toggle their mic (api-contract.md §2.2
  // `voice:roster` doc comment, delivery case "(b)").
  await sendVoiceRosterTo(socket, code);

  if (oldSocket) {
    oldSocket.disconnect(true);
  }
}

async function handleRoomJoin(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: RoomJoinPayload,
  ack: (response: JoinAck) => void,
): Promise<void> {
  const playerId = socket.data.playerId;
  const code = payload.code;

  const existing = await loadRoom(code);
  if (!existing) {
    ack({ ok: false, error: 'room_not_found' });
    return;
  }

  const alreadySeated = existing.state.players.some((p) => p.id === playerId);

  if (alreadySeated) {
    await handleRejoin(namespace, socket, code, playerId, ack);
    return;
  }

  if (existing.state.phase !== 'lobby') {
    ack({ ok: false, error: 'room_in_progress' });
    return;
  }

  const db = getDb();
  const [playerRow] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!playerRow) {
    ack({ ok: false, error: 'unauthorized' });
    return;
  }

  // Joining a PUBLIC room requires a linked account, same rule as
  // creating one and quick-join. A guest browsing the
  // public list is bounced to the account-link upsell here. Private rooms never
  // reach this branch's mode check, so they stay 100% guest-accessible.
  if (existing.state.mode === 'online_public' && playerRow.isGuest) {
    ack({ ok: false, error: 'account_required' });
    return;
  }

  const avatar = resolveAvatar(playerId, playerRow.avatar);
  const result = await applyRoomAction(code, (state) =>
    applyAction(state, {
      type: 'join',
      playerId,
      at: Date.now(),
      player: { id: playerId, name: playerRow.displayName, avatar },
    }),
  );
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }

  await bindSocketToRoom(namespace, socket, code, playerId);
  broadcastSnapshots(namespace, code, result.state, result.ver);
  namespace.to(code).emit(SERVER_EVENTS.roomEvent, {
    type: 'playerJoined',
    playerId,
    name: playerRow.displayName,
  });
  ack({ ok: true, snapshot: buildSnapshot(result.state, result.ver, playerId) });
}

async function handleRejoin(
  namespace: GameNamespace,
  socket: GameSocket,
  code: string,
  playerId: string,
  ack: (response: JoinAck) => void,
): Promise<void> {
  let wasDisconnected = false;
  let playerName = '';
  const result = await applyRoomAction(code, (state) => {
    const player = state.players.find((p) => p.id === playerId);
    wasDisconnected = player ? !player.connected : false;
    playerName = player?.name ?? '';
    return applyAction(state, { type: 'presence', playerId, connected: true, at: Date.now() });
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }

  await bindSocketToRoom(namespace, socket, code, playerId);
  broadcastSnapshots(namespace, code, result.state, result.ver);
  if (wasDisconnected) {
    namespace.to(code).emit(SERVER_EVENTS.roomEvent, {
      type: 'playerReconnected',
      playerId,
      name: playerName,
    });
  }
  ack({ ok: true, snapshot: buildSnapshot(result.state, result.ver, playerId) });
}

async function handleRoomLeave(
  namespace: GameNamespace,
  socket: GameSocket,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  let playerName = '';
  let wasHost = false;
  const result = await applyRoomAction(code, (state) => {
    const player = state.players.find((p) => p.id === playerId);
    playerName = player?.name ?? '';
    wasHost = state.hostId === playerId;
    return applyAction(state, { type: 'leave', playerId, at: Date.now() });
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }

  await socket.leave(code);
  socket.data.roomCode = undefined;
  await deleteConnEntry(code, playerId);
  clearGraceTimer(code, playerId);
  await removeFromVoiceRoster(namespace, code, playerId);
  // An emptied public lobby leaves the browse index (nothing to join).
  // A non-empty public lobby stays listed; a public room that STARTED a game was
  // already delisted at game:start (sockets/play.ts).
  if (result.state.mode === 'online_public' && result.state.players.length === 0) {
    await delistPublicLobby(code);
  }
  broadcastSnapshots(namespace, code, result.state, result.ver);
  namespace.to(code).emit(SERVER_EVENTS.roomEvent, { type: 'playerLeft', playerId, name: playerName });

  // Explicit host leave → migration is IMMEDIATE (game-design.md §8). In `lobby`
  // the engine's `leave` already re-derived `hostId` (removeAndCompactSeats), so
  // only a MID-GAME leave (where `leave` merely sets `hasLeft`, keeping `hostId`)
  // needs the hand-off here. The leaver is `connected: false`, so
  // `pickMigrationHost` never picks them back.
  if (wasHost && result.state.phase !== 'lobby' && result.state.hostId === playerId) {
    const newHostId = await pickMigrationHost(result.state, code);
    if (newHostId) {
      await migrateHostTo(namespace, code, newHostId);
    }
  }
  ack({ ok: true });
}

async function handleRoomSync(socket: GameSocket, ack: (response: SyncAck) => void): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }
  const room = await loadRoom(code);
  if (!room) {
    ack({ ok: false, error: 'room_not_found' });
    return;
  }
  ack({ ok: true, snapshot: buildSnapshot(room.state, room.ver, playerId) });
}

async function handleLobbyReady(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: LobbyReadyPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  const result = await applyRoomAction(code, (state) =>
    applyAction(state, { type: 'setReady', playerId, ready: payload.ready, at: Date.now() }),
  );
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  broadcastSnapshots(namespace, code, result.state, result.ver);
  ack({ ok: true });
}

async function handleLobbySettings(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: LobbySettingsPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  // A host may select official packs, packs they own, or packs
  // they've imported by share code (`routes/pack-access.ts` — the single
  // "can this caller use this pack" gate shared with the REST pack routes
  // and the draw-time check below). `pack_forbidden` for anything else,
  // including a pack the caller could once see but no longer has standing
  // for (e.g. it went private and the grant was never issued).
  if (payload.packIds && !(await allPackIdsAccessible(payload.packIds, playerId))) {
    ack({ ok: false, error: 'pack_forbidden' });
    return;
  }

  const result = await applyRoomAction(code, (state) =>
    applyAction(state, { type: 'updateSettings', playerId, patch: payload, at: Date.now() }),
  );
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }
  broadcastSnapshots(namespace, code, result.state, result.ver);
  ack({ ok: true });
}

async function handleLobbyKick(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: LobbyKickPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  let targetName = '';
  const result = await applyRoomAction(code, (state) => {
    const target = state.players.find((p) => p.id === payload.playerId);
    targetName = target?.name ?? '';
    return applyAction(state, { type: 'kick', playerId, targetId: payload.playerId, at: Date.now() });
  });
  if (!result.ok) {
    ack({ ok: false, error: result.error });
    return;
  }

  // Broadcast the fresh snapshot + the 'kicked' toast WHILE the kicked
  // socket is still a room member (so it naturally receives both), THEN
  // force it out of the Socket.IO room so later broadcasts skip it.
  broadcastSnapshots(namespace, code, result.state, result.ver);
  namespace.to(code).emit(SERVER_EVENTS.roomEvent, {
    type: 'kicked',
    playerId: payload.playerId,
    name: targetName,
  });

  const kickedConn = await getConnEntry(code, payload.playerId);
  if (kickedConn) {
    const kickedSocket = namespace.sockets.get(kickedConn.socketId);
    if (kickedSocket) {
      await kickedSocket.leave(code);
      kickedSocket.data.roomCode = undefined;
    }
  }
  await deleteConnEntry(code, payload.playerId);
  clearGraceTimer(code, payload.playerId);
  await removeFromVoiceRoster(namespace, code, payload.playerId);

  ack({ ok: true });
}

/** Most recent chat lines kept per room for report context. */
const CHAT_LOG_MAX = 20;

async function handleChatSend(
  namespace: GameNamespace,
  socket: GameSocket,
  payload: ChatSendPayload,
  ack: (response: BasicAck) => void,
): Promise<void> {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  const room = await loadRoom(code);
  if (!room) {
    ack({ ok: false, error: 'room_not_found' });
    return;
  }
  const player = room.state.players.find((p) => p.id === playerId);
  if (!player) {
    ack({ ok: false, error: 'validation' });
    return;
  }

  // Public rooms get the STRICT profanity filter; private/friends rooms
  // keep the default. Checked after the room load so `mode` is known.
  const strict = room.state.mode === 'online_public';
  if (containsProfanity(payload.text, { strict })) {
    ack({ ok: false, error: 'profanity' });
    return;
  }

  const at = Date.now();
  namespace.to(code).emit(SERVER_EVENTS.chatMessage, {
    from: { id: player.id, name: player.name },
    text: payload.text,
    at,
  });

  // Retain a capped ring buffer of recent chat for report context capture
  // (moderation/report-context.ts) — chat is otherwise never stored (it's
  // ephemeral by design, api-contract.md §2.2). Fire-and-forget: a failed
  // context write must never affect chat delivery or the ack.
  const line = JSON.stringify({ id: player.id, name: player.name, text: payload.text, at });
  void getRedis()
    .multi()
    .rpush(chatLogKey(code), line)
    .ltrim(chatLogKey(code), -CHAT_LOG_MAX, -1)
    .expire(chatLogKey(code), ROOM_TTL_SECONDS)
    .exec()
    .catch(() => {});

  ack({ ok: true });
}

function handleTimePing(ack: (response: TimePingAck) => void): void {
  ack({ ok: true, serverNow: Date.now() });
}
