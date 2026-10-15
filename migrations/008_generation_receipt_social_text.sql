ALTER TABLE generation_receipts
  ADD COLUMN IF NOT EXISTS social_text JSONB;
