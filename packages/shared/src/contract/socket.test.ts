import { describe, expect, it } from 'vitest';
import type { RedactedGameState } from '@sketchy/engine/redact-for';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  chatMessageSchema,
  chatSendPayloadSchema,
  clueSubmitPayloadSchema,
  dealAckPayloadSchema,
  gameRematchPayloadSchema,
  gameStartPayloadSchema,
  lobbyKickPayloadSchema,
  lobbyReadyPayloadSchema,
  lobbySettingsPayloadSchema,
  mrWhiteGuessPayloadSchema,
  phaseAdvancePayloadSchema,
  roomEventSchema,
  roomJoinPayloadSchema,
  roomLeavePayloadSchema,
  roomSnapshotSchema,
  roomSyncPayloadSchema,
  specialGrudgePayloadSchema,
  specialJudgePayloadSchema,
  timePingPayloadSchema,
  turnSkipPayloadSchema,
  voiceRosterSchema,
  voiceStatePayloadSchema,
  voteCastPayloadSchema,
  youSliceSchema,
} from './socket.js';
import type { BasicAck, JoinAck, RoomSnapshot, YouSlice } from './socket.js';

const VALID_CODE = 'AB2CD';
const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('CLIENT_EVENTS', () => {
  it('matches the wire strings in api-contract.md §2.1 exactly', () => {
    expect(CLIENT_EVENTS).toEqual({
      roomJoin: 'room:join',
      roomLeave: 'room:leave',
      roomSync: 'room:sync',
      lobbyReady: 'lobby:ready',
      lobbySettings: 'lobby:settings',
      lobbyKick: 'lobby:kick',
      gameStart: 'game:start',
      dealAck: 'deal:ack',
      clueSubmit: 'clue:submit',
      phaseAdvance: 'phase:advance',
      turnSkip: 'turn:skip',
      voteCast: 'vote:cast',
      mrWhiteGuess: 'mrwhite:guess',
      gameRematch: 'game:rematch',
      chatSend: 'chat:send',
      timePing: 'time:ping',
      timerExtend: 'timer:extend',
      hostTransfer: 'host:transfer',
      specialJudge: 'special:judge',
      specialGrudge: 'special:grudge',
      voiceState: 'voice:state',
    });
  });

  it('has no client→server mm:* events (phase 16: quick-join enqueue/cancel are REST; the only mm:* socket traffic is the server→client mm:matched push)', () => {
    const values = Object.values(CLIENT_EVENTS);
    // `mm:matched` is a SERVER→client event (SERVER_EVENTS.matched), never a
    // client→server one, so it must never appear here; there is no client mm:* event at all.
    for (const notClient of ['mm:matched', 'mm:queue', 'mm:cancel']) {
      expect(values).not.toContain(notClient);
    }
    expect(values).toContain('special:grudge');
    expect(values).toContain('voice:state');
  });
});

describe('SERVER_EVENTS', () => {
  it('matches the wire strings in api-contract.md §2.2 exactly (mm:matched is live as of phase 16)', () => {
    expect(SERVER_EVENTS).toEqual({
      roomSnapshot: 'room:snapshot',
      roomEvent: 'room:event',
      chatMessage: 'chat:message',
      sessionSuperseded: 'session:superseded',
      voiceRoster: 'voice:roster',
      matched: 'mm:matched',
    });
  });
});

