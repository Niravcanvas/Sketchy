import { z } from 'zod';

/**
 * `POST /v1/uploads/presign` (api-contract.md §1) — R2 presigned PUT
 * for pack covers and avatars. `contentType`/`sizeBytes` are both REQUIRED
 * (not merely advisory): the server signs the presigned URL with a matching
 * `ContentType`/`ContentLength` on the S3 `PutObjectCommand`
 * (`apps/api/src/uploads/presign.ts`), so a client that later PUTs a
 * different content-type or byte count than it declared here has its upload
 * rejected by R2's own SigV4 check, not just this endpoint's pre-check.
 *
 * `sizeBytes` is an ADDITIVE field beyond the shape first sketched in
 * api-contract.md's summary table (`{ kind, contentType }`) — added here per
 * the contract-change checklist (api-contract.md §4: schema in
 * packages/shared first) because the 512 KB cap
 * can't be enforced without knowing the size before minting the URL. Additive
 * per §0's versioning policy (new required field on a brand-new endpoint no
 * client has integrated against yet — not a breaking change to anything
 * live). api-contract.md's table is updated to match in the same change.
 */
export const UPLOAD_MAX_BYTES = 512 * 1024;

const IMAGE_CONTENT_TYPE_PATTERN = /^image\/[a-z0-9.+-]+$/i;

export const uploadKindSchema = z.enum(['packCover', 'avatar']);

export type UploadKind = z.infer<typeof uploadKindSchema>;

export const presignRequestSchema = z.object({
  kind: uploadKindSchema,
  contentType: z.string().regex(IMAGE_CONTENT_TYPE_PATTERN, 'contentType must be image/*'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(UPLOAD_MAX_BYTES, `File must be ${UPLOAD_MAX_BYTES} bytes or smaller.`),
});

export type PresignRequest = z.infer<typeof presignRequestSchema>;

export const presignResponseSchema = z.object({
  uploadUrl: z.string(),
  publicUrl: z.string(),
});

export type PresignResponse = z.infer<typeof presignResponseSchema>;
