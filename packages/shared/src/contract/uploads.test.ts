import { describe, expect, it } from 'vitest';
import { presignRequestSchema, presignResponseSchema, UPLOAD_MAX_BYTES } from './uploads.js';

describe('presignRequestSchema', () => {
  it('accepts a well-formed packCover request', () => {
    const body = { kind: 'packCover' as const, contentType: 'image/png', sizeBytes: 1024 };
    expect(presignRequestSchema.parse(body)).toEqual(body);
  });

  it('rejects a non-image contentType', () => {
    expect(() =>
      presignRequestSchema.parse({ kind: 'avatar', contentType: 'application/pdf', sizeBytes: 100 }),
    ).toThrow();
  });

  it(`rejects sizeBytes above the ${UPLOAD_MAX_BYTES}-byte cap`, () => {
    expect(() =>
      presignRequestSchema.parse({
        kind: 'packCover',
        contentType: 'image/png',
        sizeBytes: UPLOAD_MAX_BYTES + 1,
      }),
    ).toThrow();
  });

  it('accepts exactly the cap', () => {
    const body = { kind: 'avatar' as const, contentType: 'image/webp', sizeBytes: UPLOAD_MAX_BYTES };
    expect(presignRequestSchema.parse(body)).toEqual(body);
  });

  it('rejects a zero or negative sizeBytes', () => {
    expect(() =>
      presignRequestSchema.parse({ kind: 'avatar', contentType: 'image/png', sizeBytes: 0 }),
    ).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      presignRequestSchema.parse({ kind: 'banner', contentType: 'image/png', sizeBytes: 10 }),
    ).toThrow();
  });
});

describe('presignResponseSchema', () => {
  it('round-trips uploadUrl/publicUrl', () => {
    const body = {
      uploadUrl: 'https://example.r2.cloudflarestorage.com/bucket/key?signature=abc',
      publicUrl: 'https://cdn.sketchy.example/packCover/key.png',
    };
    expect(presignResponseSchema.parse(body)).toEqual(body);
  });
});
