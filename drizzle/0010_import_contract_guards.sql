ALTER TYPE "public"."import_state" ADD VALUE IF NOT EXISTS 'processing_failed';--> statement-breakpoint
ALTER TYPE "public"."import_state" ADD VALUE IF NOT EXISTS 'reprocess_required';--> statement-breakpoint
ALTER TABLE "buildings" DROP CONSTRAINT IF EXISTS "buildings_address_not_blank_check";--> statement-breakpoint
ALTER TABLE "buildings" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_card_building_prices"
  ADD CONSTRAINT "rate_card_building_prices_price_nonnegative_check"
  CHECK (price_idr BETWEEN 0 AND 999999999999999999);--> statement-breakpoint
ALTER TABLE "rate_card_package_configs"
  ADD CONSTRAINT "rate_card_package_configs_price_nonnegative_check"
  CHECK (price_idr BETWEEN 0 AND 999999999999999999);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales_packages
    WHERE regexp_replace(package_code, '^\s+|\s+$', '', 'g') = ''
       OR package_code <> regexp_replace(package_code, '^\s+|\s+$', '', 'g')
  ) THEN
    RAISE EXCEPTION 'Package Code reconciliation is required before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM sales_packages WHERE regexp_replace(name, '^\s+|\s+$', '', 'g') = '') THEN
    RAISE EXCEPTION 'Package name normalization produced a blank name';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM sales_packages
    GROUP BY lower(regexp_replace(name, '^\s+|\s+$', '', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Package name normalization collision';
  END IF;
END;
$$;--> statement-breakpoint
UPDATE sales_packages SET name = regexp_replace(name, '^\s+|\s+$', '', 'g');--> statement-breakpoint
ALTER TABLE "sales_packages"
  ADD CONSTRAINT "sales_packages_package_code_not_blank_check"
  CHECK (regexp_replace(package_code, '^\s+|\s+$', '', 'g') <> '');--> statement-breakpoint
ALTER TABLE "sales_packages"
  ADD CONSTRAINT "sales_packages_package_code_trimmed_check"
  CHECK (package_code = regexp_replace(package_code, '^\s+|\s+$', '', 'g'));--> statement-breakpoint
ALTER TABLE "sales_packages"
  ADD CONSTRAINT "sales_packages_name_not_blank_check"
  CHECK (regexp_replace(name, '^\s+|\s+$', '', 'g') <> '');--> statement-breakpoint
ALTER TABLE "sales_packages"
  ADD CONSTRAINT "sales_packages_name_trimmed_check"
  CHECK (name = regexp_replace(name, '^\s+|\s+$', '', 'g'));--> statement-breakpoint
CREATE UNIQUE INDEX "sales_packages_normalized_name_unique"
  ON "sales_packages" (lower(regexp_replace(name, '^\s+|\s+$', '', 'g')));--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_sales_package_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Packages cannot be deleted; set status to inactive instead';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Package UUID is immutable';
  END IF;
  IF NEW.package_code IS DISTINCT FROM OLD.package_code THEN
    RAISE EXCEPTION 'Package Code is immutable';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'Package Name is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER protect_sales_package_identity_trigger
BEFORE UPDATE OR DELETE ON sales_packages
FOR EACH ROW
EXECUTE FUNCTION protect_sales_package_identity();
