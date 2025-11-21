import type { z } from 'zod';
import { errorEnvelopeSchema, type ErrorCode } from './contract/errors.js';
import {
  gameRoundSummaryResponseSchema,
  gamesPageSchema,
  guestAuthRequestSchema,
  guestAuthResponseSchema,
  meResponseSchema,
  patchMeRequestSchema,
  statsResponseSchema,
  type GameRoundSummaryResponse,
  type GamesPage,
  type GuestAuthRequest,
  type GuestAuthResponse,
  type MeResponse,
  type PatchMeRequest,
  type StatsResponse,
} from './contract/players.js';
import {
  bulkCreatePairsRequestSchema,
  createPackRequestSchema,
  importPackRequestSchema,
  okResponseSchema,
  packResponseSchema,
  packsResponseSchema,
  pairResponseSchema,
  pairsPageSchema,
  pairsResponseSchema,
  patchPackRequestSchema,
  patchPairRequestSchema,
  publicPacksPageSchema,
  type BulkCreatePairsRequest,
  type CreatePackRequest,
  type ImportPackRequest,
  type OkResponse,
  type PackResponse,
  type PacksResponse,
  type PairResponse,
  type PairsPage,
  type PairsResponse,
  type PatchPackRequest,
  type PatchPairRequest,
  type PublicPacksPage,
} from './contract/packs.js';
import {
  presignRequestSchema,
  presignResponseSchema,
  type PresignRequest,
  type PresignResponse,
} from './contract/uploads.js';
import {
  createRoomRequestSchema,
  createRoomResponseSchema,
  roomResolutionSchema,
  voiceTokenResponseSchema,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type RoomResolution,
  type VoiceTokenResponse,
} from './contract/rooms.js';
import {
  lobbiesPageSchema,
  matchmakingQueueRequestSchema,
  matchmakingQueueResponseSchema,
  type LobbiesPage,
  type MatchmakingQueueRequest,
  type MatchmakingQueueResponse,
} from './contract/matchmaking.js';
import {
  createReportRequestSchema,
  type CreateReportRequest,
} from './contract/reports.js';
import {
  blocksResponseSchema,
  createBlockRequestSchema,
  type BlocksResponse,
  type CreateBlockRequest,
} from './contract/blocks.js';
import {
  googleSignInRequestSchema,
  googleSignInResponseSchema,
  linkRequestResponseSchema,
  linkRequestSchema,
  linkVerifyRequestSchema,
  linkVerifyResponseSchema,
  type GoogleSignInResponse,
  type LinkRequest,
  type LinkRequestResponse,
  type LinkVerifyRequest,
  type LinkVerifyResponse,
} from './contract/accounts.js';

/**
 * Thrown by every `ApiClient` method on a non-2xx response. Carries the
 * parsed `{error:{code,message}}` envelope (api-contract.md §0); falls back
 * to code `'internal'` if the body isn't the expected envelope shape at all
 * (e.g. a proxy/500 page that never reached the API).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ListPacksQuery {
  official?: boolean;
  mine?: boolean;
  language?: string;
}

export interface PackPairsPage {
  cursor?: string;
  limit?: number;
}

export interface BrowsePublicPacksQuery {
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface PlayerGamesPage {
  cursor?: string;
  limit?: number;
}

export interface LobbiesPageQuery {
  cursor?: string;
  limit?: number;
}

export interface CreateApiClientOptions {
  /** Base URL INCLUDING the `/v1` prefix, e.g. `https://api.sketchy.example/v1`. */
  baseUrl: string;
  /** Returns the current bearer token, or `null`/`undefined` when signed out. */
  getToken?: () => string | null | undefined;
  /** Called when a response carries `X-Refreshed-Token` (silent re-issue, api-contract.md §1). */
  onTokenRefresh?: (token: string) => void;
}

