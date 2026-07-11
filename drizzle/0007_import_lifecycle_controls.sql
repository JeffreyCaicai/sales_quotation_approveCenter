ALTER TABLE "buildings" ADD CONSTRAINT "buildings_iris_building_id_not_blank_check" CHECK (regexp_replace("iris_building_id", '\s', '', 'g') <> '');--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_name_not_blank_check" CHECK (regexp_replace("name", '\s', '', 'g') <> '');--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_address_not_blank_check" CHECK (regexp_replace("address", '\s', '', 'g') <> '');--> statement-breakpoint
CREATE TABLE "building_controlled_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_controlled_values_field_value_unique" UNIQUE("field","value"),
	CONSTRAINT "building_controlled_values_field_check" CHECK ("field" in ('building_type', 'grade_resource')),
	CONSTRAINT "building_controlled_values_value_not_blank_check" CHECK (btrim("value") <> '')
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_iris_building_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Buildings cannot be deleted; set status to inactive instead';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Building UUID is immutable';
  END IF;
  IF NEW.iris_building_id IS DISTINCT FROM OLD.iris_building_id THEN
    RAISE EXCEPTION 'IRIS Building ID is immutable';
  END IF;
  RETURN NEW;
END;
$$;
