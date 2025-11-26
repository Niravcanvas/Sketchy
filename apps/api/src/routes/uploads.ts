import { errorEnvelopeSchema } from '@sketchy/shared/contract/errors';
import { presignRequestSchema, presignResponseSchema } from '@sketchy/shared/contract/uploads';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../auth/plugin.js';
import { sendError } from '../error-envelope.js';
import { buildPresignedUpload } from '../uploads/presign.js';
import { getR2Client } from '../uploads/r2-client.js';

const STALE_SESSION_MESSAGE = "Your session went stale. Refresh and you'll be back in.";

/**
 * `POST /v1/uploads/presign` (api-contract.md §1) — R2
 * presigned PUT for pack covers (and, per the contract's `kind` union,
 * avatars — not wired to any web UI yet, but the endpoint doesn't
 * discriminate). `contentType` (image/* only) and `sizeBytes` (≤512 KB) are
 * both zod-validated BEFORE a URL is ever minted (`presignRequestSchema`,
 * `packages/shared/src/contract/uploads.ts`) — a request that fails either
 * check never reaches R2 at all, mocked or real.
 *
 * Dev-environment note: this repo's R2 credentials are placeholders
 * ("changeme" — `.env.example`). Presigning is pure local SigV4 crypto, so
 * this endpoint still returns a syntactically valid `{uploadUrl, publicUrl}`
 * pair against those placeholders; an actual `PUT` to `uploadUrl` will fail
 * (no such R2 account exists). That's the accepted dev fallback —
 * verified here by unit test against a MOCKED S3 client
 * (`uploads/presign.test.ts`), not by reaching a live bucket.
 */
export const uploadRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/uploads/presign',
    {
      preHandler: requireAuth,
      schema: {
        body: presignRequestSchema,
        response: {
          200: presignResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = request.player;
      if (!caller) {
        sendError(reply, 401, 'unauthorized', STALE_SESSION_MESSAGE);
        return undefined;
      }

      const result = await buildPresignedUpload(request.body, caller.id, getR2Client());
      return result;
    },
  );
};
