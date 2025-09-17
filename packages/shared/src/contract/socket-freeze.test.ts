import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  SERVER_EVENTS,
  chatSendPayloadSchema,
  clueSubmitPayloadSchema,
  dealAckPayloadSchema,
  gameRematchPayloadSchema,
  gameStartPayloadSchema,
  hostTransferPayloadSchema,
  lobbyKickPayloadSchema,
  lobbyReadyPayloadSchema,
  lobbySettingsPayloadSchema,
  mmMatchedSchema,
  mrWhiteGuessPayloadSchema,
  phaseAdvancePayloadSchema,
  roomJoinPayloadSchema,
  roomLeavePayloadSchema,
  roomSyncPayloadSchema,
  specialGrudgePayloadSchema,
  specialJudgePayloadSchema,
  timePingPayloadSchema,
  timerExtendPayloadSchema,
  turnSkipPayloadSchema,
  voiceStatePayloadSchema,
  voteCastPayloadSchema,
} from './socket.js';

/**
 * `/v1` contract freeze enforcement (api-contract.md §0 versioning policy: "`/v1`
 * freezes at phase 17. Additive-only after that (new optional fields, new endpoints, new
 * socket events)."). This is a type-level test that packages/shared socket payload
 * schemas only ever gain OPTIONAL fields, implemented
 * as a RUNTIME schema-shape test rather than a tsd/expect-type compile test
 * because a runtime check against zod's own `.shape` introspection
 * is exercised by plain `pnpm test` — no separate typecheck-mode invocation, no dependency
 * on a type-testing library's exact API surface, and a failure names the offending event
 * directly in the `it.each` output.
 *
 * `FROZEN_REQUIRED` below is a hand-copied snapshot of every CLIENT→SERVER payload
 * schema's REQUIRED key set as it stood the day `/v1` froze — deliberately NOT derived
 * from the schemas themselves (a schema asserting agreement with its own current shape
 * catches nothing). The only two changes a future PR should make here:
 *   - Add a NEW entry when a genuinely new socket event ships (mirrors adding a new row
 *     to api-contract.md §2.1 — api-contract.md §4's contract-change checklist already
 *     requires that doc update in the same PR).
 *   - Widening an EXISTING entry (adding a key) is exactly the breaking change this file
 *     exists to catch — don't "fix the test," fix the schema (or take the `/v2` path,
 *     api-contract.md §0).
 * A schema gaining a brand-new OPTIONAL field needs NO change here at all: `requiredKeysOf`
 * only reports required keys, so a new `.optional()` field is invisible to this file by
 * construction — which is exactly what "additive-only" is supposed to mean.
 */

/** Every key `schema.shape` reports as REQUIRED — zod's own `.isOptional()` per field,
 * sorted for a stable, readable diff on failure. */
function requiredKeysOf(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.entries(schema.shape)
    .filter(([, fieldSchema]) => !(fieldSchema as z.ZodTypeAny).isOptional())
    .map(([key]) => key)
    .sort();
}

/**
 * A finite literal union (NOT `Record<string, ...>`) so indexing either map below with an
 * `EventName` resolves to a real value under `noUncheckedIndexedAccess` — `Record<string,
 * T>` desugars to an index SIGNATURE (`{[key: string]: T}`), which that tsconfig option
 * correctly widens every lookup to `T | undefined`; a `Record` over a finite literal union
 * has no such signature, so TS already knows every listed key is present.
 */
type EventName =
  | 'roomJoin'
  | 'roomLeave'
  | 'roomSync'
  | 'lobbyReady'
  | 'lobbyKick'
  | 'gameStart'
  | 'dealAck'
  | 'clueSubmit'
  | 'phaseAdvance'
  | 'turnSkip'
  | 'voteCast'
  | 'mrWhiteGuess'
  | 'gameRematch'
  | 'chatSend'
  | 'timePing'
  | 'timerExtend'
  | 'hostTransfer'
  | 'specialJudge'
  | 'specialGrudge'
  | 'voiceState';

