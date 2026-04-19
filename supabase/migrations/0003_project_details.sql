-- Add client_name and budget columns to projects table
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_name VARCHAR,
  ADD COLUMN IF NOT EXISTS budget DECIMAL(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_index INTEGER DEFAULT 0;
