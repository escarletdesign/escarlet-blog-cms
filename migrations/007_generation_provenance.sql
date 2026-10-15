CREATE TABLE IF NOT EXISTS image_generation_preparations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  site TEXT NOT NULL,
  brand_kit_version_id TEXT NOT NULL,
  brand_kit_snapshot_hash TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  route TEXT NOT NULL,
  expected_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  state TEXT NOT NULL CHECK (state IN ('blocked', 'ready', 'receipted', 'consumed')),
  item_id TEXT,
  batch_id TEXT,
  channel TEXT,
  expected_asset_count INTEGER NOT NULL DEFAULT 1 CHECK (expected_asset_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS image_generation_preparations_site_idx ON image_generation_preparations(site, created_at DESC);

CREATE TABLE IF NOT EXISTS generation_receipts (
  id TEXT PRIMARY KEY,
  preparation_id TEXT NOT NULL REFERENCES image_generation_preparations(id) ON DELETE RESTRICT,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  site TEXT NOT NULL,
  brand_kit_version_id TEXT NOT NULL,
  brand_kit_snapshot_hash TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  route TEXT NOT NULL,
  resolved_reference_ids TEXT[] NOT NULL DEFAULT '{}',
  resolved_reference_hashes TEXT[] NOT NULL DEFAULT '{}',
  reference_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  preparation_state TEXT NOT NULL,
  generated_result_id TEXT NOT NULL,
  generated_file_hash TEXT NOT NULL,
  item_id TEXT,
  batch_id TEXT,
  channel TEXT,
  status TEXT NOT NULL CHECK (status IN ('issued', 'consumed', 'revoked')) DEFAULT 'issued',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS generation_receipts_site_idx ON generation_receipts(site, issued_at DESC);
CREATE INDEX IF NOT EXISTS generation_receipts_preparation_idx ON generation_receipts(preparation_id);
