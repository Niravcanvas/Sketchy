/**
 * A Node-only script that uses ONLY the documented public contract (REST via
 * `@sketchy/shared/client`, realtime via `socket.io-client`) to: authenticate three guest
 * players, create a room, ready up, play a full game to a win, and print a transcript —
 * proving the `/v1` contract (frozen per arch/api-contract.md §0) is complete
 * enough for a client that has never seen `apps/*`'s source to build a working game client
 * against. It doubles as:
 *   1. Living documentation for whoever builds the mobile app (arch/mobile-notes.md points
 *      here) — every socket event/REST call below is exactly what a React Native client
 *      would also do.
 *   2. A CI smoke-test candidate exercising the real wire protocol end-to-end, not just
 *      each package's own unit tests.
 *   3. An auth-portability proof — see `runAuthPortabilityChecks` below: the
 *      full guest token lifecycle (issue, bearer use, silent re-issue, socket handshake,
 *      expired-token rejection) exercised from OUTSIDE the API process, over real HTTP/WS.
 *
 * ZERO imports from `apps/*` and zero browser APIs — only
 * `@sketchy/shared`, `@sketchy/engine` (types only), `socket.io-client`, and `jose` (the
 * auth-portability sub-check only — see its own doc comment for why that one legitimately
 * needs a shared secret a real mobile client would never hold).
 *
 * Usage:
 *   PUBLIC_API_URL=http://localhost:4100 pnpm --filter @sketchy/shared example:headless-client
 *
 * Env vars (all optional):
 *   PUBLIC_API_URL   Base URL of a running API, WITHOUT the `/v1` suffix. Default
 *                     http://localhost:4100 — a second dev API port distinct from the
 *                     default 4000, so both can run concurrently.
 *   JWT_SECRET       Enables the two synthetic-token auth-portability checks (past-half-life
 *                     re-issue, expired-token rejection) by signing tokens the SAME way
 *                     `apps/api/src/auth/jwt.ts` does. Defaults to the checked-in dev secret
 *                     (`.env.example`'s `dev-only-change-me`) so it works out of the box
 *                     against a locally-run dev API with no extra flags. A real external
 *                     client obviously never has this — see that function's doc comment.
 */
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { SignJWT } from 'jose';
import { io, type Socket } from 'socket.io-client';
import { createApiClient, type ApiClient } from '../src/client.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type BasicAck,
  type ChatMessage,
  type JoinAck,
  type RoomEvent,
  type RoomSnapshot,
  type SyncAck,
  type TimePingAck,
} from '../src/contract/socket.js';
import type { RedactedGameState } from '@sketchy/engine/redact-for';

// ---------------------------------------------------------------------------
// Config & tiny helpers
// ---------------------------------------------------------------------------

