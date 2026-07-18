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
ALTER TYPE "public"."change_type" ADD VALUE IF NOT EXISTS 'removed';--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_published_rate_card_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'historical' THEN
      RAISE EXCEPTION 'historical rate card version cannot be deleted';
    END IF;
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'published rate card version is immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'historical' THEN
    RAISE EXCEPTION 'historical rate card version is immutable';
  END IF;

  IF OLD.published_at IS NOT NULL THEN
    IF NEW.status = 'historical' AND
       (to_jsonb(NEW) - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'historical' THEN
      RAISE EXCEPTION 'published rate card status transition must change only status';
    END IF;
    RAISE EXCEPTION 'published rate card version is immutable';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_published_rate_card_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status rate_card_version_status;
  parent_published_at timestamp with time zone;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status, published_at INTO parent_status, parent_published_at
    FROM rate_card_versions
    WHERE id = OLD.rate_card_version_id
    FOR NO KEY UPDATE;
    IF parent_status = 'historical' OR parent_published_at IS NOT NULL THEN
      RAISE EXCEPTION 'published or historical rate card child rows are immutable';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status, published_at INTO parent_status, parent_published_at
    FROM rate_card_versions
    WHERE id = NEW.rate_card_version_id
    FOR NO KEY UPDATE;
    IF parent_status = 'historical' OR parent_published_at IS NOT NULL THEN
      RAISE EXCEPTION 'published or historical rate card child rows are immutable';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
