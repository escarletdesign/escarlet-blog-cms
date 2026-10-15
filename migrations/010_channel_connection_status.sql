-- Older installations created channel_connections before the provider status
-- column was introduced. Keep those databases compatible with the v2 worker.
ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS status TEXT;

UPDATE channel_connections
SET status = 'connected'
WHERE status IS NULL;

ALTER TABLE channel_connections
  ALTER COLUMN status SET DEFAULT 'connected',
  ALTER COLUMN status SET NOT NULL;

CREATE INDEX IF NOT EXISTS channel_connections_status_idx
  ON channel_connections(site_id, channel, status);
