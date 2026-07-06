-- Prevent repeated paid AI scans for unchanged documents and document pairs.

ALTER TYPE contradiction_status ADD VALUE IF NOT EXISTS 'ARCHIVED';

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR,
  ADD COLUMN IF NOT EXISTS extracted_text_hash VARCHAR,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE contradictions
  ADD COLUMN IF NOT EXISTS scan_signature VARCHAR;

CREATE TABLE IF NOT EXISTS document_scan_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  contract_doc_ids TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  work_doc_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  contract_signature VARCHAR NOT NULL,
  work_signature VARCHAR NOT NULL,
  scan_signature VARCHAR NOT NULL UNIQUE,
  status VARCHAR DEFAULT 'COMPLETED',
  findings_count INT DEFAULT 0,
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE document_scan_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access document_scan_state for their projects" ON document_scan_state;
CREATE POLICY "Users can access document_scan_state for their projects" ON document_scan_state
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE contractor_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_extracted_text_hash ON documents(extracted_text_hash);
CREATE INDEX IF NOT EXISTS idx_contradictions_scan_signature ON contradictions(scan_signature);
CREATE INDEX IF NOT EXISTS idx_document_scan_state_project_id ON document_scan_state(project_id);
CREATE INDEX IF NOT EXISTS idx_document_scan_state_work_doc_id ON document_scan_state(work_doc_id);
