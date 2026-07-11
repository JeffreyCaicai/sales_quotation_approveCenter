CREATE FUNCTION normalize_building_controlled_value()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.field := regexp_replace(NEW.field, '^\s+|\s+$', '', 'g');
  NEW.value := regexp_replace(NEW.value, '^\s+|\s+$', '', 'g');
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER normalize_building_controlled_value_trigger
BEFORE INSERT OR UPDATE ON building_controlled_values
FOR EACH ROW
EXECUTE FUNCTION normalize_building_controlled_value();--> statement-breakpoint
ALTER TABLE "building_controlled_values" ADD CONSTRAINT "building_controlled_values_value_trimmed_check" CHECK ("value" = regexp_replace("value", '^\s+|\s+$', '', 'g'));
