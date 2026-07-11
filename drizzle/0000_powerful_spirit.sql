CREATE TYPE "public"."change_type" AS ENUM('added', 'modified', 'deactivated', 'unchanged');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."file_purpose" AS ENUM('original', 'validation_report', 'difference_report');--> statement-breakpoint
CREATE TYPE "public"."import_data_type" AS ENUM('customer_brand', 'building', 'package', 'rate_card');--> statement-breakpoint
CREATE TYPE "public"."import_state" AS ENUM('uploaded', 'validating', 'validation_failed', 'ready_to_publish', 'draft', 'published', 'active', 'superseded', 'rolled_back');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"import_job_id" uuid,
	"source" text NOT NULL,
	"reason" text,
	"before_metadata" jsonb,
	"after_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"source_import_job_id" uuid,
	"source_metadata" jsonb,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_brand_code_unique" UNIQUE("brand_code")
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_code" text NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"area" text,
	"category" text,
	"traffic" bigint,
	"impressions" bigint,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"source_import_job_id" uuid,
	"source_attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildings_building_code_unique" UNIQUE("building_code")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_code" text NOT NULL,
	"name" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"source_import_job_id" uuid,
	"source_metadata" jsonb,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_customer_code_unique" UNIQUE("customer_code")
);
--> statement-breakpoint
CREATE TABLE "import_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"change_type" "change_type" NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" uuid NOT NULL,
	"sheet_name" text,
	"filename" text,
	"row_number" integer NOT NULL,
	"column_name" text,
	"error_key" text NOT NULL,
	"localized_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" uuid NOT NULL,
	"object_storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"purpose" "file_purpose" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_files_object_storage_key_unique" UNIQUE("object_storage_key")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_type" "import_data_type" NOT NULL,
	"template_version" text NOT NULL,
	"checksum" text NOT NULL,
	"state" "import_state" DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"source_type" text DEFAULT 'xlsx' NOT NULL,
	"normalized_payload" jsonb,
	"uploaded_by" uuid NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"failure_summary" text
);
--> statement-breakpoint
CREATE TABLE "rate_card_building_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_version_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"price_idr" numeric(18, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_building_prices_version_building_unique" UNIQUE("rate_card_version_id","building_id")
);
--> statement-breakpoint
CREATE TABLE "rate_card_package_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_version_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_package_buildings_version_package_building_unique" UNIQUE("rate_card_version_id","package_id","building_id")
);
--> statement-breakpoint
CREATE TABLE "rate_card_package_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_version_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"price_idr" numeric(18, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_package_configs_version_package_unique" UNIQUE("rate_card_version_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "rate_card_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_code" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"status" "import_state" DEFAULT 'draft' NOT NULL,
	"import_job_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"published_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_versions_version_code_unique" UNIQUE("version_code")
);
--> statement-breakpoint
CREATE TABLE "sales_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"sales_pic_user_id" uuid NOT NULL,
	"sales_type" text NOT NULL,
	"buying_channel" text NOT NULL,
	"client_status" text NOT NULL,
	"client_type" text NOT NULL,
	"registration_date" date,
	"expiry_date" date,
	"remarks" text,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"source_import_job_id" uuid,
	"source_metadata" jsonb,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_assignments_assignment_code_unique" UNIQUE("assignment_code")
);
--> statement-breakpoint
CREATE TABLE "sales_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_code" text NOT NULL,
	"name" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"source_import_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_packages_package_code_unique" UNIQUE("package_code")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_user_id_permission_key_unique" UNIQUE("user_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE FUNCTION prevent_users_email_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.email IS DISTINCT FROM OLD.email THEN
		RAISE EXCEPTION 'users.email is immutable';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_email_immutable
BEFORE UPDATE OF email ON users
FOR EACH ROW
EXECUTE FUNCTION prevent_users_email_update();
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_source_import_job_id_import_jobs_id_fk" FOREIGN KEY ("source_import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_source_import_job_id_import_jobs_id_fk" FOREIGN KEY ("source_import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_source_import_job_id_import_jobs_id_fk" FOREIGN KEY ("source_import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_building_prices" ADD CONSTRAINT "rate_card_building_prices_rate_card_version_id_rate_card_versions_id_fk" FOREIGN KEY ("rate_card_version_id") REFERENCES "public"."rate_card_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_building_prices" ADD CONSTRAINT "rate_card_building_prices_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_package_buildings" ADD CONSTRAINT "rate_card_package_buildings_rate_card_version_id_rate_card_versions_id_fk" FOREIGN KEY ("rate_card_version_id") REFERENCES "public"."rate_card_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_package_buildings" ADD CONSTRAINT "rate_card_package_buildings_package_id_sales_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."sales_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_package_buildings" ADD CONSTRAINT "rate_card_package_buildings_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_package_configs" ADD CONSTRAINT "rate_card_package_configs_rate_card_version_id_rate_card_versions_id_fk" FOREIGN KEY ("rate_card_version_id") REFERENCES "public"."rate_card_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_package_configs" ADD CONSTRAINT "rate_card_package_configs_package_id_sales_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."sales_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_versions" ADD CONSTRAINT "rate_card_versions_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_versions" ADD CONSTRAINT "rate_card_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_versions" ADD CONSTRAINT "rate_card_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_assignments" ADD CONSTRAINT "sales_assignments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_assignments" ADD CONSTRAINT "sales_assignments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_assignments" ADD CONSTRAINT "sales_assignments_sales_pic_user_id_users_id_fk" FOREIGN KEY ("sales_pic_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_assignments" ADD CONSTRAINT "sales_assignments_source_import_job_id_import_jobs_id_fk" FOREIGN KEY ("source_import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_packages" ADD CONSTRAINT "sales_packages_source_import_job_id_import_jobs_id_fk" FOREIGN KEY ("source_import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_type_entity_id_created_at_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "import_errors_import_job_id_row_number_idx" ON "import_errors" USING btree ("import_job_id","row_number");--> statement-breakpoint
CREATE INDEX "import_jobs_state_created_at_idx" ON "import_jobs" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_data_type_published_at_idx" ON "import_jobs" USING btree ("data_type","published_at");
