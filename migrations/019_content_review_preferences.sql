ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS review_required BOOLEAN;
