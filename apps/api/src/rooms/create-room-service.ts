import { randomUUID } from 'node:crypto';
import { createGame } from '@sketchy/engine/create-game';
import { isValidSettingsForLobby } from '@sketchy/engine/reducers/shared';
import type { AvatarConfig, GamePlayer, GameSettings } from '@sketchy/engine/types';
import type { ErrorCode } from '@sketchy/shared/contract/errors';
import type { RoomVisibility } from '@sketchy/shared/contract/rooms';
import { inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { wordPacks } from '../db/schema.js';
import { allPackIdsAccessible } from '../routes/pack-access.js';
import { resolveAvatar } from './default-avatar.js';
import { listPublicLobby } from './public-lobbies.js';
import { allocateRoomCode } from './room-codes.js';
import { createRoom } from './room-store.js';

/**
 * `POST /v1/rooms` default settings (pinned decision, api-contract.md
 * §1) — the engine has no notion of "default settings" (only `suggestRoleCounts`
 * for the UI), so this object IS the default; the caller's `Partial<GameSettings>`
 * patch merges over it. Moved here (from routes/rooms.ts) so both the
 * REST create path AND the matchmaking matcher seed rooms identically.
 */
export function buildDefaultSettings(officialPackIds: string[]): GameSettings {
  return {
    maxPlayers: 12,
    undercoverCount: 1,
    mrWhiteCount: 0,
    specialRoles: [],
    packIds: officialPackIds,
    difficulties: ['easy', 'medium', 'hard'],
    clueTimerSec: 60,
    discussionTimerSec: 120,
    voteTimerSec: 45,
    mrWhiteFirstClueBan: true,
    eliminationReveal: 'role',
  };
}

/**
 * Public-room policy overlay: timers ON
 * ("untimed is a friends-mode luxury"), spice roles OFF. Applied AFTER the
 * caller's patch so a public host can't opt out of the launch-safe defaults.
 * Voice-off in public rooms is a client/UI default (system-design.md §8) — not
 * a `GameSettings` field, so it isn't enforced here.
 */
function applyPublicRoomPolicy(settings: GameSettings, defaults: GameSettings): GameSettings {
  return {
    ...settings,
    specialRoles: [],
    clueTimerSec: settings.clueTimerSec ?? defaults.clueTimerSec,
    discussionTimerSec: settings.discussionTimerSec ?? defaults.discussionTimerSec,
    voteTimerSec: settings.voteTimerSec ?? defaults.voteTimerSec,
  };
}

export interface RoomHost {
  id: string;
  displayName: string;
  avatar: AvatarConfig;
}

export type CreateRoomResult =
  | { ok: true; code: string; state: ReturnType<typeof createGame>; language: string }
  | { ok: false; error: ErrorCode };

/**
 * The single online-room creation path, shared by `POST /v1/rooms`
 * (routes/rooms.ts) and the quick-join matcher (matchmaking/matcher.ts). Seeds
 * a fresh `lobby`-phase room in Redis with `host` as its only seated player;
 * for `visibility: 'public'` it also stamps `mode: 'online_public'`, applies the
 * public-room policy overlay, and registers the room in the browse index
 * (`rooms/public-lobbies.ts`). Account-gating (`account_required` for guests) is
 * the caller's concern — the matcher only ever creates rooms for already-linked
 * players, so it lives in the REST route, not here.
 */
export async function createOnlineRoom(params: {
  host: RoomHost;
  settingsPatch?: Partial<GameSettings>;
  visibility: RoomVisibility;
}): Promise<CreateRoomResult> {
  const { host, settingsPatch, visibility } = params;
  const db = getDb();

  const officialPacks = await db
    .select({ id: wordPacks.id })
    .from(wordPacks)
    .where(sql`${wordPacks.isOfficial} = true`);
  const defaults = buildDefaultSettings(officialPacks.map((pack) => pack.id));

  let settings: GameSettings = { ...defaults, ...(settingsPatch ?? {}) };
  if (visibility === 'public') {
    settings = applyPublicRoomPolicy(settings, defaults);
  }

  if (!isValidSettingsForLobby(settings, 1)) {
    return { ok: false, error: 'validation' };
  }
  if (!(await allPackIdsAccessible(settings.packIds, host.id))) {
    return { ok: false, error: 'pack_forbidden' };
  }

  const language = await resolveRoomLanguage(settings.packIds);

  const code = await allocateRoomCode();
  if (!code) {
    return { ok: false, error: 'internal' };
  }

  const hostPlayer: GamePlayer = {
    id: host.id,
    name: host.displayName,
    avatar: resolveAvatar(host.id, host.avatar),
    seat: 0,
    connected: true,
    isReady: false,
    hasSeenWord: false,
    alive: true,
    eliminatedRound: null,
    role: null,
    word: null,
    specialRole: null,
    usedSpecialPower: false,
    hasLeft: false,
  };

  const lobbyState = createGame(settings, [hostPlayer], randomUUID(), Date.now());
  const mode = visibility === 'public' ? ('online_public' as const) : ('online_private' as const);
  const state = { ...lobbyState, mode, code };

  const created = await createRoom(code, state);
  if (!created) {
    return { ok: false, error: 'internal' };
  }

  if (visibility === 'public') {
    await listPublicLobby(code, language, Date.now());
  }

  return { ok: true, code, state, language };
}

/**
 * A room's language = the dominant language of its selected packs (matchmaking
 * groups by it). Defaults to `'en'` for the common all-official case. Kept a
 * best-effort single query — a room mixing languages is rare and the mode is a
 * reasonable "primary language" pick.
 */
async function resolveRoomLanguage(packIds: string[]): Promise<string> {
  if (packIds.length === 0) {
    return 'en';
  }
  const rows = await getDb()
    .select({ language: wordPacks.language, n: sql<number>`count(*)::int` })
    .from(wordPacks)
    .where(inArray(wordPacks.id, packIds))
    .groupBy(wordPacks.language)
    .orderBy(sql`count(*) desc`)
    .limit(1);
  return rows[0]?.language ?? 'en';
}
