import { getRedis } from '../db/client.js';
import { ROOM_TTL_SECONDS, voiceKey } from './room-store.js';

/**
 * `room:{code}:voice` (data-model.md §2) — a Redis hash of
 * playerId → `'1' | '0'` (mute state), the durable side of the `voice:state`
 * → `voice:roster` mirror (`sockets/voice.ts`). Deliberately its own tiny
 * key rather than a field on `room:{code}:state`: voice presence is
 * cosmetic to the engine and must never enter `GameState`
 * (system-design.md §8), and this hash is written OUTSIDE the CAS
 * transaction `rooms/room-store.ts#applyRoomAction` uses for engine state —
 * same pattern as `usedPairsKey`/`gameIdKey` in that file, which are also
 * room-scoped keys that live beside the engine state rather than inside it.
 * (`voiceKey` itself is defined in `room-store.ts`, alongside every other
 * room-scoped key builder, and re-exported here for callers of this module.)
 */
export { voiceKey };

/** Every player's current mute state for `code`, keyed by playerId. Only ever contains
 * entries for players who have sent at least one `voice:state` this room-session — a player
 * who has never touched voice simply has no entry (the player-strip UI treats "no entry" as
 * "not connected to voice", not as "unmuted"). */
export async function getVoiceRoster(code: string): Promise<Record<string, boolean>> {
  const raw = await getRedis().hgetall(voiceKey(code));
  const out: Record<string, boolean> = {};
  for (const [playerId, value] of Object.entries(raw)) {
    out[playerId] = value === '1';
  }
  return out;
}

/** Records one player's mute state and refreshes the key's TTL alongside the rest of the
 * room's keys (mirrors `setConnEntry`'s `expire` pairing in `room-store.ts`). */
export async function setVoiceMute(code: string, playerId: string, muted: boolean): Promise<void> {
  const redis = getRedis();
  await redis
    .multi()
    .hset(voiceKey(code), playerId, muted ? '1' : '0')
    .expire(voiceKey(code), ROOM_TTL_SECONDS)
    .exec();
}

/** Drops one player's roster entry (leave/kick) so a departed player never lingers as
 * "muted"/"unmuted" in a strip they're no longer seated in. */
export async function deleteVoiceEntry(code: string, playerId: string): Promise<void> {
  await getRedis().hdel(voiceKey(code), playerId);
}
