ALTER TABLE "rate_card_versions" ADD CONSTRAINT "rate_card_versions_currency_idr_check" CHECK ("rate_card_versions"."currency" = 'IDR');
--> statement-breakpoint
CREATE FUNCTION protect_published_rate_card_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status IN ('published', 'active', 'superseded', 'rolled_back') THEN
			RAISE EXCEPTION 'published rate card version cannot be deleted';
		END IF;
		RETURN OLD;
	END IF;

	IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
		(OLD.status = 'draft' AND NEW.status IN ('published', 'rolled_back')) OR
		(OLD.status = 'published' AND NEW.status IN ('active', 'rolled_back')) OR
		(OLD.status = 'active' AND NEW.status IN ('superseded', 'rolled_back')) OR
		(OLD.status = 'superseded' AND NEW.status = 'active')
	) THEN
		RAISE EXCEPTION 'invalid rate card lifecycle transition: % -> %', OLD.status, NEW.status;
	END IF;

	IF OLD.status IN ('published', 'active', 'superseded', 'rolled_back') AND (
		NEW.id IS DISTINCT FROM OLD.id OR
		NEW.version_code IS DISTINCT FROM OLD.version_code OR
		NEW.effective_at IS DISTINCT FROM OLD.effective_at OR
		NEW.currency IS DISTINCT FROM OLD.currency OR
		NEW.import_job_id IS DISTINCT FROM OLD.import_job_id OR
		NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR
		NEW.published_by IS DISTINCT FROM OLD.published_by OR
		NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at OR
		NEW.created_at IS DISTINCT FROM OLD.created_at
	) THEN
		RAISE EXCEPTION 'published rate card version business fields are immutable';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_published_rate_card_version_trigger
BEFORE UPDATE OR DELETE ON rate_card_versions
FOR EACH ROW
EXECUTE FUNCTION protect_published_rate_card_version();
--> statement-breakpoint
CREATE FUNCTION protect_published_rate_card_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	parent_status import_state;
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		SELECT status INTO parent_status
		FROM rate_card_versions
		WHERE id = OLD.rate_card_version_id;
		IF parent_status IN ('published', 'active', 'superseded', 'rolled_back') THEN
			RAISE EXCEPTION 'published rate card child rows are immutable';
		END IF;
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT status INTO parent_status
		FROM rate_card_versions
		WHERE id = NEW.rate_card_version_id;
		IF parent_status IN ('published', 'active', 'superseded', 'rolled_back') THEN
			RAISE EXCEPTION 'published rate card child rows are immutable';
		END IF;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_published_rate_card_building_prices_trigger
BEFORE INSERT OR UPDATE OR DELETE ON rate_card_building_prices
FOR EACH ROW
EXECUTE FUNCTION protect_published_rate_card_child();
--> statement-breakpoint
CREATE TRIGGER protect_published_rate_card_package_configs_trigger
BEFORE INSERT OR UPDATE OR DELETE ON rate_card_package_configs
FOR EACH ROW
EXECUTE FUNCTION protect_published_rate_card_child();
--> statement-breakpoint
CREATE TRIGGER protect_published_rate_card_package_buildings_trigger
BEFORE INSERT OR UPDATE OR DELETE ON rate_card_package_buildings
FOR EACH ROW
EXECUTE FUNCTION protect_published_rate_card_child();
