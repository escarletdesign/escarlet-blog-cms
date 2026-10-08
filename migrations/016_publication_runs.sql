-- MCP Publisher control plane. This table records the decision and the
-- execution gate separately from provider-specific schedules.
CREATE TABLE IF NOT EXISTS publication_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN (
    'publication.route', 'publication.prepare',
    'publication.schedule', 'publication.publish'
  )),
  publication_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  channel TEXT,
  provider TEXT,
  destination_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'routed', 'ready_for_review', 'scheduled', 'publish_requested',
    'queued', 'running', 'published', 'failed', 'canceled', 'action_required'
  )),
  execution_status TEXT NOT NULL CHECK (execution_status IN (
    'not_started', 'awaiting_human_approval', 'awaiting_provider',
    'queued', 'running', 'published', 'failed', 'canceled'
  )),
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  scheduled_at TIMESTAMPTZ,
  timezone TEXT,
  provider_post_id TEXT,
  provider_status TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_execution BOOLEAN NOT NULL DEFAULT FALSE,
  bundle JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS publication_runs_scope_idx
  ON publication_runs (workspace_id, site_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS publication_runs_publication_idx
  ON publication_runs (workspace_id, publication_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS publication_runs_action_idx
  ON publication_runs (execution_status, scheduled_at, updated_at);
