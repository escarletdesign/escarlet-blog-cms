-- Imported reference images are visual guidance, not private credentials.
-- Keep the scope narrow so unrelated private brand assets remain private.
UPDATE brand_assets
SET visibility = 'role_limited'
WHERE visibility = 'private'
  AND storage_key ~* '^media/[^/]+/reference/[^/]+[.](png|jpe?g|webp|gif|svg)$';
