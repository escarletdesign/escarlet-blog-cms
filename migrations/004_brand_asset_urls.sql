-- Brand-kit reference images may expose a stable public URL when the asset is
-- allowed for the current role. Keep it nullable: a brand can use private
-- files or text-only guidance without configuring a website or public URL.
ALTER TABLE brand_assets
  ADD COLUMN IF NOT EXISTS public_url TEXT;
