CREATE TYPE "public"."pack_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "word_packs" ADD COLUMN "review_status" "pack_review_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Grandfather existing content: the new column defaults every row to 'pending', but any
-- pack that is already public — or is official (the seeded starter packs, which ship
-- public) — predates this review gate and is live today. Leaving those 'pending' would
-- make them vanish for every non-owner (and for official packs, everyone) the moment this
-- migration lands. Approve them in place so nothing currently-visible disappears. Packs
-- made public AFTER this point are approved immediately (going public is self-service); the
-- 'pending' state is dormant infrastructure for a future review gate.
UPDATE "word_packs" SET "review_status" = 'approved' WHERE "visibility" = 'public' OR "is_official" = true;