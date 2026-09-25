CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  source_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  final_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  cover_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'unknown' CHECK (provider IN ('descript', 'heygen', 'higgsfield', 'runway', 'manual', 'unknown')),
  status TEXT NOT NULL DEFAULT 'raw' CHECK (status IN (
    'raw', 'queued', 'transcribing', 'editing', 'rendering', 'ready_for_review',
    'approved', 'scheduled', 'published', 'failed', 'cancelled'
  )),
  provider_project_id TEXT,
  provider_composition_id TEXT,
  speaker TEXT,
  channel TEXT,
  format TEXT,
  objective TEXT,
  topic TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS video_jobs_workspace_site_status_idx ON video_jobs (workspace_id, site_id, status);
CREATE INDEX IF NOT EXISTS video_jobs_content_item_idx ON video_jobs (content_item_id);
CREATE INDEX IF NOT EXISTS video_jobs_source_media_idx ON video_jobs (source_media_id);
