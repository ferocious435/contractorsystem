-- Codex transition hardening: align database schema with Pricing Ledger,
-- Evidence Linkage, VO letters, and current Gemini 3 workflow.

ALTER TYPE document_category ADD VALUE IF NOT EXISTS 'BOQ';
ALTER TYPE document_category ADD VALUE IF NOT EXISTS 'SPECS';
ALTER TYPE document_category ADD VALUE IF NOT EXISTS 'SITE_REPORT';

ALTER TYPE ledger_item_source ADD VALUE IF NOT EXISTS 'CONTRACTOR';
ALTER TYPE ledger_item_type ADD VALUE IF NOT EXISTS 'SENT_VO';

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS ocr_status VARCHAR DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS immutable_code VARCHAR,
  ADD COLUMN IF NOT EXISTS evidence_index VARCHAR;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS location VARCHAR,
  ADD COLUMN IF NOT EXISTS contractor_name VARCHAR;

ALTER TABLE contradictions
  ADD COLUMN IF NOT EXISTS category VARCHAR,
  ADD COLUMN IF NOT EXISTS evidence_data JSONB DEFAULT '{}'::jsonb;

ALTER TABLE pricing_ledger
  ADD COLUMN IF NOT EXISTS ai_rationale TEXT,
  ADD COLUMN IF NOT EXISTS governing_notes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expert_strategy JSONB,
  ADD COLUMN IF NOT EXISTS evidence_data JSONB DEFAULT '[]'::jsonb;

UPDATE pricing_ledger
SET vat_rate = 0.18
WHERE vat_rate IS NULL OR vat_rate <> 0.18;

CREATE TABLE IF NOT EXISTS vo_letters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  letter_number VARCHAR NOT NULL,
  subject TEXT NOT NULL,
  recipient_name TEXT,
  status VARCHAR DEFAULT 'DRAFT',
  content TEXT,
  total_amount_excl_vat DECIMAL(15, 2) DEFAULT 0,
  vat_amount DECIMAL(15, 2) DEFAULT 0,
  total_amount_incl_vat DECIMAL(15, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vo_letter_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  letter_id UUID REFERENCES vo_letters(id) ON DELETE CASCADE NOT NULL,
  ledger_item_id UUID REFERENCES pricing_ledger(id) ON DELETE CASCADE NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE vo_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE vo_letter_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access vo_letters for their projects" ON vo_letters;
CREATE POLICY "Users can access vo_letters for their projects" ON vo_letters
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE contractor_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can access vo_letter_items for their projects" ON vo_letter_items;
CREATE POLICY "Users can access vo_letter_items for their projects" ON vo_letter_items
  FOR ALL USING (
    letter_id IN (
      SELECT vl.id
      FROM vo_letters vl
      JOIN projects p ON p.id = vl.project_id
      WHERE p.contractor_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_vo_letters_project_id ON vo_letters(project_id);
CREATE INDEX IF NOT EXISTS idx_vo_letter_items_letter_id ON vo_letter_items(letter_id);
CREATE INDEX IF NOT EXISTS idx_pricing_ledger_contradiction_id ON pricing_ledger(contradiction_id);
