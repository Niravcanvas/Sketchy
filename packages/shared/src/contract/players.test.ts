import { describe, expect, it } from 'vitest';
import {
  avatarConfigSchema,
  gameHistoryItemSchema,
  gameRoundSchema,
  gameRoundSummaryResponseSchema,
  gamesPageSchema,
  guestAuthRequestSchema,
  guestAuthResponseSchema,
  meResponseSchema,
  patchMeRequestSchema,
  playerSchema,
  roleStatsSchema,
  roundVoteTallySchema,
  statsResponseSchema,
} from './players.js';

const validAvatar = { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' };

describe('avatarConfigSchema', () => {
  it('accepts a well-formed avatar config', () => {
    expect(avatarConfigSchema.parse(validAvatar)).toEqual(validAvatar);
  });

  it('rejects fields over 40 chars', () => {
    expect(() => avatarConfigSchema.parse({ ...validAvatar, head: 'x'.repeat(41) })).toThrow();
  });

  it('rejects a missing field', () => {
    const { head, face, accessory } = validAvatar;
    expect(() => avatarConfigSchema.parse({ head, face, accessory })).toThrow();
  });
});

describe('playerSchema', () => {
  it('round-trips a valid player', () => {
    const player = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      displayName: 'Sam',
      avatar: validAvatar,
      isGuest: true,
      createdAt: Date.now(),
    };
    expect(playerSchema.parse(player)).toEqual(player);
  });

  it('rejects a non-uuid id', () => {
    expect(() =>
      playerSchema.parse({
        id: 'not-a-uuid',
        displayName: 'Sam',
        avatar: validAvatar,
        isGuest: true,
        createdAt: Date.now(),
      }),
    ).toThrow();
  });
});

describe('guestAuthRequestSchema', () => {
  it('trims the display name before validating length', () => {
    expect(guestAuthRequestSchema.parse({ displayName: '  Sam  ' })).toEqual({
      displayName: 'Sam',
    });
  });

  it('rejects names shorter than 2 chars after trimming', () => {
    expect(() => guestAuthRequestSchema.parse({ displayName: ' a ' })).toThrow();
  });

  it('rejects names longer than 20 chars', () => {
    expect(() => guestAuthRequestSchema.parse({ displayName: 'x'.repeat(21) })).toThrow();
  });
});

describe('guestAuthResponseSchema', () => {
  it('accepts a token + player payload', () => {
    const body = {
      token: 'jwt.token.here',
      player: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        displayName: 'Sam',
        avatar: validAvatar,
        isGuest: true,
        createdAt: Date.now(),
      },
    };
    expect(guestAuthResponseSchema.parse(body)).toEqual(body);
  });
});

describe('patchMeRequestSchema', () => {
  it('accepts an empty object (both fields optional)', () => {
    expect(patchMeRequestSchema.parse({})).toEqual({});
  });

  it('accepts a displayName-only patch', () => {
    expect(patchMeRequestSchema.parse({ displayName: 'New Name' })).toEqual({
      displayName: 'New Name',
    });
  });

  it('accepts an avatar-only patch', () => {
    expect(patchMeRequestSchema.parse({ avatar: validAvatar })).toEqual({ avatar: validAvatar });
  });

  it('rejects an invalid avatar', () => {
    expect(() => patchMeRequestSchema.parse({ avatar: { ...validAvatar, head: 123 } })).toThrow();
  });
});

describe('meResponseSchema', () => {
  it('wraps a player', () => {
    const body = {
      player: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        displayName: 'Sam',
        avatar: validAvatar,
        isGuest: false,
        createdAt: Date.now(),
      },
    };
    expect(meResponseSchema.parse(body)).toEqual(body);
  });
});

describe('roleStatsSchema', () => {
  it('accepts a well-formed bucket', () => {
    const stats = { played: 12, won: 5, points: 34 };
    expect(roleStatsSchema.parse(stats)).toEqual(stats);
  });
});