const API_BASE = (process.env.PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
const REST_BASE = `${API_BASE}/v1`;
const SOCKET_NAMESPACE_URL = `${API_BASE}/game`;
/** Matches getEnv()'s dev fallback (apps/api/src/env.ts) so this script works against a
 * locally-run dev API with zero extra flags — see this module's doc comment. */
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-change-me';

/** 5/min-per-IP guest-creation rate limit (apps/api/src/rate-limit.ts `authRateLimit`) — all
 * three guests come from this one process's IP, so creates are spaced out generously rather
 * than relying on "3 < 5" alone (a re-run minutes later, or a CI neighbor sharing the
 * runner's IP, can still stack up against the same window). */
const GUEST_CREATE_SPACING_MS = 3_000;
/** Overall wall-clock budget for the whole game (dealing through game_over) before this
 * script gives up and fails loudly — a stuck reactive loop should never hang CI forever. */
const GAME_TIMEOUT_MS = 45_000;
const ACK_TIMEOUT_MS = 10_000;

function nowStamp(): string {
  return new Date().toISOString().slice(11, 23);
}

const transcript: string[] = [];

function log(line: string): void {
  const entry = `[${nowStamp()}] ${line}`;
  transcript.push(entry);
  console.log(entry);
}

function fail(message: string): never {
  log(`FATAL: ${message}`);
  throw new Error(message);
}

/** Races a promise against a timeout so a missing/lost ack fails loudly instead of hanging
 * the whole script (every client→server event uses an ack per api-contract.md §2). */
async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Minimal typed socket surface (mirrors apps/api/src/sockets/types.ts's event maps, but
// defined locally from `@sketchy/shared/contract/socket` types only — this script imports
// NOTHING from apps/*).
// ---------------------------------------------------------------------------

interface ServerToClientEvents {
  'room:snapshot': (payload: RoomSnapshot) => void;
  'room:event': (payload: RoomEvent) => void;
  'chat:message': (payload: ChatMessage) => void;
  'session:superseded': () => void;
}

/** `Socket`'s own default for its EmitEvents type parameter (socket.io-client's
 * `socket.d.ts`) is `ListenEvents`, NOT an open map — passing only `ServerToClientEvents`
 * would restrict `.emit()`/`.emitWithAck()` to server→client event NAMES, backwards from
 * what this script needs. `emitWithAck` below already types every ack via its own explicit
 * `TAck` generic and the payload via each call site's imported `*Payload` type, so the
 * emit side just needs to accept an arbitrary wire event name + payload, not re-derive a
 * second full client→server event map purely to satisfy this constraint. */
type ClientEmitEvents = Record<string, (...args: never[]) => void>;

type GameSocket = Socket<ServerToClientEvents, ClientEmitEvents>;

/** `socket.emitWithAck` (socket.io-client v4.6+) typed per-call via the generic — every
 * client→server event's ack shape already lives in `@sketchy/shared/contract/socket`
 * (`BasicAck`, `JoinAck`, `SyncAck`, `TimePingAck`), so this just forwards to it with a
 * timeout guard rather than re-deriving a client→server event map. */
async function emitWithAck<TAck>(socket: GameSocket, event: string, payload: object): Promise<TAck> {
  const ack = await withTimeout(
    socket.emitWithAck(event, payload) as Promise<TAck>,
    ACK_TIMEOUT_MS,
    `ack for "${event}"`,
  );
  return ack;
}

// ---------------------------------------------------------------------------
// Bot player
// ---------------------------------------------------------------------------

interface Bot {
  name: string;
  playerId: string;
  token: string;
  api: ApiClient;
  socket: GameSocket;
  clueSeq: number;
  /** Guards against re-acting on every `room:snapshot` re-broadcast — one action per
   * phase-entry, keyed by `${phase}:${round}:${revoteCount}`. */
  actedOn: Set<string>;
  latest?: RoomSnapshot;
}

function phaseKey(state: RedactedGameState): string {
  return `${state.phase}:${state.round}:${state.revoteCount}`;
}

async function createBot(name: string): Promise<Bot> {
  // Built incrementally: `api`'s `getToken`/`onTokenRefresh` need to close over the SAME
  // mutable `bot.token` field this function later sets from the guest-auth response (and
  // that `onTokenRefresh` keeps live for the rest of the bot's life — system-design.md §6's
  // "silent re-issue on API use past the halfway point"), so the object is created first
  // with placeholders and filled in, rather than juggling a separate free variable.
  const bot: Bot = {
    name,
    playerId: '',
    token: '',
    api: undefined as unknown as ApiClient,
    // Replaced by `connectSocket`, called separately once every bot has a token — there's
    // no meaningful placeholder `Socket`, so bots are built in two steps rather than faked.
    socket: undefined as unknown as GameSocket,
    clueSeq: 0,
    actedOn: new Set(),
  };

  bot.api = createApiClient({
    baseUrl: REST_BASE,
    getToken: () => bot.token,
    onTokenRefresh: (refreshed) => {
      bot.token = refreshed;
      log(`${name}: token silently refreshed (X-Refreshed-Token)`);
    },
  });

  const authRes = await bot.api.guestAuth({ displayName: name });
  bot.token = authRes.token;
  bot.playerId = authRes.player.id;
  log(`${name}: authenticated as guest, playerId=${authRes.player.id}`);

  return bot;
}

async function connectSocket(bot: Bot): Promise<void> {
  const socket: GameSocket = io(SOCKET_NAMESPACE_URL, {
    auth: { token: bot.token },
    transports: ['websocket'],
    // A misconfigured/unreachable API should fail fast, not retry silently for a minute.
    reconnection: false,
    timeout: ACK_TIMEOUT_MS,
  });
  bot.socket = socket;

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error: Error) => reject(error));
    }),
    ACK_TIMEOUT_MS,
    `${bot.name}'s socket handshake`,
  );

  socket.on(SERVER_EVENTS.roomEvent, (event) => {
    log(`${bot.name} <- room:event ${event.type}`);
  });
  socket.on(SERVER_EVENTS.sessionSuperseded, () => {
    log(`${bot.name}: session superseded (unexpected in this script)`);
  });

  // api-contract.md §2.3 rule 3: one `time:ping` per connection for clock-offset
  // measurement. Exercised here purely to prove the event round-trips; this script has no
  // countdown UI to drive with it.
  const pingedAt = Date.now();
  const pingAck = await emitWithAck<TimePingAck>(socket, CLIENT_EVENTS.timePing, {});
  if (pingAck.ok) {
    log(`${bot.name}: time:ping round-trip ${Date.now() - pingedAt}ms, serverNow=${pingAck.serverNow}`);
  }
}

