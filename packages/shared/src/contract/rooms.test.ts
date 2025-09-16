import { describe, expect, it } from 'vitest';
import {
  createRoomRequestSchema,
  createRoomResponseSchema,
  gameSettingsPatchSchema,
  phaseSchema,
  roomCodeSchema,
  roomResolutionSchema,
  specialRoleSchema,
  voiceTokenResponseSchema,
} from './rooms.js';

const VALID_CODE = 'AB2CD'; // 5 chars, every char in ROOM_CODE_ALPHABET

const FULL_SETTINGS_PATCH = {
  maxPlayers: 12,
  undercoverCount: 2,
  mrWhiteCount: 1,
  specialRoles: ['judge', 'ghost'] as const,
  packIds: ['123e4567-e89b-12d3-a456-426614174000'],
  difficulties: ['easy', 'medium'] as const,
  clueTimerSec: 60,
  discussionTimerSec: null,
  voteTimerSec: 45,
  mrWhiteFirstClueBan: true,
  eliminationReveal: 'role' as const,
};

const ALL_PHASES = [
  'lobby',
  'dealing',
  'clue',
  'discussion',
  'voting',
  'tiebreak_clue',
  'judge_decision',
  'grudge_decision',
  'reveal',
  'mrwhite_guess',
  'game_over',
] as const;

const ALL_SPECIAL_ROLES = [
  'judge',
  'ghost',
  'jester',
  'lovebirds',
  'grudge',
  'mirror',
  'rivals',
  'mime',
] as const;

describe('roomCodeSchema', () => {
  it('accepts a well-formed 5-char code', () => {
    expect(roomCodeSchema.parse(VALID_CODE)).toBe(VALID_CODE);
  });

  it.each(['0', 'O', '1', 'I', 'L'])('rejects a code containing ambiguous char %s', (char) => {
    const code = `AB${char}CD`.slice(0, 5);
    expect(() => roomCodeSchema.parse(code)).toThrow();
  });

  it('rejects a lowercase code', () => {
    expect(() => roomCodeSchema.parse(VALID_CODE.toLowerCase())).toThrow();
  });

  it('rejects a code that is too short', () => {
    expect(() => roomCodeSchema.parse('AB2C')).toThrow();
  });

  it('rejects a code that is too long', () => {
    expect(() => roomCodeSchema.parse('AB2CDE')).toThrow();
  });

  it('does not normalize (no trim, no case coercion)', () => {
    expect(() => roomCodeSchema.parse(` ${VALID_CODE} `)).toThrow();
  });
});

describe('specialRoleSchema', () => {
  it.each(ALL_SPECIAL_ROLES)('accepts %s', (role) => {
    expect(specialRoleSchema.parse(role)).toBe(role);
  });

  it('rejects an unknown special role', () => {
    expect(() => specialRoleSchema.parse('wizard')).toThrow();
  });
});

describe('gameSettingsPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(gameSettingsPatchSchema.parse({})).toEqual({});
  });

  it('round-trips a fully populated patch (all eleven GameSettings fields)', () => {
    expect(gameSettingsPatchSchema.parse(FULL_SETTINGS_PATCH)).toEqual(FULL_SETTINGS_PATCH);
  });

  it('accepts null for the nullable timer fields', () => {
    const patch = { clueTimerSec: null, discussionTimerSec: null, voteTimerSec: null };
    expect(gameSettingsPatchSchema.parse(patch)).toEqual(patch);
  });

  it('rejects an unrecognized key', () => {
    expect(() => gameSettingsPatchSchema.parse({ maxPlayers: 12, notAField: true })).toThrow();
  });

  it('rejects a wrong-typed field', () => {
    expect(() => gameSettingsPatchSchema.parse({ maxPlayers: 'twelve' })).toThrow();
  });

  it('rejects a non-integer maxPlayers', () => {
    expect(() => gameSettingsPatchSchema.parse({ maxPlayers: 12.5 })).toThrow();
  });

  it('rejects an invalid eliminationReveal value', () => {
    expect(() => gameSettingsPatchSchema.parse({ eliminationReveal: 'word_only' })).toThrow();
  });

  it('rejects an invalid difficulty in the difficulties array', () => {
    expect(() => gameSettingsPatchSchema.parse({ difficulties: ['nightmare'] })).toThrow();
  });

  it('rejects an invalid specialRoles entry', () => {
    expect(() => gameSettingsPatchSchema.parse({ specialRoles: ['wizard'] })).toThrow();
  });
});

describe('createRoomRequestSchema', () => {
  it('accepts an empty body (settings omitted)', () => {
    expect(createRoomRequestSchema.parse({})).toEqual({});
  });

  it('accepts a body with a partial settings patch', () => {
    const body = { settings: { maxPlayers: 8 } };
    expect(createRoomRequestSchema.parse(body)).toEqual(body);
  });
});

describe('createRoomResponseSchema', () => {
  it('round-trips a valid response', () => {
    const body = { code: VALID_CODE, joinUrl: 'https://sketchy.example/r/AB2CD' };
    expect(createRoomResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a malformed code', () => {
    expect(() =>
      createRoomResponseSchema.parse({ code: 'lower', joinUrl: 'https://sketchy.example/r/x' }),
    ).toThrow();
  });
});

describe('phaseSchema', () => {
  it.each(ALL_PHASES)('accepts %s', (phase) => {
    expect(phaseSchema.parse(phase)).toBe(phase);
  });

  it('rejects an unknown phase', () => {
    expect(() => phaseSchema.parse('intermission')).toThrow();
  });
});

describe('roomResolutionSchema', () => {
  it('round-trips a valid room resolution', () => {
    const body = {
      code: VALID_CODE,
      phase: 'lobby' as const,
      playerCount: 3,
      maxPlayers: 12,
      canJoin: true,
      canRejoin: false,
      hostName: 'Sam',
    };
    expect(roomResolutionSchema.parse(body)).toEqual(body);
  });

  it('rejects an invalid phase', () => {
    expect(() =>
      roomResolutionSchema.parse({
        code: VALID_CODE,
        phase: 'not_a_phase',
        playerCount: 3,
        maxPlayers: 12,
        canJoin: true,
        canRejoin: false,
        hostName: 'Sam',
      }),
    ).toThrow();
  });
});

describe('voiceTokenResponseSchema', () => {
  it('round-trips a valid voice token response', () => {
    const body = { token: 'signed.jwt.token', url: 'wss://voice.sketchy.example' };
    expect(voiceTokenResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a missing url', () => {
    expect(() => voiceTokenResponseSchema.parse({ token: 'x' })).toThrow();
  });
});