describe('statsResponseSchema', () => {
  it('round-trips header totals + byRole', () => {
    const body = {
      totalPoints: 100,
      gamesPlayed: 20,
      gamesWon: 8,
      byRole: {
        civilian: { played: 10, won: 4, points: 8 },
        undercover: { played: 6, won: 3, points: 30 },
        mrwhite: { played: 4, won: 1, points: 6 },
      },
    };
    expect(statsResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a byRole missing one of the three roles', () => {
    expect(() =>
      statsResponseSchema.parse({
        totalPoints: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        byRole: {
          civilian: { played: 0, won: 0, points: 0 },
          undercover: { played: 0, won: 0, points: 0 },
        },
      }),
    ).toThrow();
  });
});

const validHistoryItem = {
  gameId: '123e4567-e89b-12d3-a456-426614174000',
  endedAt: Date.now(),
  mode: 'online_private',
  roomCode: 'ABCJK',
  myRole: 'undercover',
  mySpecialRole: null,
  myPoints: 10,
  won: true,
  winnerFaction: 'undercover',
  civilianWord: 'Latte',
  undercoverWord: 'Espresso',
  playerCount: 6,
  roundsPlayed: 3,
};

describe('gameHistoryItemSchema', () => {
  it('round-trips a finished game', () => {
    expect(gameHistoryItemSchema.parse(validHistoryItem)).toEqual(validHistoryItem);
  });

  it('accepts a null winnerFaction (abandoned game)', () => {
    const abandoned = { ...validHistoryItem, winnerFaction: null, won: false, myPoints: 0 };
    expect(gameHistoryItemSchema.parse(abandoned)).toEqual(abandoned);
  });

  it('rejects an unknown mode', () => {
    expect(() => gameHistoryItemSchema.parse({ ...validHistoryItem, mode: 'ranked' })).toThrow();
  });
});

describe('gamesPageSchema', () => {
  it('accepts an empty page with a null cursor', () => {
    expect(gamesPageSchema.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('accepts a page with items + a cursor', () => {
    const body = { items: [validHistoryItem], nextCursor: 'abc123' };
    expect(gamesPageSchema.parse(body)).toEqual(body);
  });
});

describe('roundVoteTallySchema', () => {
  it('carries only an aggregate count, never a voter identity', () => {
    const tally = { playerId: '123e4567-e89b-12d3-a456-426614174000', playerName: 'Jo', votes: 3 };
    const parsed = roundVoteTallySchema.parse(tally);
    expect(parsed).toEqual(tally);
    expect(Object.keys(parsed)).not.toContain('voterId');
  });
});

const P1 = '123e4567-e89b-12d3-a456-426614174001';
const P3 = '123e4567-e89b-12d3-a456-426614174003';
const P4 = '123e4567-e89b-12d3-a456-426614174004';

describe('gameRoundSchema', () => {
  it('accepts a round with clues, an elimination, and a vote tally', () => {
    const round = {
      round: 1,
      clues: [{ playerId: P1, playerName: 'Priya', text: 'Warm' }],
      eliminated: { playerId: P3, playerName: 'Jo', role: 'undercover' },
      voteTally: [{ playerId: P3, playerName: 'Jo', votes: 3 }],
    };
    expect(gameRoundSchema.parse(round)).toEqual(round);
  });

  it('accepts a round with no elimination (all-abstain / second tie)', () => {
    const round = { round: 2, clues: [], eliminated: null, voteTally: [] };
    expect(gameRoundSchema.parse(round)).toEqual(round);
  });
});

describe('gameRoundSummaryResponseSchema', () => {
  it('round-trips a multi-round summary', () => {
    const body = {
      gameId: '123e4567-e89b-12d3-a456-426614174000',
      rounds: [
        { round: 1, clues: [], eliminated: null, voteTally: [] },
        {
          round: 2,
          clues: [{ playerId: P1, playerName: 'Priya', text: 'Cold' }],
          eliminated: { playerId: P4, playerName: 'Alex', role: 'mrwhite' },
          voteTally: [{ playerId: P4, playerName: 'Alex', votes: 2 }],
        },
      ],
    };
    expect(gameRoundSummaryResponseSchema.parse(body)).toEqual(body);
  });
});
