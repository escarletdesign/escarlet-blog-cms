ALTER TABLE brand_kit_versions
  ADD COLUMN IF NOT EXISTS base_version_id TEXT REFERENCES brand_kit_versions(id),
  ADD COLUMN IF NOT EXISTS snapshot_hash TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS brand_kit_versions_idempotency_key_uq
  ON brand_kit_versions (brand_kit_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS brand_kit_versions_lookup_idx
  ON brand_kit_versions (brand_kit_id, status, version DESC);

CREATE OR REPLACE FUNCTION prevent_published_brand_kit_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' AND (
    NEW.brand_kit_id IS DISTINCT FROM OLD.brand_kit_id OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.manifest IS DISTINCT FROM OLD.manifest OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.base_version_id IS DISTINCT FROM OLD.base_version_id OR
    NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
    NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'published brand kit versions are immutable'
      USING ERRCODE = '55000',
            DETAIL = 'Create and publish a new version instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS brand_kit_version_immutable ON brand_kit_versions;
CREATE TRIGGER brand_kit_version_immutable
  BEFORE UPDATE ON brand_kit_versions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_published_brand_kit_version_update();
