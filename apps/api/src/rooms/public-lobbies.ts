import type { LobbyItem } from '@sketchy/shared/contract/matchmaking';
import type { GameState } from '@sketchy/engine/types';
import { getRedis } from '../db/client.js';
import { loadRoom } from './room-store.js';

/**
 * The public-lobby index (backs `GET /lobbies`,
 * and the matcher's "fill existing public lobbies first" target). A room is a
 * browsable public lobby iff `mode === 'online_public'` AND `phase === 'lobby'`
 * (join-in-lobby only — "no mid-game drop-ins"). Rather than SCAN every
 * `room:*:state` on each browse (expensive, and can't order/paginate), public
 * rooms register here on creation and de-register when they start a game or are
 * reaped. `GET /lobbies` reads THIS index, then hydrates live state per code —
 * lazily delisting any entry whose room has since vanished or left lobby, so
 * the index self-heals without a sweeper.
 *
 * - `lobbies:index` — zset, member = room code, score = createdAt (ms) → stable
 *   newest-first, cursor-paginable ordering.
 * - `lobbies:lang` — hash, code → language (the one datum not derivable from
 *   `GameState`, which has no room-language field; the engine is out of scope).
 */
const INDEX_KEY = 'lobbies:index';
const LANG_KEY = 'lobbies:lang';

/** How many raw index entries a single `listPublicLobbies` call will scan while
 * skipping/self-healing stale rows before giving up — a safety bound so a large
 * backlog of dead entries can't make one browse request unbounded. */
const MAX_SCAN = 200;

/** True iff `state` is a browsable/joinable public lobby right now. */
export function isPublicLobby(state: Pick<GameState, 'mode' | 'phase'>): boolean {
  return state.mode === 'online_public' && state.phase === 'lobby';
}

/** Registers (or refreshes) a public room in the browse index. */
export async function listPublicLobby(
  code: string,
  language: string,
  createdAt: number,
): Promise<void> {
  await getRedis().multi().zadd(INDEX_KEY, createdAt, code).hset(LANG_KEY, code, language).exec();
}

/** Removes a room from the browse index (game started, room reaped, or the last
 * player left the lobby). Idempotent. */
export async function delistPublicLobby(code: string): Promise<void> {
  await getRedis().multi().zrem(INDEX_KEY, code).hdel(LANG_KEY, code).exec();
}

/** The language a public room was registered under (default `'en'` if somehow
 * missing) — used by the matcher to group queued players by language. */
export async function publicLobbyLanguage(code: string): Promise<string> {
  return (await getRedis().hget(LANG_KEY, code)) ?? 'en';
}

/** All currently-indexed public-lobby codes, newest first (raw — may include
 * stale entries the matcher then validates/skips). */
export async function allPublicLobbyCodes(): Promise<string[]> {
  return getRedis().zrevrange(INDEX_KEY, 0, -1);
}

function encodeCursor(score: number): string {
  return Buffer.from(String(score)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number | undefined {
  if (!cursor) {
    return undefined;
  }
  const parsed = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface PublicLobbiesPage {
  items: LobbyItem[];
  nextCursor: string | null;
}

/**
 * One page of public lobbies, newest-first, cursor-paginated (api-contract.md
 * §0). Walks the `lobbies:index` zset from just-below `cursor` (exclusive by
 * score), hydrating each room's live state; a room that has since left the
 * lobby or disappeared is delisted in-line and skipped. `nextCursor` is the
 * score of the last RAW entry consumed (so paging advances even when a whole
 * batch was stale), or `null` once the index is exhausted.
 *
 * Note: cursoring is by createdAt score with an exclusive upper bound, so two
 * rooms created in the same millisecond could, very rarely, straddle a page
 * boundary awkwardly — accepted at launch scale (room creation is 5/min/player
 * rate-limited; the browser is a best-effort discovery surface, not a ledger).
 */
export async function listPublicLobbies(
  cursor: string | undefined,
  limit: number,
): Promise<PublicLobbiesPage> {
  const redis = getRedis();
  const items: LobbyItem[] = [];
  let max: string = cursor !== undefined ? `(${decodeCursor(cursor) ?? 0}` : '+inf';
  let scanned = 0;
  let lastScore: number | null = null;

  while (items.length < limit && scanned < MAX_SCAN) {
    const batch = await redis.zrevrangebyscore(
      INDEX_KEY,
      max,
      '-inf',
      'WITHSCORES',
      'LIMIT',
      0,
      limit,
    );
    if (batch.length === 0) {
      lastScore = null; // exhausted
      break;
    }
    // `batch` is [member, score, member, score, ...].
    for (let i = 0; i < batch.length; i += 2) {
      const code = batch[i];
      const score = Number.parseInt(batch[i + 1] ?? '', 10);
      if (code === undefined) {
        continue;
      }
      scanned += 1;
      lastScore = Number.isFinite(score) ? score : lastScore;
      const room = await loadRoom(code);
      if (!room || !isPublicLobby(room.state)) {
        await delistPublicLobby(code);
        continue;
      }
      const host = room.state.players.find((p) => p.id === room.state.hostId);
      items.push({
        code,
        hostName: host?.name ?? '',
        playerCount: room.state.players.length,
        maxPlayers: room.state.settings.maxPlayers,
        language: await publicLobbyLanguage(code),
      });
      if (items.length >= limit) {
        break;
      }
    }
    // Advance the exclusive upper bound to just below the lowest score seen in
    // this batch, so the next iteration continues past it.
    const lowest = Number.parseInt(batch[batch.length - 1] ?? '', 10);
    if (!Number.isFinite(lowest)) {
      break;
    }
    max = `(${lowest}`;
  }

  return {
    items,
    nextCursor: items.length >= limit && lastScore !== null ? encodeCursor(lastScore) : null,
  };
}
