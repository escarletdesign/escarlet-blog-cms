-- Instagram Stories use the same connected Instagram account as feed posts.
INSERT INTO site_channels (site_id, channel, enabled, connection_status)
SELECT site_id, 'instagram_story', enabled, connection_status
FROM site_channels
WHERE channel = 'instagram'
ON CONFLICT (site_id, channel) DO NOTHING;
