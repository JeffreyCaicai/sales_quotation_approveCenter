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
    RETURN OLD;
  END IF;

  IF OLD.status = 'historical' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.version_code IS DISTINCT FROM OLD.version_code OR
    NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.import_job_id IS DISTINCT FROM OLD.import_job_id OR
    NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR
    NEW.published_by IS DISTINCT FROM OLD.published_by OR
    NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at OR
    NEW.published_at IS DISTINCT FROM OLD.published_at OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'historical rate card version business fields are immutable';
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
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO parent_status
    FROM rate_card_versions
    WHERE id = OLD.rate_card_version_id
    FOR NO KEY UPDATE;
    IF parent_status = 'historical' THEN
      RAISE EXCEPTION 'historical rate card child rows are immutable';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO parent_status
    FROM rate_card_versions
    WHERE id = NEW.rate_card_version_id
    FOR NO KEY UPDATE;
    IF parent_status = 'historical' THEN
      RAISE EXCEPTION 'historical rate card child rows are immutable';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