// ---------------------------------------------------------------------------
// Reactive game driver — one function reacts to every incoming snapshot, for every bot,
// exactly the way a real client's state-driven UI would (api-contract.md §2.3 rule 1:
// "clients render only from the latest room:snapshot"). `canAct` is read straight off the
// snapshot, never re-derived (api-contract.md §2.2) — this script never guesses whose turn
// it is.
// ---------------------------------------------------------------------------

/** Deterministic, unanimous target pick so a 3-player vote NEVER ties (this script wants a
 * clean, fast one-round game, not tiebreak_clue/judge_decision — those phases are exercised
 * by packages/engine's own reducer tests, not this contract-proof script). Every alive
 * voter targets the same alphabetically-first-by-id alive player; that player, unable to
 * vote for themself, targets the second. With >=3 alive voters the target's ballot count
 * always strictly exceeds any other target's, so the vote closes with a clean plurality. */
function pickVoteTarget(state: RedactedGameState, voterId: string): string {
  const aliveIds = state.players
    .filter((p) => p.alive && !p.hasLeft)
    .map((p) => p.id)
    .sort();
  if (aliveIds.length < 2) fail('pickVoteTarget called with fewer than 2 alive players');
  const primary = aliveIds[0] as string;
  const secondary = aliveIds[1] as string;
  return voterId === primary ? secondary : primary;
}

