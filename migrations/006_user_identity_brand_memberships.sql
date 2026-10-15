-- Canonical user identity and per-brand membership roles.
-- Legacy users.json and site/agency credentials remain compatibility adapters
-- during the cutover, but new authorization is derived from these tables.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  must_set_password BOOLEAN NOT NULL DEFAULT FALSE,
  allow_publishing_as BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspace_member_sites
  ADD COLUMN IF NOT EXISTS role TEXT;

UPDATE workspace_member_sites wms
SET role = COALESCE(wms.role, wm.role, 'viewer')
FROM workspace_members wm
WHERE wm.id = wms.member_id;

ALTER TABLE workspace_member_sites
  ALTER COLUMN role SET DEFAULT 'viewer';

ALTER TABLE workspace_member_sites
  ALTER COLUMN role SET NOT NULL;

ALTER TABLE workspace_member_sites
  DROP CONSTRAINT IF EXISTS workspace_member_sites_role_check;

ALTER TABLE workspace_member_sites
  ADD CONSTRAINT workspace_member_sites_role_check
  CHECK (role IN ('owner', 'admin', 'editor', 'author', 'viewer'));

CREATE INDEX IF NOT EXISTS workspace_member_sites_site_role_idx
  ON workspace_member_sites(site_id, role);

CREATE INDEX IF NOT EXISTS tokens_user_revocation_idx
  ON tokens(user_id, revoked_at);

DELETE FROM brand_capabilities WHERE key = 'brand_kit_access';
