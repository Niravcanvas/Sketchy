import { z } from 'zod';

/** Mirrors the Postgres `pack_visibility` enum (data-model.md §1). */
export const packVisibilitySchema = z.enum(['private', 'unlisted', 'public']);

/**
 * Mirrors the Postgres `pack_review_status` enum (data-model.md §1) — the PACK-level
 * public-catalog moderation state. A `visibility:'public'` pack is visible/usable to
 * non-owners only when it's `'approved'`; going public is self-service and sets `'approved'`
 * immediately, so public packs are live at once. This state and the admin `approve_pack`
 * action are dormant infrastructure for a future review gate, not enforced today.
 */
export const packReviewStatusSchema = z.enum(['pending', 'approved', 'rejected']);

/** Mirrors the Postgres `difficulty` enum (data-model.md §1) — a PAIR property. */
export const difficultySchema = z.enum(['easy', 'medium', 'hard']);

/**
 * `Pack` shape (api-contract.md §1) — `createdAt` is epoch ms (§0 convention).
 * `ownerName` is an additive field (see `mapPack` in
 * `apps/api/src/routes/mappers.ts`): the owner's display name, resolved by
 * routes that need "owner attribution" in the UI (imported/shared packs).
 * Optional — omitted by call sites that don't
 * resolve it, `null` for official packs (no owner) or when resolution
 * legitimately found nothing.
 */
export const packSchema = z.object({
  id: z.uuid(),
  slug: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  language: z.string(),
  isOfficial: z.boolean(),
  ownerId: z.uuid().nullable(),
  visibility: packVisibilitySchema,
  // PACK-level public-catalog state (the dormant review machinery). Meaningful only for
  // `visibility:'public'` packs (a public pack is browsable/usable by strangers only when
  // `'approved'`, which going public grants immediately); on private/unlisted packs it's
  // carried through but not consulted.
  reviewStatus: packReviewStatusSchema,
  shareCode: z.string().nullable(),
  coverUrl: z.string().nullable(),
  pairCount: z.number().int(),
  createdAt: z.number(),
  ownerName: z.string().nullable().optional(),
});

export type Pack = z.infer<typeof packSchema>;

/** `Pair` shape (api-contract.md §1). */
export const pairSchema = z.object({
  id: z.uuid(),
  packId: z.uuid(),
  wordA: z.string(),
  wordB: z.string(),
  difficulty: difficultySchema,
});

export type Pair = z.infer<typeof pairSchema>;

/**
 * `GET /v1/packs` query params. `official`/`mine` are "boolean-ish" query
 * strings (`?official=true`) — `z.stringbool()` accepts the common
 * true/false spellings ('true'/'1'/'yes'/'on' and 'false'/'0'/'no'/'off'),
 * unlike naive `z.coerce.boolean()` which treats any non-empty string
 * (including the literal text "false") as truthy.
 */
export const listPacksQuerySchema = z.object({
  official: z.stringbool().optional(),
  mine: z.stringbool().optional(),
  language: z.string().optional(),
});

export type ListPacksQuery = z.infer<typeof listPacksQuerySchema>;

/** Cursor-based pagination query params shared by paginated list endpoints (api-contract.md §0). */
export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `GET /v1/packs` response body. */
export const packsResponseSchema = z.object({
  items: z.array(packSchema),
});

export type PacksResponse = z.infer<typeof packsResponseSchema>;

/** `GET /v1/packs/:id` response body. */
export const packResponseSchema = z.object({
  pack: packSchema,
});

export type PackResponse = z.infer<typeof packResponseSchema>;

/** `GET /v1/packs/:id/pairs` response body — cursor pagination envelope (api-contract.md §0). */
export const pairsPageSchema = z.object({
  items: z.array(pairSchema),
  nextCursor: z.string().nullable(),
});

export type PairsPage = z.infer<typeof pairsPageSchema>;

// --- Write endpoints (api-contract.md §1 "Word packs & pairs") ---

/** Shared length cap for a single word side of a pair (mirrors the DB CHECK,
 * data-model.md §1: `char_length(word_a/word_b) BETWEEN 1 AND 40`). */
const WORD_MIN = 1;
const WORD_MAX = 40;

/** `POST /v1/packs` request body. */
export const createPackRequestSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().max(200).optional(),
});

export type CreatePackRequest = z.infer<typeof createPackRequestSchema>;