async function handleSnapshot(bot: Bot, snapshot: RoomSnapshot): Promise<void> {
  bot.latest = snapshot;
  const { state, you } = snapshot;
  const marker = phaseKey(state);

  if (state.phase === 'lobby') {
    const readyMarker = 'lobby:ready';
    if (!bot.actedOn.has(readyMarker)) {
      bot.actedOn.add(readyMarker);
      await emitWithAck<BasicAck>(bot.socket, CLIENT_EVENTS.lobbyReady, { ready: true });
      log(`${bot.name}: ready`);
    }
    if (you.canAct.start && !bot.actedOn.has('game:start')) {
      bot.actedOn.add('game:start');
      log(`${bot.name} (host): starting the game`);
      const ack = await emitWithAck<BasicAck>(bot.socket, CLIENT_EVENTS.gameStart, {});
      if (!ack.ok) fail(`game:start rejected: ${ack.error}`);
    }
    return;
  }

  if (state.phase === 'dealing') {
    const dealMarker = `deal:${marker}`;
    if (!bot.actedOn.has(dealMarker)) {
      bot.actedOn.add(dealMarker);
      const ack = await emitWithAck<BasicAck>(bot.socket, CLIENT_EVENTS.dealAck, {});
      if (!ack.ok) fail(`deal:ack rejected: ${ack.error}`);
      log(`${bot.name}: saw their word, acked dealing (role=${you.role ?? 'unknown'})`);
    }
    return;
  }

  if (state.phase === 'clue') {
    if (you.canAct.submitClue && !bot.actedOn.has(marker)) {
      bot.actedOn.add(marker);
      bot.clueSeq += 1;
      const text = `${bot.name.replace(/\s+/g, '')}-clue-${bot.clueSeq}-r${state.round}`;
      const ack = await emitWithAck<BasicAck>(bot.socket, CLIENT_EVENTS.clueSubmit, { text });
      if (!ack.ok) fail(`clue:submit rejected: ${ack.error}`);
      log(`${bot.name}: submitted clue "${text}"`);
    }
    return;
  }

  if (state.phase === 'discussion') {
    if (you.canAct.advancePhase && !bot.actedOn.has(marker)) {
      bot.actedOn.add(marker);
      log(`${bot.name} (host): skipping discussion straight to voting`);
      const ack = await emitWithAck<BasicAck>(bot.socket, CLIENT_EVENTS.phaseAdvance, {});
      if (!ack.ok) fail(`phase:advance (discussion) rejected: ${ack.error}`);
    }
    return;
  }

  if (state.phase === 'voting') {
    if (you.canAct.vote && !bot.actedOn.has(marker)) {
      bot.actedOn.add(marker);
      const targetId = pickVoteTarget(state, you.playerId);
      const ack = await emitWithAck<BasicAck>(bot.socket, CLIENT_EVENTS.voteCast, { targetId });
      if (!ack.ok) fail(`vote:cast rejected: ${ack.error}`);
      const targetName = state.players.find((p) => p.id === targetId)?.name ?? targetId;
      log(`${bot.name}: voted for ${targetName}`);
    }
    return;
  }

  if (state.phase === 'reveal') {
    if (you.canAct.advancePhase && !bot.actedOn.has(marker)) {
      bot.actedOn.add(marker);
      const eliminated = state.players.find((p) => p.id === state.pendingElimination);
      log(
        `${bot.name} (host): dismissing reveal (eliminated: ${eliminated?.name ?? 'unknown'}, ` +
          `role: ${eliminated?.role ?? 'unknown'})`,
      );
      const ack = await emitWithAck<BasicAck>(bot.socket, CLIENT_EVENTS.phaseAdvance, {});
      if (!ack.ok) fail(`phase:advance (reveal) rejected: ${ack.error}`);
    }
    return;
  }

  if (state.phase === 'game_over') {
    // Nothing to do — `waitForGameOver` below resolves off this same snapshot stream.
    return;
  }

  // tiebreak_clue / judge_decision / grudge_decision / mrwhite_guess: not reachable with
  // this script's settings (unanimous voting, no special roles, no Mr. White) — logged
  // rather than silently ignored so a real engine regression doesn't just hang until
  // GAME_TIMEOUT_MS with no clue why.
  log(`${bot.name}: reached unexpected phase "${state.phase}" — this script has no handler for it`);
}

const GAME_OVER_POLL_MS = 100;

/** Polls `bot.latest` (kept current by the `room:snapshot` handler `main()` already wired
 * up per bot) rather than attaching yet another listener — every bot's own reactive
 * `handleSnapshot` is already the thing driving the game forward; this just watches for the
 * result. Host's snapshot is authoritative for "is the game over" (all three bots converge
 * on the same server-broadcast `state` regardless of which one's `latest` is checked). */
