ALTER TABLE video_jobs DROP CONSTRAINT IF EXISTS video_jobs_status_check;

ALTER TABLE video_jobs ADD CONSTRAINT video_jobs_status_check CHECK (status IN (
  'raw', 'queued', 'transcribing', 'editing', 'rendering', 'ready_for_review',
  'approved', 'scheduled', 'published', 'failed', 'cancelled', 'awaiting_provider'
));

CREATE INDEX IF NOT EXISTS video_jobs_motion_queue_idx
  ON video_jobs (workspace_id, status, updated_at)
  WHERE status IN ('queued', 'awaiting_provider');
