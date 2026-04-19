-- Add missing statuses to ai_parsing_status
ALTER TYPE ai_parsing_status ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE ai_parsing_status ADD VALUE IF NOT EXISTS 'DONE';
ALTER TYPE ai_parsing_status ADD VALUE IF NOT EXISTS 'VALIDATED';

-- Add parsed_json column to documents table to store OCR/Vision results
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS parsed_json JSONB;