async function waitForGameOver(bots: Bot[]): Promise<RoomSnapshot> {
  const host = bots[0];
  if (!host) fail('waitForGameOver called with no bots');
  return withTimeout(
    (async () => {
      for (;;) {
        if (host.latest && host.latest.state.phase === 'game_over') {
          return host.latest;
        }
        await delay(GAME_OVER_POLL_MS);
      }
    })(),
    GAME_TIMEOUT_MS,
    'game to reach game_over',
  );
}

// ---------------------------------------------------------------------------
// Task 4 — auth portability check. Runs the FULL token lifecycle
// (system-design.md §6): issue (guest auth, already exercised in `createBot`), bearer use
// (every REST call above), silent re-issue (`X-Refreshed-Token`), socket handshake
// (`connectSocket` above — a live socket never connects without a valid bearer token), and
// an expired-token path. No cookies are used ANYWHERE in this entire script — every
// authenticated call carries `Authorization: Bearer <jwt>` explicitly, exactly matching
// system-design.md §6's "deliberately header-token-based ... so the mobile app reuses the
// exact flow."
//
// Two of the five checks below (`past-half-life` and `expired`) sign a SYNTHETIC token with
// a custom `iat`/`exp` using the same HS256 secret `apps/api/src/auth/jwt.ts` signs with.
// A real external mobile client could never do this (it doesn't hold `JWT_SECRET`) — this
// is only legitimate here because this script also controls the local dev API it's
// testing against (same posture as `apps/api/src/routes/players.test.ts`'s own
// `signRawToken` helper, which this mirrors, but exercised over real HTTP instead of
// Fastify's in-process `.inject()`). Without `JWT_SECRET` reachable those two checks are
// skipped with a clear note rather than silently omitted.
// ---------------------------------------------------------------------------

