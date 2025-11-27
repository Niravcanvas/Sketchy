/**
 * Unit tests for the presigned-PUT minting logic,
 * run WITHOUT a live R2 bucket — this dev environment's R2 credentials are
 * placeholders (`.env.example` "changeme"). `getSignedUrl` is pure local
 * SigV4 crypto (no network call), so an `S3Client` built with dummy
 * credentials against a fake endpoint is a fully offline stand-in for the
 * real R2 client — effectively a mock without fighting the AWS SDK's
 * internal middleware stack via `vi.mock`.
 */
import { S3Client } from '@aws-sdk/client-s3';
import type { PresignRequest } from '@sketchy/shared/contract/uploads';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPresignedUpload } from './presign.js';

const PLAYER_ID = '123e4567-e89b-12d3-a456-426614174000';

function mockS3Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: 'https://test-account.r2.cloudflarestorage.com',
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  });
}

beforeEach(() => {
  vi.stubEnv('R2_BUCKET', 'sketchy-test-bucket');
  vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://cdn.sketchy.example');
});

describe('buildPresignedUpload', () => {
  it('mints a signed uploadUrl pointed at the configured bucket', async () => {
    const body: PresignRequest = { kind: 'packCover', contentType: 'image/png', sizeBytes: 2048 };
    const result = await buildPresignedUpload(body, PLAYER_ID, mockS3Client());

    expect(result.uploadUrl).toContain('sketchy-test-bucket');
    expect(result.uploadUrl).toContain('X-Amz-Signature=');
    expect(result.uploadUrl.startsWith('https://')).toBe(true);
  });

  it('derives the public URL from R2_PUBLIC_BASE_URL, keyed by kind/player/uuid + extension', async () => {
    const body: PresignRequest = { kind: 'packCover', contentType: 'image/webp', sizeBytes: 1024 };
    const result = await buildPresignedUpload(body, PLAYER_ID, mockS3Client());

    expect(result.publicUrl.startsWith('https://cdn.sketchy.example/packCover/')).toBe(true);
    expect(result.publicUrl).toContain(PLAYER_ID);
    expect(result.publicUrl.endsWith('.webp')).toBe(true);
  });

  it('scopes the object key by kind (avatar vs packCover)', async () => {
    const body: PresignRequest = { kind: 'avatar', contentType: 'image/jpeg', sizeBytes: 1024 };
    const result = await buildPresignedUpload(body, PLAYER_ID, mockS3Client());

    expect(result.publicUrl.startsWith('https://cdn.sketchy.example/avatar/')).toBe(true);
    expect(result.publicUrl.endsWith('.jpg')).toBe(true);
  });

  it('two calls for the same player mint different object keys (never collide)', async () => {
    const body: PresignRequest = { kind: 'packCover', contentType: 'image/png', sizeBytes: 512 };
    const client = mockS3Client();
    const first = await buildPresignedUpload(body, PLAYER_ID, client);
    const second = await buildPresignedUpload(body, PLAYER_ID, client);

    expect(first.publicUrl).not.toBe(second.publicUrl);
  });

  it('trims a trailing slash on R2_PUBLIC_BASE_URL before joining the key', async () => {
    vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://cdn.sketchy.example/');
    const body: PresignRequest = { kind: 'packCover', contentType: 'image/png', sizeBytes: 512 };
    const result = await buildPresignedUpload(body, PLAYER_ID, mockS3Client());

    expect(result.publicUrl).not.toContain('example//');
  });
});
