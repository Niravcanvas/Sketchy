import { applyAction } from '@sketchy/engine/apply-action';
import type { GameEffect } from '@sketchy/engine/effects';
import type { GameState, Phase } from '@sketchy/engine/types';
import { getRedis } from '../db/client.js';
import type { GameNamespace } from '../sockets/types.js';
import { persistFinishedGame } from './persist-game.js';
import { applyRoomAction } from './room-store.js';
import { broadcastSnapshots } from './snapshot.js';

/**
 * In-process timer wheel (system-design.md §4.6, arch/game-design.md §8
 * "Clocks"): the server owns every phase deadline. ONE pending JS timer per
 * room — a fresh `armTimer` call for a room replaces whatever was pending for
 * it, mirroring the engine's own invariant that a room has at most one active
 * `phaseEndsAt` at a time. Redis (`GameState.phaseEndsAt`) is the source of
 * truth: this module is deliberately just a scheduling cache over it, rebuilt
 * from scratch on boot (`rearmTimersFromRedis`) — a process restart never
 * loses a deadline, only the in-memory `setTimeout` backing it.
 *
 * Logging note: this module has no per-request `FastifyBaseLogger` to thread
 * through (`armTimer`/`clearTimer` fire from `setTimeout` callbacks, not
 * inside any request/socket handler) — it uses plain `console.*`, the same
 * choice `db/client.ts` makes for its connection-level error handlers, for
 * the same reason (process-level singleton, no request context).
 */

interface ArmedTimer {
  code: string;
  phase: Phase;
  timeout: NodeJS.Timeout;
}

const armed = new Map<string, ArmedTimer>();

/**
 * Arms (or re-arms, replacing any existing timer for `code`) a single-shot
 * timeout: at `endsAt`, dispatch `applyRoomAction(code, {type:'timeout',
 * phase, at})`. `phase` is the phase THIS deadline belongs to — always the
 * phase of the state the triggering `startTimer` effect came from, so a
 * later stale fire is detected by the engine's own `action.phase !==
 * state.phase` check (apply-action.ts `applyTimeout`) rather than by this
 * module trying to track staleness itself.
 */
export function armTimer(namespace: GameNamespace, code: string, phase: Phase, endsAt: number): void {
  clearTimer(code);
  const delayMs = Math.max(0, endsAt - Date.now());
  const timeout = setTimeout(() => {
    void fireTimer(namespace, code, phase);
  }, delayMs);
  armed.set(code, { code, phase, timeout });
}

/** Cancels `code`'s pending timer, if any (no-op otherwise). */
export function clearTimer(code: string): void {
  const existing = armed.get(code);
  if (existing) {
    clearTimeout(existing.timeout);
    armed.delete(code);
  }
}

/** Cancels every pending timer in this process — called from fastify's
 * `onClose` hook so a shutdown never leaves a dangling `setTimeout`. */
export function clearAllTimers(): void {
  for (const entry of armed.values()) {
    clearTimeout(entry.timeout);
  }
  armed.clear();
}

/** Test-only introspection hook: is a timer currently armed for `code`?
 * (There is no other way to observe this module's private scheduling state
 * from outside — the alternative, waiting out a real timer in a test, is
 * exactly what this hook exists to avoid.) */
export function isTimerArmed(code: string): boolean {
  return armed.has(code);
}

/**
 * Routes the `GameEffect[]` returned alongside an accepted action: `startTimer`
 * arms the next deadline, `clearTimer` cancels one, `persistGame` (game_over)
 * fires the transactional final-game write. `revealRole` stays a
 * no-op — the reveal sequence is driven entirely by the snapshot (the reveal
 * screen reads `pendingElimination`, whose role `redactFor` already unhides
 * once the player is dead), so the server needs no extra action for it.
 *
 * `persistGame` is fire-and-forget: clients already have the `game_over`
 * snapshot (broadcast before this runs), so the DB write must not block the
 * ack or the timer fire. A failure is logged, never thrown — the row stays
 * uncompleted (reapable) rather than crashing the process.
 */
export function routeEffects(
  namespace: GameNamespace,
  code: string,
  state: GameState,
  effects: GameEffect[],
): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'startTimer':
        armTimer(namespace, code, state.phase, effect.endsAt);
        break;
      case 'clearTimer':
        clearTimer(code);
        break;
      case 'persistGame':
        void persistFinishedGame(code, state).catch((error) => {
          console.error(`timer-wheel: persistFinishedGame failed for room ${code}`, error);
        });
        break;
      case 'revealRole':
        // Snapshot-driven — no server action (see doc comment above).
        break;
    }
  }
}

async function fireTimer(namespace: GameNamespace, code: string, phase: Phase): Promise<void> {
  armed.delete(code); // consumed — a fresh arm from the result (if any) sets a new entry.
  try {
    const result = await applyRoomAction(code, (state) =>
      applyAction(state, { type: 'timeout', phase, at: Date.now() }),
    );
    if (!result.ok) {
      if (result.error === 'wrong_phase') {
        // Expected race (game-design.md §8 "Clocks"): the phase already
        // moved on (host advanced it, or another timer beat this one).
        console.debug(`timer-wheel: stale timer for room ${code} (phase ${phase}) — harmless`);
        return;
      }
      console.error(`timer-wheel: timeout action rejected for room ${code}`, result.error);
      return;
    }
    broadcastSnapshots(namespace, code, result.state, result.ver);
    routeEffects(namespace, code, result.state, result.effects);
  } catch (error) {
    console.error(`timer-wheel: firing timer for room ${code} failed`, error);
  }
}

const ROOM_STATE_KEY_PATTERN = /^room:([^:]+):state$/;

/**
 * Boot-time catch-up (system-design.md §4.6: "Redis as the source of truth
 * on restart"). Cursor-scans `room:*:state` (bounded `COUNT`, never `KEYS`)
 * and re-arms every room whose persisted state has an active deadline
 * (`phaseEndsAt !== null`) in a phase that actually schedules one (`lobby`
 * and `game_over` never do — a stray non-null value there would be a bug
 * elsewhere, not something to arm a timer for). A deadline already in the
 * past fires ~immediately once armed, which is exactly the desired
 * catch-up behavior (auto-ack/auto-skip/auto-advance, same as if the
 * process had never restarted). Returns the count armed, for the caller to log.
 */
export async function rearmTimersFromRedis(namespace: GameNamespace): Promise<number> {
  const redis = getRedis();
  let cursor = '0';
  let count = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'room:*:state', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const match = ROOM_STATE_KEY_PATTERN.exec(key);
      if (!match) {
        continue;
      }
      const code = match[1] as string;
      const raw = await redis.get(key);
      if (!raw) {
        continue;
      }
      const state = JSON.parse(raw) as GameState;
      if (state.phaseEndsAt !== null && state.phase !== 'lobby' && state.phase !== 'game_over') {
        armTimer(namespace, code, state.phase, state.phaseEndsAt);
        count += 1;
      }
    }
  } while (cursor !== '0');
  return count;
}
