CREATE TYPE "public"."rate_card_version_status" AS ENUM('current', 'historical');--> statement-breakpoint
ALTER TABLE "rate_card_versions"
  ADD COLUMN "publication_status" "rate_card_version_status" NOT NULL DEFAULT 'historical';--> statement-breakpoint
WITH newest AS (
  SELECT id
  FROM rate_card_versions
  WHERE published_at IS NOT NULL
  ORDER BY published_at DESC, id DESC
  LIMIT 1
)
UPDATE rate_card_versions
SET publication_status = 'current'
WHERE id IN (SELECT id FROM newest);--> statement-breakpoint
ALTER TABLE "rate_card_versions" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "rate_card_versions" DROP COLUMN "effective_at";--> statement-breakpoint
ALTER TABLE "rate_card_versions" DROP COLUMN "activated_at";--> statement-breakpoint
ALTER TABLE "rate_card_versions" RENAME COLUMN "publication_status" TO "status";--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_versions_one_current"
  ON "rate_card_versions" (status) WHERE status = 'current';--> statement-breakpoint
ALTER TYPE "public"."change_type" ADD VALUE IF NOT EXISTS 'removed';
