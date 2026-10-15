-- Buffer is stored as one aggregate connection. Remove the pre-aggregate
-- per-channel rows so they cannot reappear after a deployment.
DELETE FROM channel_connections
WHERE provider='buffer' AND channel<>'buffer';
