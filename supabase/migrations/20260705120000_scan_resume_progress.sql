-- Persist contradiction-radar progress so scans can be resumed after navigation,
-- tab throttling, connection loss, or a failed long request.

ALTER TABLE public.document_scan_state
  ADD COLUMN IF NOT EXISTS total_work_docs INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_work_docs INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_step TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_document_scan_state_project_status
  ON public.document_scan_state(project_id, status);

CREATE INDEX IF NOT EXISTS idx_document_scan_state_project_updated_at
  ON public.document_scan_state(project_id, updated_at DESC);
