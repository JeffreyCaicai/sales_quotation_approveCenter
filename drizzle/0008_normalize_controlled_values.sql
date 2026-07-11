DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM building_controlled_values
    WHERE regexp_replace(value, '^\s+|\s+$', '', 'g') = ''
  ) THEN
    RAISE EXCEPTION 'controlled value normalization produced a blank code';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        regexp_replace(field, '^\s+|\s+$', '', 'g') AS normalized_field,
        regexp_replace(value, '^\s+|\s+$', '', 'g') AS normalized_value
      FROM building_controlled_values
      GROUP BY 1, 2
      HAVING count(*) > 1
    ) collisions
  ) THEN
    RAISE EXCEPTION 'controlled value normalization collision';
  END IF;
END;
$$;--> statement-breakpoint
UPDATE building_controlled_values
SET
  field = regexp_replace(field, '^\s+|\s+$', '', 'g'),
  value = regexp_replace(value, '^\s+|\s+$', '', 'g');--> statement-breakpoint
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
