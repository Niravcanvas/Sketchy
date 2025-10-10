import { CLIENT_EVENTS, SERVER_EVENTS } from '@sketchy/shared/contract/socket';
import type {
  BasicAck,
  JoinAck,
  RoomEvent,
  RoomSnapshot,
  YouSlice,
} from '@sketchy/shared/contract/socket';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { GuestSession } from '../../src/test-support.js';

/**
 * The reusable scriptable socket bot — formalizes the
 * ad-hoc `ClientHarness` that `sockets/vote.test.ts` and the online e2e each
 * grew their own copy of. It deliberately mirrors the REAL web client's
 * connection contract (`apps/web/src/lib/socket.ts`): every (re)connect
 * re-emits `room:join` for the stored code, because a socket.io reconnect is a
 * brand-new server-side connection with no room binding (api-contract.md §2.3
 * rule 2). That is what makes the chaos suite's disconnect/reconnect churn
 * exercise the same rejoin path a flaky phone does.
 *
 * Chaos knobs: `hardDisconnect()` drops the socket (server sees a `disconnect`,
 * arms the grace window); `reconnect()` reopens it and re-seats — same
 * socket.io client, so `playerId`/token are stable (a genuine rejoin, not a new
 * player). `close()` is the permanent teardown.
 */
export interface BotOptions {
  /** socket.io auto-reconnect. Off by default so chaos is explicit and
   * deterministic — the harness drives reconnects itself via `reconnect()`. */
  reconnection?: boolean;
}

export class SocketBot {
  readonly playerId: string;
  readonly displayName: string;
  readonly token: string;
  readonly snapshots: RoomSnapshot[] = [];
  readonly events: RoomEvent[] = [];
  superseded = false;

  private readonly baseUrl: string;
  private readonly options: BotOptions;
  private code: string | null = null;
  private sock: ClientSocket;

  constructor(baseUrl: string, session: GuestSession, options: BotOptions = {}) {
    this.baseUrl = baseUrl;
    this.token = session.token;
    this.playerId = session.playerId;
    this.displayName = session.displayName;
    this.options = options;
    this.sock = this.buildSocket();
  }

  get socket(): ClientSocket {
    return this.sock;
  }

  private buildSocket(): ClientSocket {
    const socket = ioClient(`${this.baseUrl}/game`, {
      auth: { token: this.token },
      transports: ['websocket'],
      reconnection: this.options.reconnection ?? false,
      // Fast reconnect so a post-restart gap is short (default 1s backoff would
      // leave the game auto-abstaining via timers for too long in tests).
      reconnectionDelay: 200,
      reconnectionDelayMax: 500,
      forceNew: true,
    });
    socket.on(SERVER_EVENTS.roomSnapshot, (snap: RoomSnapshot) => this.snapshots.push(snap));
    socket.on(SERVER_EVENTS.roomEvent, (evt: RoomEvent) => this.events.push(evt));
    socket.on(SERVER_EVENTS.sessionSuperseded, () => {
      this.superseded = true;
    });
    // Mirror the web client: re-join on every (re)connect for the stored code.
    socket.on('connect', () => {
      if (this.code) {
        socket.emit(CLIENT_EVENTS.roomJoin, { code: this.code }, (ack: JoinAck) => {
          if (ack.ok) this.snapshots.push(ack.snapshot);
        });
      }
    });
    return socket;
  }