export interface ApiClient {
  guestAuth(body: GuestAuthRequest): Promise<GuestAuthResponse>;
  getMe(): Promise<MeResponse>;
  patchMe(body: PatchMeRequest): Promise<MeResponse>;
  /** `GET /v1/players/me/stats` (api-contract.md §1) — lifetime header totals + per-role
   * breakdown. */
  getPlayerStats(): Promise<StatsResponse>;
  /** `GET /v1/players/me/games` (api-contract.md §1) — cursor-paginated game history. */
  getPlayerGames(page?: PlayerGamesPage): Promise<GamesPage>;
  /** `GET /v1/players/me/games/:gameId` — redacted round-by-round summary for one game
   * (additive beyond api-contract.md §1's frozen list shape; see players.ts contract doc
   * comment). Ballots stay aggregate — never a voter→target map (conventions.md §1). */
  getPlayerGameSummary(gameId: string): Promise<GameRoundSummaryResponse>;
  listPacks(query?: ListPacksQuery): Promise<PacksResponse>;
  getPack(id: string): Promise<PackResponse>;
  listPackPairs(id: string, page?: PackPairsPage): Promise<PairsPage>;
  /** `POST /v1/packs` (api-contract.md §1) — creates a new, private, empty pack. */
  createPack(body: CreatePackRequest): Promise<PackResponse>;
  /** `PATCH /v1/packs/:id` (owner only) — setting `visibility:'unlisted'` mints `shareCode`. */
  patchPack(id: string, body: PatchPackRequest): Promise<PackResponse>;
  /** `DELETE /v1/packs/:id` (owner only). */
  deletePack(id: string): Promise<OkResponse>;
  /** `POST /v1/packs/:id/pairs` (owner only, bulk ≤100). */
  createPairs(id: string, body: BulkCreatePairsRequest): Promise<PairsResponse>;
  /** `PATCH /v1/packs/:id/pairs/:pairId` (owner only). */
  patchPair(id: string, pairId: string, body: PatchPairRequest): Promise<PairResponse>;
  /** `DELETE /v1/packs/:id/pairs/:pairId` (owner only). */
  deletePair(id: string, pairId: string): Promise<OkResponse>;
  /** `POST /v1/packs/import` — by share code; grants read-access, does not copy. */
  importPack(body: ImportPackRequest): Promise<PackResponse>;
  /** `GET /v1/packs/public` — browse the public catalog (packs opened to everyone),
   * cursor-paginated with an optional `q` name search. The discovery half of the
   * public-catalog flow; `importPublicPack` is how a browsed pack is added to the set.
   * Excludes packs already in the caller's set (official / owned / imported). */
  browsePublicPacks(query?: BrowsePublicPacksQuery): Promise<PublicPacksPage>;
  /** `POST /v1/packs/:id/import` — add a PUBLIC pack to the caller's set by id (mints a
   * `pack_access` grant, idempotent), so it then shows in `GET /packs` and the room pack
   * picker. Distinct from `importPack` (by share code); refuses a non-public pack (404). */
  importPublicPack(id: string): Promise<PackResponse>;
  /** `POST /v1/uploads/presign` — R2 presigned PUT for pack covers / avatars. */
  presignUpload(body: PresignRequest): Promise<PresignResponse>;
  /** `POST /v1/rooms` (api-contract.md §1) — allocates a code, seeds the room in `lobby`
   * phase with the caller as host. */
  createRoom(body: CreateRoomRequest): Promise<CreateRoomResponse>;
  /** `GET /v1/rooms/:code` (api-contract.md §1) — pre-join check used by the join screen &
   * invite links, before any socket connection is attempted. */
  getRoom(code: string): Promise<RoomResolution>;
  /** `GET /v1/rooms/:code/voice-token` (api-contract.md §1) — caller must be a
   * seated room member; returns a signed, audio-only, short-TTL LiveKit access token. Throws
   * `ApiError` with code `voice_disabled` when the `VOICE_ENABLED` kill-switch is off. */
  getVoiceToken(code: string): Promise<VoiceTokenResponse>;
  /** `GET /v1/lobbies` (api-contract.md §1) — cursor-paginated public rooms
   * currently in their lobby phase, for the room browser. */
  getLobbies(page?: LobbiesPageQuery): Promise<LobbiesPage>;
  /** `POST /v1/matchmaking/queue` (api-contract.md §1) — join the quick-join queue
   * for a language; resolution arrives asynchronously via the socket `mm:matched` push, not
   * this response. Throws `ApiError` `account_required` for a guest (public matchmaking needs
   * a linked account). */
  enqueueMatchmaking(body: MatchmakingQueueRequest): Promise<MatchmakingQueueResponse>;
  /** `DELETE /v1/matchmaking/queue` (api-contract.md §1) — leave the queue.
   * Existence-hiding: `{ ok: true }` whether or not the caller was queued. */
  cancelMatchmaking(): Promise<OkResponse>;
  /** `POST /v1/reports` (api-contract.md §1) — report a player; the server captures
   * the room's recent chat/clue context when `roomCode` is supplied. */
  createReport(body: CreateReportRequest): Promise<OkResponse>;
  /** `GET /v1/blocks` — the caller's block list (drives client-side chat hiding
   * and the matcher's "never matched together" guarantee). */
  listBlocks(): Promise<BlocksResponse>;
  /** `POST /v1/blocks` — block a player. Idempotent. */
  blockPlayer(body: CreateBlockRequest): Promise<OkResponse>;
  /** `DELETE /v1/blocks/:blockedPlayerId` — unblock a player. Existence-hiding. */
  unblockPlayer(blockedPlayerId: string): Promise<OkResponse>;
  /** `POST /v1/auth/link/request` (api-contract.md §1) — request a magic link to
   * upgrade the caller's guest identity to an email account. Enumeration-safe: always
   * `{ ok: true }`. */
  requestEmailLink(body: LinkRequest): Promise<LinkRequestResponse>;
  /** `POST /v1/auth/link/verify` — consume a magic-link token; returns a fresh
   * (now non-guest) JWT + the upgraded player. No session auth needed — the token is the
   * proof of email control. */
  verifyEmailLink(body: LinkVerifyRequest): Promise<LinkVerifyResponse>;
  /** `POST /v1/auth/google` — link the CALLER's guest identity via a Google ID token
   * (an ADDITIONAL method alongside the magic link). Returns the same fresh (now non-guest)
   * JWT + upgraded player. Ships flag-gated: throws `ApiError` `not_found` when the feature
   * is off / unconfigured, `validation` on an unverified/invalid token or a taken email. */
  googleSignIn(idToken: string): Promise<GoogleSignInResponse>;
  /** `DELETE /v1/account` — self-service account deletion (api-contract.md §1
   * "Accounts/auth"). Server soft-anonymizes the caller's row (scrubs email/name/avatar,
   * keeps the id so the moderation audit trail survives) and returns `{ ok: true }`. Only
   * a LINKED account can be deleted — a guest gets 400 `validation`. The still-valid JWT is
   * NOT revoked server-side; the client drops its token to end the session. */
  deleteAccount(): Promise<OkResponse>;
}

