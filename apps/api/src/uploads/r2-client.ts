/**
 * Cloudflare R2 (S3-compatible) client singleton — mirrors the lazy-singleton
 * pattern in `db/client.ts`. R2's S3-compatible endpoint is
 * `https://{accountId}.r2.cloudflarestorage.com` (system-design.md §9); the
 * `@aws-sdk/client-s3` SDK talks to it unmodified once pointed at that
 * endpoint with `region: 'auto'` (R2's documented convention — R2 has no
 * regions, but the SDK requires a value).
 */
import { S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '../env.js';

let client: S3Client | undefined;

/**
 * Constructing this client never touches the network — the same "safe to
 * call even with placeholder creds" property `getPool()`/`getRedis()` have.
 * Presigning (routes/uploads.ts) is pure local crypto against whatever
 * credentials are configured; only an actual PUT against the returned URL
 * would fail against a non-existent account.
 */
export function getR2Client(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2AccessKeyId,
        secretAccessKey: env.r2SecretAccessKey,
      },
    });
  }
  return client;
}