const SCHEMAS: Record<EventName, z.ZodObject<z.ZodRawShape>> = {
  roomJoin: roomJoinPayloadSchema,
  roomLeave: roomLeavePayloadSchema,
  roomSync: roomSyncPayloadSchema,
  lobbyReady: lobbyReadyPayloadSchema,
  lobbyKick: lobbyKickPayloadSchema,
  gameStart: gameStartPayloadSchema,
  dealAck: dealAckPayloadSchema,
  clueSubmit: clueSubmitPayloadSchema,
  phaseAdvance: phaseAdvancePayloadSchema,
  turnSkip: turnSkipPayloadSchema,
  voteCast: voteCastPayloadSchema,
  mrWhiteGuess: mrWhiteGuessPayloadSchema,
  gameRematch: gameRematchPayloadSchema,
  chatSend: chatSendPayloadSchema,
  timePing: timePingPayloadSchema,
  timerExtend: timerExtendPayloadSchema,
  hostTransfer: hostTransferPayloadSchema,
  specialJudge: specialJudgePayloadSchema,
  specialGrudge: specialGrudgePayloadSchema,
  voiceState: voiceStatePayloadSchema,
};

/** Frozen per the `/v1` versioning policy (api-contract.md §2.1). Every event below was live at freeze time. */
const FROZEN_REQUIRED: Record<EventName, string[]> = {
  roomJoin: ['code'],
  roomLeave: [],
  roomSync: ['lastVer'],
  lobbyReady: ['ready'],
  lobbyKick: ['playerId'],
  gameStart: [],
  dealAck: [],
  clueSubmit: ['text'],
  phaseAdvance: [],
  turnSkip: [],
  voteCast: ['targetId'],
  mrWhiteGuess: ['word'],
  gameRematch: [],
  chatSend: ['text'],
  timePing: [],
  timerExtend: [],
  hostTransfer: ['targetId'],
  specialJudge: ['targetId'],
  specialGrudge: ['targetId'],
  // voice:state was already live when /v1 froze, so it's part of the frozen set (api-contract.md §2.1).
  voiceState: ['muted'],
};

describe('phase 17 contract freeze: client→server payload shapes are additive-only', () => {
  it.each(Object.keys(FROZEN_REQUIRED) as (keyof typeof SCHEMAS)[])(
    '%s still requires exactly its phase-17-frozen field set',
    (eventName) => {
      const schema = SCHEMAS[eventName];
      expect(requiredKeysOf(schema)).toEqual(FROZEN_REQUIRED[eventName]);
    },
  );

  it('every wire event in api-contract.md §2.1 has a frozen entry above (nothing silently skipped)', () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(Object.keys(FROZEN_REQUIRED).sort());
  });

  // `lobby:settings` reuses `gameSettingsPatchSchema` verbatim (rooms.ts) rather than its
  // own event-specific shape — that schema already carries an equivalent freeze
  // guarantee via its `satisfies z.ZodType<Partial<GameSettings>>` compile-time proof PLUS
  // rooms.test.ts's "round-trips a fully populated patch (all eleven GameSettings fields)"
  // runtime check, so it's verified there rather than duplicated in `FROZEN_REQUIRED`
  // above — every field of a `Partial<...>` is optional by construction, so "additive-only"
  // is structurally guaranteed for it regardless.
  it('lobbySettings (GameSettingsPatch) has no required fields, by construction', () => {
    expect(requiredKeysOf(lobbySettingsPayloadSchema)).toEqual([]);
  });
});

/**
 * `mm:matched` (matchmaking queue resolution) is a
 * SERVER→CLIENT event, so it deliberately does NOT appear in `FROZEN_REQUIRED`
 * above — that snapshot freezes CLIENT→SERVER required-key sets, and matchmaking
 * adds NO client→server event at all (enqueue/cancel are REST). Recorded here as
 * additive, since the client→server freeze is untouched by
 * it, which is exactly what "additive-only" means for it.
 */
describe('phase 16 additive: mm:matched (server→client)', () => {
  it('mm:matched is a live server→client event carrying a room code, with no client→server freeze impact', () => {
    expect(SERVER_EVENTS.matched).toBe('mm:matched');
    expect(requiredKeysOf(mmMatchedSchema)).toEqual(['code']);
  });
});
