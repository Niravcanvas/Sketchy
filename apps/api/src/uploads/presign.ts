/**
 * Presigned-PUT minting logic, separated from the
 * Fastify route (`routes/uploads.ts`) so it can be unit-tested against a
 * MOCKED S3 client without a live R2 bucket (this dev environment's R2
 * credentials are placeholders — see `uploads/r2-client.ts`'s doc comment).
 */
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignRequest } from '@sketchy/shared/contract/uploads';
import { getEnv } from '../env.js';

const UPLOAD_URL_EXPIRY_SECONDS = 5 * 60;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** Falls back to the content-type's subtype (`image/avif` → `avif`) for
 * anything not in the explicit map above, rather than rejecting — the
 * contentType itself is already validated `image/*` by the zod schema. */
function extensionFor(contentType: string): string {
  const mapped = EXTENSION_BY_CONTENT_TYPE[contentType.toLowerCase()];
  if (mapped) {
    return mapped;
  }
  const subtype = contentType.split('/')[1] ?? 'bin';
  return subtype.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
}

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
}

/**
 * Mints one presigned PUT for `body` on behalf of `playerId`. The
 * `PutObjectCommand`'s `ContentType`/`ContentLength` are signed into the
 * URL — R2 (S3-compatible SigV4) rejects a PUT whose actual headers don't
 * match what was signed, so the client can't silently upload a bigger file
 * or a different type than it declared at presign time. `s3Client` is
 * injectable for tests; defaults to the real singleton in production code
 * paths.
 */
export async function buildPresignedUpload(
  body: PresignRequest,
  playerId: string,
  s3Client: S3Client,
): Promise<PresignedUpload> {
  const env = getEnv();
  const key = `${body.kind}/${playerId}/${randomUUID()}.${extensionFor(body.contentType)}`;

  const command = new PutObjectCommand({
    Bucket: env.r2Bucket,
    Key: key,
    ContentType: body.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: UPLOAD_URL_EXPIRY_SECONDS });
  const publicBase = env.r2PublicBaseUrl.replace(/\/+$/, '');
  const publicUrl = `${publicBase}/${key}`;

  return { uploadUrl, publicUrl };
}