describe('roomJoinPayloadSchema', () => {
  it('accepts a well-formed code', () => {
    expect(roomJoinPayloadSchema.parse({ code: VALID_CODE })).toEqual({ code: VALID_CODE });
  });

  it('rejects a malformed code', () => {
    expect(() => roomJoinPayloadSchema.parse({ code: 'bad0O' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => roomJoinPayloadSchema.parse({ code: VALID_CODE, extra: 1 })).toThrow();
  });
});

describe('empty-payload events', () => {
  const schemas = {
    roomLeave: roomLeavePayloadSchema,
    gameStart: gameStartPayloadSchema,
    dealAck: dealAckPayloadSchema,
    phaseAdvance: phaseAdvancePayloadSchema,
    turnSkip: turnSkipPayloadSchema,
    gameRematch: gameRematchPayloadSchema,
    timePing: timePingPayloadSchema,
  };

  it.each(Object.entries(schemas))('%s accepts {}', (_name, schema) => {
    expect(schema.parse({})).toEqual({});
  });

  it.each(Object.entries(schemas))('%s rejects an unknown key', (_name, schema) => {
    expect(() => schema.parse({ extra: 1 })).toThrow();
  });
});

describe('roomSyncPayloadSchema', () => {
  it('accepts lastVer 0', () => {
    expect(roomSyncPayloadSchema.parse({ lastVer: 0 })).toEqual({ lastVer: 0 });
  });

  it('rejects a negative lastVer', () => {
    expect(() => roomSyncPayloadSchema.parse({ lastVer: -1 })).toThrow();
  });

  it('rejects a float lastVer', () => {
    expect(() => roomSyncPayloadSchema.parse({ lastVer: 1.5 })).toThrow();
  });

  it('rejects a missing lastVer', () => {
    expect(() => roomSyncPayloadSchema.parse({})).toThrow();
  });
});

describe('lobbyReadyPayloadSchema', () => {
  it('accepts ready: true and ready: false', () => {
    expect(lobbyReadyPayloadSchema.parse({ ready: true })).toEqual({ ready: true });
    expect(lobbyReadyPayloadSchema.parse({ ready: false })).toEqual({ ready: false });
  });

  it('rejects a non-boolean ready', () => {
    expect(() => lobbyReadyPayloadSchema.parse({ ready: 'yes' })).toThrow();
  });
});

describe('lobbySettingsPayloadSchema', () => {
  it('is the same schema gameSettingsPatchSchema exports (rooms.ts reuse)', () => {
    expect(lobbySettingsPayloadSchema.parse({ maxPlayers: 8 })).toEqual({ maxPlayers: 8 });
  });

  it('rejects unknown keys', () => {
    expect(() => lobbySettingsPayloadSchema.parse({ notAField: true })).toThrow();
  });
});

describe('lobbyKickPayloadSchema', () => {
  it('accepts a valid uuid playerId', () => {
    expect(lobbyKickPayloadSchema.parse({ playerId: VALID_UUID })).toEqual({
      playerId: VALID_UUID,
    });
  });

  it('rejects a non-uuid playerId', () => {
    expect(() => lobbyKickPayloadSchema.parse({ playerId: 'not-a-uuid' })).toThrow();
  });
});

describe('clueSubmitPayloadSchema', () => {
  it('trims text before validating length', () => {
    expect(clueSubmitPayloadSchema.parse({ text: '  hi  ' })).toEqual({ text: 'hi' });
  });

  it('accepts exactly 40 chars', () => {
    const text = 'x'.repeat(40);
    expect(clueSubmitPayloadSchema.parse({ text })).toEqual({ text });
  });

  it('rejects 41 chars', () => {
    expect(() => clueSubmitPayloadSchema.parse({ text: 'x'.repeat(41) })).toThrow();
  });

  it('rejects an empty (or whitespace-only) clue', () => {
    expect(() => clueSubmitPayloadSchema.parse({ text: '   ' })).toThrow();
  });
});

describe('voteCastPayloadSchema', () => {
  it('accepts a valid uuid targetId', () => {
    expect(voteCastPayloadSchema.parse({ targetId: VALID_UUID })).toEqual({
      targetId: VALID_UUID,
    });
  });

  it('rejects a non-uuid targetId', () => {
    expect(() => voteCastPayloadSchema.parse({ targetId: '42' })).toThrow();
  });
});

describe('specialJudgePayloadSchema', () => {
  it('accepts a valid uuid targetId', () => {
    expect(specialJudgePayloadSchema.parse({ targetId: VALID_UUID })).toEqual({
      targetId: VALID_UUID,
    });
  });

  it('rejects a non-uuid targetId', () => {
    expect(() => specialJudgePayloadSchema.parse({ targetId: '42' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() =>
      specialJudgePayloadSchema.parse({ targetId: VALID_UUID, extra: 1 }),
    ).toThrow();
  });
});

describe('specialGrudgePayloadSchema', () => {
  it('accepts a valid uuid targetId', () => {
    expect(specialGrudgePayloadSchema.parse({ targetId: VALID_UUID })).toEqual({
      targetId: VALID_UUID,
    });
  });

  it('rejects a non-uuid targetId', () => {
    expect(() => specialGrudgePayloadSchema.parse({ targetId: '42' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() =>
      specialGrudgePayloadSchema.parse({ targetId: VALID_UUID, extra: 1 }),
    ).toThrow();
  });
});

describe('mrWhiteGuessPayloadSchema', () => {
  it('accepts exactly 60 chars after trim', () => {
    const word = 'x'.repeat(60);
    expect(mrWhiteGuessPayloadSchema.parse({ word: `  ${word}  ` })).toEqual({ word });
  });

  it('rejects 61 chars', () => {
    expect(() => mrWhiteGuessPayloadSchema.parse({ word: 'x'.repeat(61) })).toThrow();
  });
});

describe('chatSendPayloadSchema', () => {
  it('accepts exactly 200 chars after trim', () => {
    const text = 'x'.repeat(200);
    expect(chatSendPayloadSchema.parse({ text })).toEqual({ text });
  });

  it('rejects 201 chars', () => {
    expect(() => chatSendPayloadSchema.parse({ text: 'x'.repeat(201) })).toThrow();
  });
});

const VALID_CAN_ACT = {
  submitClue: true,
  vote: false,
  judge: false,
  grudge: false,
  advancePhase: false,
  start: false,
  kick: false,
  extendTimer: false,
};

const VALID_YOU_SLICE: YouSlice = {
  playerId: VALID_UUID,
  role: 'civilian',
  word: 'Coffee',
  specialRole: null,
  yourVote: null,
  canAct: VALID_CAN_ACT,
  lovebirdsPartnerId: null,
  rivalId: null,
};

describe('youSliceSchema', () => {
  it('round-trips a full slice', () => {
    expect(youSliceSchema.parse(VALID_YOU_SLICE)).toEqual(VALID_YOU_SLICE);
  });

  it('accepts a null role/word/specialRole (spectator or Mr. White)', () => {
    const slice = { ...VALID_YOU_SLICE, role: null, word: null, specialRole: null };
    expect(youSliceSchema.parse(slice)).toEqual(slice);
  });

  it('rejects an invalid role', () => {
    expect(() => youSliceSchema.parse({ ...VALID_YOU_SLICE, role: 'spectator' })).toThrow();
  });

  it('rejects a canAct missing a required key', () => {
    const incompleteCanAct = {
      submitClue: true,
      vote: false,
      judge: false,
      advancePhase: false,
      start: false,
      kick: false,
    };
    expect(() => youSliceSchema.parse({ ...VALID_YOU_SLICE, canAct: incompleteCanAct })).toThrow();
  });
});

describe('roomSnapshotSchema', () => {
  it('round-trips a valid snapshot', () => {
    const state = {} as RedactedGameState; // server-produced & engine-typed; see socket.ts comment
    const snapshot: RoomSnapshot = { ver: 1, state, you: VALID_YOU_SLICE };
    expect(roomSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('rejects a missing you slice', () => {
    expect(() => roomSnapshotSchema.parse({ ver: 1, state: {} })).toThrow();
  });
});

describe('roomEventSchema', () => {
  it.each([
    'playerJoined',
    'playerLeft',
    'playerDisconnected',
    'playerReconnected',
    'hostChanged',
    'kicked',
  ])('accepts the %s variant', (type) => {
    const event = { type, playerId: VALID_UUID, name: 'Sam' };
    expect(roomEventSchema.parse(event)).toEqual(event);
  });

  it('accepts the timerExtended variant with no extra fields', () => {
    expect(roomEventSchema.parse({ type: 'timerExtended' })).toEqual({ type: 'timerExtended' });
  });

  it('rejects an unknown type', () => {
    expect(() =>
      roomEventSchema.parse({ type: 'somethingElse', playerId: VALID_UUID, name: 'Sam' }),
    ).toThrow();
  });

  it('rejects a playerJoined event missing playerId', () => {
    expect(() => roomEventSchema.parse({ type: 'playerJoined', name: 'Sam' })).toThrow();
  });
});

describe('chatMessageSchema', () => {
  it('round-trips a valid message', () => {
    const message = { from: { id: VALID_UUID, name: 'Sam' }, text: 'gg', at: Date.now() };
    expect(chatMessageSchema.parse(message)).toEqual(message);
  });
});

describe('voiceStatePayloadSchema', () => {
  it('accepts muted true and false', () => {
    expect(voiceStatePayloadSchema.parse({ muted: true })).toEqual({ muted: true });
    expect(voiceStatePayloadSchema.parse({ muted: false })).toEqual({ muted: false });
  });

  it('rejects a non-boolean muted', () => {
    expect(() => voiceStatePayloadSchema.parse({ muted: 'yes' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => voiceStatePayloadSchema.parse({ muted: true, extra: 1 })).toThrow();
  });
});

describe('voiceRosterSchema', () => {
  it('round-trips a mute map', () => {
    const payload = { muted: { [VALID_UUID]: true, [VALID_CODE]: false } };
    expect(voiceRosterSchema.parse(payload)).toEqual(payload);
  });

  it('accepts an empty roster', () => {
    expect(voiceRosterSchema.parse({ muted: {} })).toEqual({ muted: {} });
  });

  it('rejects a non-boolean value in the map', () => {
    expect(() => voiceRosterSchema.parse({ muted: { [VALID_UUID]: 'true' } })).toThrow();
  });
});

describe('SocketAck', () => {
  it('narrows on ok for both success and failure shapes', () => {
    const success: JoinAck = {
      ok: true,
      snapshot: { ver: 1, state: {} as RedactedGameState, you: VALID_YOU_SLICE },
    };
    const failure: BasicAck = { ok: false, error: 'not_host' };
    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error).toBe('not_host');
    }
  });
});