type QueryValue = string | number | boolean | undefined;

/**
 * Joins `baseUrl` + `path` the way a human expects (`.../v1` + `auth/guest`
 * → `.../v1/auth/guest`) — the naive `new URL(path, base)` drops the last
 * base path segment unless `base` ends in `/` and `path` has no leading
 * `/`, so both are normalized before resolving.
 */
function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): URL {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\//, '');
  const url = new URL(normalizedPath, normalizedBase);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

/**
 * Typed REST client over `fetch` — works unmodified in the browser and in
 * Node (both expose a spec-compatible global `fetch`), so it's the single
 * client the web app and any future mobile/RN client share (system-design.md
 * §2). Every method: attaches `Authorization: Bearer <token>` when
 * `getToken()` returns one, throws `ApiError` on any non-2xx response, and
 * validates the 2xx body against the matching zod schema — the wire is
 * never trusted, even though the server already validated it.
 */
export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const { baseUrl, getToken, onTokenRefresh } = options;

  async function request<T>(
    method: string,
    path: string,
    responseSchema: z.ZodType<T>,
    init?: { body?: unknown; query?: Record<string, QueryValue> },
  ): Promise<T> {
    const url = buildUrl(baseUrl, path, init?.query);
    const headers: Record<string, string> = {};
    const token = getToken?.();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let bodyText: string | undefined;
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyText = JSON.stringify(init.body);
    }

    const response = await fetch(url, { method, headers, body: bodyText });

    // api-contract.md §1: only GET /players/me ever sends this, but reading
    // it unconditionally here means every route benefits automatically if
    // that ever changes.
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (refreshedToken) {
      onTokenRefresh?.(refreshedToken);
    }

    const json: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const parsedError = errorEnvelopeSchema.safeParse(json);
      if (parsedError.success) {
        throw new ApiError(
          response.status,
          parsedError.data.error.code,
          parsedError.data.error.message,
        );
      }
      throw new ApiError(
        response.status,
        'internal',
        `Request failed with status ${response.status}`,
      );
    }

    return responseSchema.parse(json);
  }

  return {
    guestAuth: (body) =>
      request('POST', '/auth/guest', guestAuthResponseSchema, {
        body: guestAuthRequestSchema.parse(body),
      }),

    getMe: () => request('GET', '/players/me', meResponseSchema),

    patchMe: (body) =>
      request('PATCH', '/players/me', meResponseSchema, {
        body: patchMeRequestSchema.parse(body),
      }),

    getPlayerStats: () => request('GET', '/players/me/stats', statsResponseSchema),

    getPlayerGames: (page) =>
      request('GET', '/players/me/games', gamesPageSchema, {
        query: { cursor: page?.cursor, limit: page?.limit },
      }),

    getPlayerGameSummary: (gameId) =>
      request(
        'GET',
        `/players/me/games/${encodeURIComponent(gameId)}`,
        gameRoundSummaryResponseSchema,
      ),

    listPacks: (query) =>
      request('GET', '/packs', packsResponseSchema, {
        query: { official: query?.official, mine: query?.mine, language: query?.language },
      }),

    getPack: (id) => request('GET', `/packs/${encodeURIComponent(id)}`, packResponseSchema),

    listPackPairs: (id, page) =>
      request('GET', `/packs/${encodeURIComponent(id)}/pairs`, pairsPageSchema, {
        query: { cursor: page?.cursor, limit: page?.limit },
      }),

    createPack: (body) =>
      request('POST', '/packs', packResponseSchema, { body: createPackRequestSchema.parse(body) }),

    patchPack: (id, body) =>
      request('PATCH', `/packs/${encodeURIComponent(id)}`, packResponseSchema, {
        body: patchPackRequestSchema.parse(body),
      }),

    deletePack: (id) =>
      request('DELETE', `/packs/${encodeURIComponent(id)}`, okResponseSchema),

    createPairs: (id, body) =>
      request('POST', `/packs/${encodeURIComponent(id)}/pairs`, pairsResponseSchema, {
        body: bulkCreatePairsRequestSchema.parse(body),
      }),

    patchPair: (id, pairId, body) =>
      request(
        'PATCH',
        `/packs/${encodeURIComponent(id)}/pairs/${encodeURIComponent(pairId)}`,
        pairResponseSchema,
        { body: patchPairRequestSchema.parse(body) },
      ),

    deletePair: (id, pairId) =>
      request(
        'DELETE',
        `/packs/${encodeURIComponent(id)}/pairs/${encodeURIComponent(pairId)}`,
        okResponseSchema,
      ),

    importPack: (body) =>
      request('POST', '/packs/import', packResponseSchema, {
        body: importPackRequestSchema.parse(body),
      }),

    browsePublicPacks: (query) =>
      request('GET', '/packs/public', publicPacksPageSchema, {
        query: { q: query?.q, cursor: query?.cursor, limit: query?.limit },
      }),

    importPublicPack: (id) =>
      request('POST', `/packs/${encodeURIComponent(id)}/import`, packResponseSchema),

    presignUpload: (body) =>
      request('POST', '/uploads/presign', presignResponseSchema, {
        body: presignRequestSchema.parse(body),
      }),

    createRoom: (body) =>
      request('POST', '/rooms', createRoomResponseSchema, {
        body: createRoomRequestSchema.parse(body),
      }),

    getRoom: (code) => request('GET', `/rooms/${encodeURIComponent(code)}`, roomResolutionSchema),

    getVoiceToken: (code) =>
      request('GET', `/rooms/${encodeURIComponent(code)}/voice-token`, voiceTokenResponseSchema),

    getLobbies: (page) =>
      request('GET', '/lobbies', lobbiesPageSchema, {
        query: { cursor: page?.cursor, limit: page?.limit },
      }),

    enqueueMatchmaking: (body) =>
      request('POST', '/matchmaking/queue', matchmakingQueueResponseSchema, {
        body: matchmakingQueueRequestSchema.parse(body),
      }),

    cancelMatchmaking: () => request('DELETE', '/matchmaking/queue', okResponseSchema),

    createReport: (body) =>
      request('POST', '/reports', okResponseSchema, {
        body: createReportRequestSchema.parse(body),
      }),

    listBlocks: () => request('GET', '/blocks', blocksResponseSchema),

    blockPlayer: (body) =>
      request('POST', '/blocks', okResponseSchema, { body: createBlockRequestSchema.parse(body) }),

    unblockPlayer: (blockedPlayerId) =>
      request('DELETE', `/blocks/${encodeURIComponent(blockedPlayerId)}`, okResponseSchema),

    requestEmailLink: (body) =>
      request('POST', '/auth/link/request', linkRequestResponseSchema, {
        body: linkRequestSchema.parse(body),
      }),

    verifyEmailLink: (body) =>
      request('POST', '/auth/link/verify', linkVerifyResponseSchema, {
        body: linkVerifyRequestSchema.parse(body),
      }),

    googleSignIn: (idToken) =>
      request('POST', '/auth/google', googleSignInResponseSchema, {
        body: googleSignInRequestSchema.parse({ idToken }),
      }),

    deleteAccount: () => request('DELETE', '/account', okResponseSchema),
  };
}
