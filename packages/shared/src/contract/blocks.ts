import { z } from 'zod';

/**
 * Per-player block-list wire contract. The
 * block endpoints are ADDITIVE to `/v1` beyond api-contract.md §1's originally
 * enumerated matchmaking rows: a server-enforced "never matched together"
 * guarantee (and the client's "hide their chat locally" filter) both need a
 * durable, queryable block list, which a client-only localStorage set can't
 * provide. Mirrored into api-contract.md §1 in the same change (contract checklist §4).
 *
 * Blocks are directional in storage (`blocker` → `blocked`) but SYMMETRIC in
 * effect for matchmaking: the matcher never seats two players together if
 * EITHER has blocked the other ("blocked players never matched together").
 */
export const createBlockRequestSchema = z.object({
  blockedPlayerId: z.uuid(),
});

export type CreateBlockRequest = z.infer<typeof createBlockRequestSchema>;

/** One row of `GET /v1/blocks` — a player the caller has blocked. */
export const blockItemSchema = z.object({
  blockedPlayerId: z.uuid(),
  createdAt: z.number(),
});

export type BlockItem = z.infer<typeof blockItemSchema>;

/** `GET /v1/blocks` response body — the caller's full block list (small by
 * construction; not paginated). Drives both the client-side chat-hiding filter
 * and the "you've blocked this player" affordance. */
export const blocksResponseSchema = z.object({
  items: z.array(blockItemSchema),
});

export type BlocksResponse = z.infer<typeof blocksResponseSchema>;
