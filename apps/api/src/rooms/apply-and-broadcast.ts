import { applyAction } from '@sketchy/engine/apply-action';
import type { GameAction } from '@sketchy/engine/actions';
import type { GameNamespace } from '../sockets/types.js';
import type { ApplyRoomActionResult } from './room-store.js';
import { applyRoomAction } from './room-store.js';
import { broadcastSnapshots } from './snapshot.js';
import { routeEffects } from './timer-wheel.js';

/**
 * The shared apply → broadcast → effects-routing pipeline every game-play
 * socket handler in `sockets/play.ts` uses (rooms/timer-wheel.ts pinned
 * decision): CAS-apply the action, and on acceptance broadcast the fresh
 * snapshot to the room THEN route `result.effects` to the timer wheel
 * (`startTimer`/`clearTimer`) exactly once. On rejection, this is a pure
 * no-op beyond the CAS attempt itself — the caller acks the error and
 * nothing was broadcast or scheduled.
 *
 * The lobby/presence handlers do NOT use this helper: none of their
 * actions ever produce an effect (`join`/`leave`/`setReady`/`updateSettings`/
 * `kick`/`presence` all reach `lobby`-phase reducers, which never call
 * `timerEffects` — lobby has no timed phase), so routing effects there would
 * always be a no-op loop over `[]`. Refactoring them onto this helper purely
 * for symmetry was judged not worth the added indirection.
 */
export async function applyBroadcastAndSchedule(
  namespace: GameNamespace,
  code: string,
  action: GameAction,
): Promise<ApplyRoomActionResult> {
  const result = await applyRoomAction(code, (state) => applyAction(state, action));
  if (!result.ok) {
    return result;
  }

  broadcastSnapshots(namespace, code, result.state, result.ver);
  routeEffects(namespace, code, result.state, result.effects);
  return result;
}
