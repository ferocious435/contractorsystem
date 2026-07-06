-- Temporary helper used during the 2026-07-06 reference-library backfill.
-- The following migration drops this function; it must not remain available.

CREATE OR REPLACE FUNCTION public.codex_reference_chunk_batch(
  _token TEXT,
  _reference_document_id UUID,
  _chunks JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _token <> 'disabled-after-backfill' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.reference_document_chunks (
    reference_document_id,
    chunk_type,
    section_code,
    title,
    page_from,
    page_to,
    ordinal,
    text,
    text_hash,
    token_estimate,
    metadata
  )
  SELECT
    _reference_document_id,
    COALESCE(x.chunk_type, 'PAGE'),
    x.section_code,
    x.title,
    x.page_from,
    x.page_to,
    COALESCE(x.ordinal, 0),
    x.text,
    x.text_hash,
    COALESCE(x.token_estimate, 0),
    COALESCE(x.metadata, '{}'::jsonb)
  FROM jsonb_to_recordset(_chunks) AS x(
    chunk_type TEXT,
    section_code TEXT,
    title TEXT,
    page_from INTEGER,
    page_to INTEGER,
    ordinal INTEGER,
    text TEXT,
    text_hash TEXT,
    token_estimate INTEGER,
    metadata JSONB
  );

  RETURN jsonb_array_length(_chunks);
END;
$$;

REVOKE ALL ON FUNCTION public.codex_reference_chunk_batch(TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.codex_reference_chunk_batch(TEXT, UUID, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.codex_reference_chunk_batch(TEXT, UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
