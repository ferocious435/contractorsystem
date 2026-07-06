-- Remove the temporary reference-library backfill helper.

DROP FUNCTION IF EXISTS public.codex_reference_chunk_batch(TEXT, UUID, JSONB);

NOTIFY pgrst, 'reload schema';
