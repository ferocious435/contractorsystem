-- Query-path indexes for large BOQ and pricing queue screens.
-- These match the project pricing ledger read paths without changing financial data.

CREATE INDEX IF NOT EXISTS idx_pricing_ledger_project_created_at
  ON public.pricing_ledger(project_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_contradictions_project_status_created_at
  ON public.contradictions(project_id, status, created_at DESC)
  WHERE status IN ('OPEN', 'MOVED_TO_PRICING');

CREATE INDEX IF NOT EXISTS idx_contradictions_project_id_id
  ON public.contradictions(project_id, id);
