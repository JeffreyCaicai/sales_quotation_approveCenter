CREATE OR REPLACE FUNCTION protect_published_rate_card_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	parent_status import_state;
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		SELECT status INTO parent_status
		FROM rate_card_versions
		WHERE id = OLD.rate_card_version_id
		FOR NO KEY UPDATE;
		IF parent_status IN ('published', 'active', 'superseded', 'rolled_back') THEN
			RAISE EXCEPTION 'published rate card child rows are immutable';
		END IF;
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT status INTO parent_status
		FROM rate_card_versions
		WHERE id = NEW.rate_card_version_id
		FOR NO KEY UPDATE;
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
