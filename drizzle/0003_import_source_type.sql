UPDATE "import_jobs" SET "source_type" = 'manual' WHERE "source_type" NOT IN ('manual', 'crm');
--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "source_type" SET DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_source_type_check" CHECK ("source_type" IN ('manual', 'crm'));
