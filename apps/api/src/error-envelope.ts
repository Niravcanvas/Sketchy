import type { FastifyReply } from 'fastify';
import type { ErrorCode } from '@sketchy/shared/contract/errors';

/**
 * Sends the error envelope shared by every non-2xx REST response
 * (api-contract.md §0): `{ error: { code, message } }`. The single place
 * that shapes error bodies, so every route/handler stays consistent.
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
): void {
  reply.status(statusCode).send({ error: { code, message } });
}