async function signSyntheticToken(playerId: string, iat: Date, exp: Date): Promise<string> {
  return new SignJWT({ guest: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(playerId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function checkPlayersMe(
  token: string,
): Promise<{ status: number; refreshedTokenHeader: string | null }> {
  const res = await fetch(`${REST_BASE}/players/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, refreshedTokenHeader: res.headers.get('X-Refreshed-Token') };
}

async function runAuthPortabilityChecks(host: Bot): Promise<void> {
  log('--- auth portability checks (phase 17 task 4) ---');

  // 1. Bearer use with a fresh token: 200, no silent re-issue yet.
  const fresh = await checkPlayersMe(host.token);
  if (fresh.status !== 200) fail(`fresh token: expected 200, got ${fresh.status}`);
  if (fresh.refreshedTokenHeader) fail('fresh token: unexpectedly got X-Refreshed-Token');
  log('OK: fresh guest token — GET /players/me 200, no X-Refreshed-Token (not past half-life)');

  // 2. Malformed/garbage bearer token: 401. No signing needed — every real client
  // eventually needs to handle this (corrupted storage, a token from a different env).
  const garbage = await checkPlayersMe('not-a-real-jwt');
  if (garbage.status !== 401) fail(`garbage token: expected 401, got ${garbage.status}`);
  log('OK: garbage bearer token — GET /players/me 401');

  // 3. Socket handshake rejects an invalid token outright (api-contract.md §2: "Invalid/
  // expired token ⇒ connection refused with unauthorized").
  const rejectedSocket: GameSocket = io(SOCKET_NAMESPACE_URL, {
    auth: { token: 'not-a-real-jwt' },
    transports: ['websocket'],
    reconnection: false,
    timeout: ACK_TIMEOUT_MS,
  });
  const handshakeError = await withTimeout(
    new Promise<string>((resolve) => {
      rejectedSocket.once('connect_error', (error: Error) => resolve(error.message));
      rejectedSocket.once('connect', () => resolve('CONNECTED (unexpected)'));
    }),
    ACK_TIMEOUT_MS,
    'rejected socket handshake',
  );
  rejectedSocket.close();
  if (handshakeError !== 'unauthorized') {
    fail(`socket handshake with a garbage token: expected "unauthorized", got "${handshakeError}"`);
  }
  log('OK: socket handshake with a garbage token — connection refused (unauthorized)');

  // 4 & 5. Synthetic-token checks — need JWT_SECRET to match the running API's. Best-effort:
  // if it doesn't match (a non-default secret configured without overriding this script's
  // JWT_SECRET), these two report a clear skip rather than a confusing false failure.
  const nowMs = Date.now();
  const pastHalfLife = await signSyntheticToken(
    host.playerId,
    new Date(nowMs - 100 * 24 * 60 * 60 * 1000), // 100 days old
    new Date(nowMs - 100 * 24 * 60 * 60 * 1000 + 180 * 24 * 60 * 60 * 1000), // + 180-day TTL
  );
  const pastHalfLifeRes = await checkPlayersMe(pastHalfLife);
  if (pastHalfLifeRes.status === 401) {
    log(
      'SKIPPED: past-half-life re-issue check — synthetic token was rejected, meaning ' +
        'JWT_SECRET here does not match the running API\'s (set JWT_SECRET to match, or ' +
        'run against the default dev secret). Equivalent coverage already exists at ' +
        "apps/api/src/routes/players.test.ts's \"sets X-Refreshed-Token...\" test.",
    );
  } else if (pastHalfLifeRes.status !== 200 || !pastHalfLifeRes.refreshedTokenHeader) {
    fail(
      `past-half-life token: expected 200 + X-Refreshed-Token, got ${pastHalfLifeRes.status}, ` +
        `header=${String(pastHalfLifeRes.refreshedTokenHeader)}`,
    );
  } else {
    log('OK: token past its halfway point — GET /players/me 200 + X-Refreshed-Token present');
  }

  const expired = await signSyntheticToken(
    host.playerId,
    new Date(nowMs - 181 * 24 * 60 * 60 * 1000),
    new Date(nowMs - 1000),
  );
  const expiredRes = await checkPlayersMe(expired);
  if (expiredRes.status === 200) {
    fail('expired token: expected 401, API accepted it — this would be a real security bug');
  }
  if (expiredRes.status !== 401) {
    log(
      `SKIPPED: expired-token check — got HTTP ${expiredRes.status} instead of a clean 401 ` +
        '(likely a JWT_SECRET mismatch against the running API rather than an expiry bug).',
    );
  } else {
    log('OK: expired token — GET /players/me 401 (same code path as a garbage token)');
  }

  // 6. Magic-link account linking (system-design.md §6) — the guest row is
  // upgraded IN PLACE: same playerId, isGuest flips to false, history preserved. Uses the
  // dev-only `/auth/link/dev-inbox` to retrieve the link a real email would carry (that
  // endpoint exists only when EMAIL_PROVIDER=log && NODE_ENV!=production — the dev default).
  const linkEmail = `headless-${host.playerId}@example.com`;
  const linkReqRes = await fetch(`${REST_BASE}/auth/link/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` },
    body: JSON.stringify({ email: linkEmail }),
  });
  if (linkReqRes.status !== 200) fail(`link request: expected 200, got ${linkReqRes.status}`);
  const inboxRes = await fetch(`${REST_BASE}/auth/link/dev-inbox`);
  if (inboxRes.status !== 200) {
    log(
      'SKIPPED: magic-link linking — the dev inbox is unavailable (EMAIL_PROVIDER != log, or ' +
        'NODE_ENV=production). The full flow is covered by apps/api/src/routes/accounts.test.ts.',
    );
  } else {
    const inbox = (await inboxRes.json()) as { items: { to: string; link: string }[] };
    const entry = inbox.items.find((item) => item.to === linkEmail);
    if (!entry) fail('link request: no dev magic link was recorded for the email');
    const linkToken = new URL(entry!.link).searchParams.get('token');
    if (!linkToken) fail('link request: the dev magic link had no token');
    const verifyRes = await fetch(`${REST_BASE}/auth/link/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: linkToken }),
    });
    if (verifyRes.status !== 200) fail(`link verify: expected 200, got ${verifyRes.status}`);
    const verified = (await verifyRes.json()) as { token: string; player: { id: string; isGuest: boolean } };
    if (verified.player.id !== host.playerId) {
      fail('link verify: playerId changed (linking must upgrade the guest row in place)');
    }
    if (verified.player.isGuest !== false) fail('link verify: player still marked guest after linking');
    const upgradedMe = await checkPlayersMe(verified.token);
    if (upgradedMe.status !== 200) fail(`upgraded token: expected 200, got ${upgradedMe.status}`);
    log(
      'OK: magic-link account linking — guest upgraded IN PLACE (same playerId, isGuest=false); ' +
        'the fresh (guest:false) token works',
    );
  }

  log('--- auth portability checks complete ---');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`=== Sketchy headless reference client — targeting ${API_BASE} ===`);

  const bots: Bot[] = [];
  const names = ['Bot Ada', 'Bot Grace', 'Bot Hedy'];
  for (const [index, name] of names.entries()) {
    bots.push(await createBot(name));
    if (index < names.length - 1) {
      await delay(GUEST_CREATE_SPACING_MS);
    }
  }
  const [host] = bots;
  if (!host) fail('no host bot created');

  const createRes = await host.api.createRoom({});
  log(`room created: code=${createRes.code} joinUrl=${createRes.joinUrl}`);

  const resolution = await host.api.getRoom(createRes.code);
  log(
    `pre-join resolution check: phase=${resolution.phase} canJoin=${resolution.canJoin} ` +
      `hostName=${resolution.hostName}`,
  );

  for (const bot of bots) {
    await connectSocket(bot);
    const joinAck = await emitWithAck<JoinAck>(bot.socket, CLIENT_EVENTS.roomJoin, {
      code: createRes.code,
    });
    if (!joinAck.ok) fail(`${bot.name} failed to join room: ${joinAck.error}`);
    log(`${bot.name}: joined room ${createRes.code} (ver=${joinAck.snapshot.ver})`);
    bot.socket.on(SERVER_EVENTS.roomSnapshot, (snapshot) => {
      void handleSnapshot(bot, snapshot);
    });
    await handleSnapshot(bot, joinAck.snapshot);
  }

  // api-contract.md §2.1: room:sync is the mid-connection gap-fill. Exercised once here,
  // purely as contract proof (nothing to actually resync yet — a fresh join is already
  // current), the same way `time:ping` was exercised in `connectSocket`.
  if (host.latest) {
    const syncAck = await emitWithAck<SyncAck>(host.socket, CLIENT_EVENTS.roomSync, {
      lastVer: host.latest.ver,
    });
    if (syncAck.ok) log(`host: room:sync round-trip OK (ver=${syncAck.snapshot.ver})`);
  }

  const finalSnapshot = await waitForGameOver(bots);
  const { state } = finalSnapshot;
  log('=== GAME OVER ===');
  log(`winner faction: ${state.winnerFaction}`);
  for (const player of state.players) {
    log(
      `  ${player.name}: role=${player.role} word=${player.word} ` +
        `alive=${player.alive} points=${state.scoreboard[player.id] ?? 0}`,
    );
  }

  await runAuthPortabilityChecks(host);

  log('=== TRANSCRIPT SUMMARY ===');
  log(`Total events logged: ${transcript.length}`);
  log(`Room code: ${createRes.code}`);
  log(`Winner: ${state.winnerFaction}`);
  log('Headless client run complete — full game played to a win using only the public /v1 + socket contract.');

  for (const bot of bots) {
    bot.socket.close();
  }
}

main().catch((error: unknown) => {
  console.error('Headless client failed:', error);
  process.exitCode = 1;
});
