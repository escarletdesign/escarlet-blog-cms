ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS workflow_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS mutation_idempotency (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, scope, idempotency_key)
);
