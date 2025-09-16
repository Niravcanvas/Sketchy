import { describe, expect, it } from 'vitest';
import { blockItemSchema, blocksResponseSchema, createBlockRequestSchema } from './blocks.js';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('blocks contract (phase 16)', () => {
  it('validates a block request', () => {
    expect(createBlockRequestSchema.parse({ blockedPlayerId: UUID })).toEqual({ blockedPlayerId: UUID });
    expect(() => createBlockRequestSchema.parse({ blockedPlayerId: 'nope' })).toThrow();
  });

  it('validates a block item and list envelope', () => {
    expect(blockItemSchema.parse({ blockedPlayerId: UUID, createdAt: 123 })).toEqual({
      blockedPlayerId: UUID,
      createdAt: 123,
    });
    expect(blocksResponseSchema.parse({ items: [] })).toEqual({ items: [] });
  });
});
