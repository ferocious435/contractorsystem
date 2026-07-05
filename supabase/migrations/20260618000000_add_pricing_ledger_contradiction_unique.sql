-- Prevent duplicate variation rows when concurrent AI/manual actions price the same contradiction.
-- PostgreSQL allows multiple NULL values, so manual rows without contradiction_id are unaffected.
WITH duplicate_contradiction_rows AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, contradiction_id
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM public.pricing_ledger
  WHERE contradiction_id IS NOT NULL
)
UPDATE public.pricing_ledger AS ledger
SET contradiction_id = NULL
FROM duplicate_contradiction_rows AS duplicates
WHERE ledger.id = duplicates.id
  AND duplicates.duplicate_rank > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pricing_ledger_project_contradiction_unique'
      AND conrelid = 'public.pricing_ledger'::regclass
  ) THEN
    ALTER TABLE public.pricing_ledger
      ADD CONSTRAINT pricing_ledger_project_contradiction_unique
      UNIQUE (project_id, contradiction_id);
  END IF;
END $$;
