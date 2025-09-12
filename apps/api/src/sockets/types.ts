import type {
  BasicAck,
  ChatMessage,
  ChatSendPayload,
  ClueSubmitPayload,
  DealAckPayload,
  GameRematchPayload,
  GameStartPayload,
  HostTransferPayload,
  JoinAck,
  LobbyKickPayload,
  LobbyReadyPayload,
  LobbySettingsPayload,
  MmMatched,
  MrWhiteGuessPayload,
  PhaseAdvancePayload,
  RoomEvent,
  RoomJoinPayload,
  RoomLeavePayload,
  RoomSnapshot,
  RoomSyncPayload,
  SpecialGrudgePayload,
  SpecialJudgePayload,
  SyncAck,
  TimePingAck,
  TimePingPayload,
  TimerExtendPayload,
  TurnSkipPayload,
  VoiceRoster,
  VoiceStatePayload,
  VoteCastPayload,
} from '@sketchy/shared/contract/socket';
import type { Namespace, Server, Socket } from 'socket.io';

/** Per-socket data attached at handshake (`sockets/index.ts` auth middleware)
 * and updated as the socket binds to a room (`sockets/lobby.ts`). */
export interface SocketData {
  playerId: string;
  /** Set once `room:join` binds this socket to a room; cleared on `room:leave`. */
  roomCode?: string;
}

/**
 * Typed Socket.IO event maps for the `/game` namespace (api-contract.md §2).
 * Kept here (rather than typing every `.on()` call `any`) so the handler
 * modules get real payload/ack types without re-deriving them — every
 * payload/ack type is imported straight from `@sketchy/shared/contract/socket`,
 * the actual wire contract.
 */
export interface ClientToServerEvents {
  'room:join': (payload: RoomJoinPayload, ack: (response: JoinAck) => void) => void;
  'room:leave': (payload: RoomLeavePayload, ack: (response: BasicAck) => void) => void;
  'room:sync': (payload: RoomSyncPayload, ack: (response: SyncAck) => void) => void;
  'lobby:ready': (payload: LobbyReadyPayload, ack: (response: BasicAck) => void) => void;
  'lobby:settings': (payload: LobbySettingsPayload, ack: (response: BasicAck) => void) => void;
  'lobby:kick': (payload: LobbyKickPayload, ack: (response: BasicAck) => void) => void;
  'chat:send': (payload: ChatSendPayload, ack: (response: BasicAck) => void) => void;
  'time:ping': (payload: TimePingPayload, ack: (response: TimePingAck) => void) => void;
  'game:start': (payload: GameStartPayload, ack: (response: BasicAck) => void) => void;
  'deal:ack': (payload: DealAckPayload, ack: (response: BasicAck) => void) => void;
  'clue:submit': (payload: ClueSubmitPayload, ack: (response: BasicAck) => void) => void;
  'phase:advance': (payload: PhaseAdvancePayload, ack: (response: BasicAck) => void) => void;
  'turn:skip': (payload: TurnSkipPayload, ack: (response: BasicAck) => void) => void;
  'timer:extend': (payload: TimerExtendPayload, ack: (response: BasicAck) => void) => void;
  'vote:cast': (payload: VoteCastPayload, ack: (response: BasicAck) => void) => void;
  'mrwhite:guess': (payload: MrWhiteGuessPayload, ack: (response: BasicAck) => void) => void;
  'game:rematch': (payload: GameRematchPayload, ack: (response: BasicAck) => void) => void;
  'host:transfer': (payload: HostTransferPayload, ack: (response: BasicAck) => void) => void;
  'special:judge': (payload: SpecialJudgePayload, ack: (response: BasicAck) => void) => void;
  'special:grudge': (payload: SpecialGrudgePayload, ack: (response: BasicAck) => void) => void;
  'voice:state': (payload: VoiceStatePayload, ack: (response: BasicAck) => void) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (payload: RoomSnapshot) => void;
  'room:event': (payload: RoomEvent) => void;
  'chat:message': (payload: ChatMessage) => void;
  'session:superseded': () => void;
  'voice:roster': (payload: VoiceRoster) => void;
  'mm:matched': (payload: MmMatched) => void;
}

/** No inter-server events yet (single process, system-design.md §4.5). */
export type InterServerEvents = Record<string, never>;

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type GameNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
