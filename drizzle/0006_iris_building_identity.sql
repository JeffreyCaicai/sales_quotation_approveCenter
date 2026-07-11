ALTER TABLE "buildings" RENAME COLUMN "building_code" TO "iris_building_id";--> statement-breakpoint
ALTER TABLE "buildings" RENAME COLUMN "category" TO "building_type";--> statement-breakpoint
ALTER TABLE "buildings" RENAME COLUMN "location" TO "address";--> statement-breakpoint
ALTER TABLE "buildings" RENAME CONSTRAINT "buildings_building_code_unique" TO "buildings_iris_building_id_unique";--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "erp_building_id" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "grade_resource" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "cbd_area" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "sub_district" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "erp_link_status" text DEFAULT 'manual_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "data_source" text DEFAULT 'building_team' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_erp_building_id_unique" ON "buildings" USING btree ("erp_building_id") WHERE "buildings"."erp_building_id" is not null;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_erp_link_status_check" CHECK ((
        ("buildings"."erp_building_id" is null and "buildings"."erp_link_status" = 'manual_only') or
        ("buildings"."erp_building_id" is not null and "buildings"."erp_link_status" = 'erp_linked')
      ));--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_data_source_check" CHECK ("buildings"."data_source" in ('building_team', 'erp'));--> statement-breakpoint
CREATE FUNCTION normalize_building_erp_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.erp_building_id := NULLIF(
    regexp_replace(NEW.erp_building_id, '^\s+|\s+$', '', 'g'),
    ''
  );
  NEW.erp_link_status := CASE
    WHEN NEW.erp_building_id IS NULL THEN 'manual_only'
    ELSE 'erp_linked'
  END;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER normalize_building_erp_identity_trigger
BEFORE INSERT OR UPDATE ON buildings
FOR EACH ROW
EXECUTE FUNCTION normalize_building_erp_identity();--> statement-breakpoint
CREATE FUNCTION protect_iris_building_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Buildings cannot be deleted; set status to inactive instead';
  END IF;
  IF NEW.iris_building_id IS DISTINCT FROM OLD.iris_building_id THEN
    RAISE EXCEPTION 'IRIS Building ID is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER protect_iris_building_id_trigger
BEFORE UPDATE OR DELETE ON buildings
FOR EACH ROW
EXECUTE FUNCTION protect_iris_building_id();