  /** Opens the connection (idempotent await of the first `connect`), with a
   * timeout so a dead endpoint fails loudly instead of hanging a test forever. */
  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.sock.connected) {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error(`${this.displayName} connect timed out`)),
        timeoutMs,
      );
      this.sock.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.sock.once('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** First join for `code` — records it so every later reconnect re-joins too. */
  async join(code: string): Promise<JoinAck> {
    this.code = code;
    const ack = await this.emit<JoinAck>(CLIENT_EVENTS.roomJoin, { code });
    if (ack.ok) this.snapshots.push(ack.snapshot);
    return ack;
  }

  emit<T>(event: string, payload: unknown = {}): Promise<T> {
    const sentAt = Date.now();
    return new Promise((resolve) => {
      this.sock.emit(event, payload, (response: T) => {
        ackLatencyCollector?.(Date.now() - sentAt);
        resolve(response);
      });
    });
  }

  latest(): RoomSnapshot | undefined {
    return this.snapshots.at(-1);
  }

  you(): YouSlice {
    const snap = this.latest();
    if (!snap) throw new Error(`${this.displayName} has no snapshot`);
    return snap.you;
  }

  /** Latest ver this bot has observed (drives client-side monotonicity checks). */
  maxVer(): number {
    return this.snapshots.reduce((max, s) => Math.max(max, s.ver), 0);
  }

  async waitForSnapshot(
    predicate: (snap: RoomSnapshot) => boolean,
    description: string,
    timeoutMs = 5000,
  ): Promise<RoomSnapshot> {
    const start = Date.now();
    for (;;) {
      const snap = this.latest();
      if (snap && predicate(snap)) return snap;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`${this.displayName} timed out waiting for: ${description}`);
      }
      await sleep(15);
    }
  }

  waitForPhase(phase: string, timeoutMs = 5000): Promise<RoomSnapshot> {
    return this.waitForSnapshot((s) => s.state.phase === phase, `phase ${phase}`, timeoutMs);
  }

  // --- Action shortcuts (each returns the ack) --------------------------------
  ready(ready = true): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.lobbyReady, { ready });
  }
  start(): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.gameStart, {});
  }
  dealAck(): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.dealAck, {});
  }
  submitClue(text: string): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.clueSubmit, { text });
  }
  phaseAdvance(): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.phaseAdvance, {});
  }
  turnSkip(): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.turnSkip, {});
  }
  vote(targetId: string): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.voteCast, { targetId });
  }
  mrWhiteGuess(word: string): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.mrWhiteGuess, { word });
  }
  rematch(): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.gameRematch, {});
  }
  timerExtend(): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.timerExtend, {});
  }
  hostTransfer(targetId: string): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.hostTransfer, { targetId });
  }
  leave(): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.roomLeave, {});
  }
  /** `special:judge` — the Judge special role's tie-breaking call. */
  specialJudge(targetId: string): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.specialJudge, { targetId });
  }
  /** `special:grudge` — the Grudge special role's drag-down choice. */
  specialGrudge(targetId: string): Promise<BasicAck> {
    return this.emit(CLIENT_EVENTS.specialGrudge, { targetId });
  }

  // --- Chaos ------------------------------------------------------------------
  /** Drops the socket. The server sees a `disconnect` and arms the grace window;
   * the bot object survives so `reconnect()` can rejoin with the same identity. */
  hardDisconnect(): void {
    this.sock.disconnect();
  }

  /** Reopens the socket (same identity/token) and re-joins the stored room,
   * awaiting the fresh snapshot — the "you woke your phone up" path. */
  async reconnect(): Promise<void> {
    if (this.sock.connected) return;
    const before = this.snapshots.length;
    // A fresh socket instance avoids reusing a manager whose engine was torn
    // down — matches how the web client rebuilds on a cold reconnect.
    this.sock.removeAllListeners();
    this.sock.disconnect();
    this.sock = this.buildSocket();
    await this.connect();
    await this.waitForSnapshot(
      () => this.snapshots.length > before,
      'snapshot after reconnect',
    );
  }

  close(): void {
    this.code = null;
    this.sock.removeAllListeners();
    this.sock.disconnect();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Optional hook fed the ack round-trip (ms) of every `emit()` — the load smoke
 * uses it to sample action→server-confirmed latency (the handler broadcasts the
 * snapshot immediately before it acks, so ack RTT is a tight proxy for
 * action→snapshot). Null (default) means zero overhead for normal tests.
 */
let ackLatencyCollector: ((ms: number) => void) | null = null;
export function setAckLatencyCollector(collector: ((ms: number) => void) | null): void {
  ackLatencyCollector = collector;
}
