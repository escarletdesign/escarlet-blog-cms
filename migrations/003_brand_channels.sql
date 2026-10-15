-- Canonical brand capabilities and provider-agnostic channel connections.
-- `sites` and the existing Metricool table remain compatibility adapters.

CREATE TABLE IF NOT EXISTS brand_capabilities (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (site_id, key)
);

ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected';

CREATE INDEX IF NOT EXISTS brand_capabilities_enabled_idx
  ON brand_capabilities(site_id, enabled);

CREATE INDEX IF NOT EXISTS channel_connections_channel_idx
  ON channel_connections(site_id, channel, status);

-- Keep the existing rows useful after the generic connection migration.
UPDATE channel_connections
SET config = COALESCE(config, '{}'::jsonb)
WHERE config IS NULL;
