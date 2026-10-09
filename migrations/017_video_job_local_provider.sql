ALTER TABLE video_jobs DROP CONSTRAINT IF EXISTS video_jobs_provider_check;

ALTER TABLE video_jobs ADD CONSTRAINT video_jobs_provider_check CHECK (provider IN (
  'local', 'descript', 'heygen', 'higgsfield', 'runway', 'manual', 'unknown'
));
