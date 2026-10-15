-- Keep workspace_id and site_id from drifting apart on new writes.
-- Existing rows are left in place for an explicit data repair migration.
CREATE UNIQUE INDEX IF NOT EXISTS sites_id_workspace_uq
  ON sites (id, workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS content_batches_id_workspace_uq
  ON content_batches (id, workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS content_items_id_workspace_uq
  ON content_items (id, workspace_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_batches_site_workspace_fk') THEN
    ALTER TABLE content_batches
      ADD CONSTRAINT content_batches_site_workspace_fk
      FOREIGN KEY (site_id, workspace_id) REFERENCES sites (id, workspace_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_items_site_workspace_fk') THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_site_workspace_fk
      FOREIGN KEY (site_id, workspace_id) REFERENCES sites (id, workspace_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_items_batch_workspace_fk') THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_batch_workspace_fk
      FOREIGN KEY (batch_id, workspace_id) REFERENCES content_batches (id, workspace_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_variants_item_workspace_fk') THEN
    ALTER TABLE content_variants
      ADD CONSTRAINT content_variants_item_workspace_fk
      FOREIGN KEY (item_id, workspace_id) REFERENCES content_items (id, workspace_id) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS content_items_scope_created_idx
  ON content_items (workspace_id, site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_scope_created_idx
  ON media_assets (workspace_id, site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_scope_created_idx
  ON audit_log (workspace_id, site_id, created_at DESC);
