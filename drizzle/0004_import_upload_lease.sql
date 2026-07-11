ALTER TYPE "public"."import_state" ADD VALUE 'uploading' BEFORE 'uploaded';--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "upload_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "upload_lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_upload_attempt_id_unique" ON "import_jobs" USING btree ("upload_attempt_id") WHERE "import_jobs"."upload_attempt_id" is not null;