/**
 * `PATCH /v1/packs/:id` request body. Setting `visibility:'unlisted'` mints a
 * `shareCode` (api-contract.md §1). `'public'` is self-service and goes LIVE IMMEDIATELY:
 * the handler sets `reviewStatus:'approved'` in the same step, so the pack joins the public
 * catalog at once. The `review_status`/`approve_pack` machinery exists but is NOT enforced
 * today — it's dormant infrastructure that a future review gate can turn on.
 */
export const patchPackRequestSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  description: z.string().max(200).optional(),
  visibility: packVisibilitySchema.optional(),
  coverUrl: z.url().nullable().optional(),
});

export type PatchPackRequest = z.infer<typeof patchPackRequestSchema>;

/** One pair in a bulk-create request — `difficulty` defaults `'medium'` like the DB column. */
export const pairInputSchema = z.object({
  wordA: z.string().trim().min(WORD_MIN).max(WORD_MAX),
  wordB: z.string().trim().min(WORD_MIN).max(WORD_MAX),
  difficulty: difficultySchema.default('medium'),
});

export type PairInput = z.infer<typeof pairInputSchema>;

/** Bulk pair cap per call (api-contract.md §1). */
export const MAX_PAIRS_PER_BULK_REQUEST = 100;

/** `POST /v1/packs/:id/pairs` request body (bulk, ≤100 — api-contract.md §1). */
export const bulkCreatePairsRequestSchema = z.object({
  pairs: z.array(pairInputSchema).min(1).max(MAX_PAIRS_PER_BULK_REQUEST),
});

export type BulkCreatePairsRequest = z.infer<typeof bulkCreatePairsRequestSchema>;

/** `POST /v1/packs/:id/pairs` response body. */
export const pairsResponseSchema = z.object({
  items: z.array(pairSchema),
});

export type PairsResponse = z.infer<typeof pairsResponseSchema>;

/** `PATCH /v1/packs/:id/pairs/:pairId` request body. */
export const patchPairRequestSchema = z.object({
  wordA: z.string().trim().min(WORD_MIN).max(WORD_MAX).optional(),
  wordB: z.string().trim().min(WORD_MIN).max(WORD_MAX).optional(),
  difficulty: difficultySchema.optional(),
});

export type PatchPairRequest = z.infer<typeof patchPairRequestSchema>;

/** `PATCH /v1/packs/:id/pairs/:pairId` response body. */
export const pairResponseSchema = z.object({
  pair: pairSchema,
});

export type PairResponse = z.infer<typeof pairResponseSchema>;

/** Shared `{ ok: true }` envelope for the two DELETE endpoints (api-contract.md §1). */
export const okResponseSchema = z.object({
  ok: z.literal(true),
});

export type OkResponse = z.infer<typeof okResponseSchema>;

/** `POST /v1/packs/import` request body — by share code (api-contract.md §1). Normalized
 * the same way room codes are (trim + uppercase) since share codes are drawn from the same
 * unambiguous alphabet (conventions.md §4, `rooms/room-codes.ts`'s 8-char sibling). */
export const importPackRequestSchema = z.object({
  shareCode: z.string().trim().min(1).max(16),
});

export type ImportPackRequest = z.infer<typeof importPackRequestSchema>;

// --- Public catalog: discover + add-by-id (api-contract.md §1 "Word packs & pairs") ---

/**
 * `GET /v1/packs/public` query — browse the PUBLIC CATALOG: packs strangers have opened to
 * everyone, the discovery surface for `POST /packs/:id/import`. `q` is an optional trimmed
 * name search, capped at the pack-name ceiling (a name can't be longer, so a longer needle
 * never matches). `cursor`/`limit` are the shared cursor-pagination convention
 * (api-contract.md §0), mirroring `paginationQuerySchema`. This is DISTINCT from
 * `GET /packs` (the caller's own working set, which never lists other users' public packs)
 * and from the share-code import path (which resolves one pack, listing nothing).
 */
export const browsePublicPacksQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export type BrowsePublicPacksQuery = z.infer<typeof browsePublicPacksQuerySchema>;

/** `GET /v1/packs/public` response body — cursor pagination envelope (api-contract.md §0),
 * the same shape as `pairsPageSchema` but carrying whole `Pack`s. */
export const publicPacksPageSchema = z.object({
  items: z.array(packSchema),
  nextCursor: z.string().nullable(),
});

export type PublicPacksPage = z.infer<typeof publicPacksPageSchema>;
