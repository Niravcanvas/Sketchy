import { z } from 'zod';
import { roomCodeSchema } from './rooms.js';

/**
 * Moderation reporting wire contract (api-contract.md §1
 * "Matchmaking" `POST /reports`). ADDITIVE to `/v1`. The `reason` enum
 * mirrors the `reports.reason` column's documented value set (data-model.md
 * §1: `'name' | 'chat' | 'clue' | 'other'`).
 */
export const reportReasonSchema = z.enum(['name', 'chat', 'clue', 'other']);

export type ReportReason = z.infer<typeof reportReasonSchema>;

/**
 * `POST /v1/reports` request body (api-contract.md §1). `roomCode` is optional
 * — a report can be filed outside a room (e.g. an offensive display name in a
 * lobby list) — but when present the server captures the room's recent
 * chat/clue context server-side (never sent by the client, which can't be
 * trusted to report it faithfully). `detail` is the
 * reporter's own free text, length-capped like every other free-text field.
 */
export const createReportRequestSchema = z.object({
  reportedPlayerId: z.uuid(),
  roomCode: roomCodeSchema.optional(),
  reason: reportReasonSchema,
  detail: z.string().trim().max(500).optional(),
});

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;
