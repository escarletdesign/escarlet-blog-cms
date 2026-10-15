-- Product-facing configuration. Technical sites are retained as the internal
-- compatibility key while the UI calls them brands.
CREATE TABLE IF NOT EXISTS workspace_feature_flags (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS site_feature_flags (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (site_id, key)
);

CREATE TABLE IF NOT EXISTS site_channels (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  connection_status TEXT NOT NULL DEFAULT 'not_connected',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (site_id, channel)
);

CREATE INDEX IF NOT EXISTS site_channels_enabled_idx ON site_channels(site_id, enabled);

CREATE TABLE IF NOT EXISTS channel_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_account_id TEXT,
  credentials_ciphertext TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'connected',
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, channel, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS channel_connections_primary_idx ON channel_connections(site_id, channel) WHERE is_primary;
