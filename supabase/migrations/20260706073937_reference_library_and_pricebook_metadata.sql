-- Reference-library and richer pricebook metadata.
-- Keeps state/standard documents outside the ordinary project contract list.

CREATE TABLE IF NOT EXISTS public.reference_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'BLUE_BOOK',
    'SHELF_CONTRACT_3210',
    'ISRAELI_STANDARD',
    'OTHER_REFERENCE'
  )),
  authority_scope TEXT NOT NULL DEFAULT 'REFERENCE_ONLY' CHECK (authority_scope IN (
    'REFERENCE_ONLY',
    'PROJECT_INCORPORATED',
    'GLOBAL_STANDARD'
  )),
  title TEXT NOT NULL,
  publisher TEXT,
  version_label TEXT,
  source_file_name TEXT,
  storage_bucket TEXT,
  storage_path TEXT,
  local_source_path TEXT,
  content_hash TEXT,
  text_hash TEXT,
  page_count INT DEFAULT 0,
  parser_version TEXT NOT NULL DEFAULT 'reference-parser-v1',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',
    'PROCESSING',
    'READY',
    'ERROR'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reference_document_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_document_id UUID REFERENCES public.reference_documents(id) ON DELETE CASCADE NOT NULL,
  parent_chunk_id UUID REFERENCES public.reference_document_chunks(id) ON DELETE SET NULL,
  chunk_type TEXT NOT NULL DEFAULT 'PAGE' CHECK (chunk_type IN (
    'DOCUMENT',
    'CHAPTER',
    'SECTION',
    'CLAUSE',
    'PAGE',
    'NOTE',
    'APPENDIX'
  )),
  section_code TEXT,
  title TEXT,
  page_from INT,
  page_to INT,
  ordinal INT NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  text_hash TEXT,
  token_estimate INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(section_code, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(text, '')
    )
  ) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reference_document_incorporations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  reference_document_id UUID REFERENCES public.reference_documents(id) ON DELETE CASCADE NOT NULL,
  incorporated_by_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  clause_reference TEXT,
  quote TEXT,
  scope_text TEXT,
  status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN (
    'CANDIDATE',
    'CONFIRMED',
    'REJECTED',
    'NEEDS_REVIEW'
  )),
  confidence NUMERIC(5, 4) DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reference_ingest_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  reference_document_id UUID REFERENCES public.reference_documents(id) ON DELETE CASCADE,
  job_signature TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'ERROR',
    'PAUSED'
  )),
  total_units INT NOT NULL DEFAULT 0,
  processed_units INT NOT NULL DEFAULT 0,
  current_step TEXT,
  resume_cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.pricelist_item_note_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pricelist_id UUID REFERENCES public.pricelists(id) ON DELETE CASCADE NOT NULL,
  note_item_id UUID REFERENCES public.pricelist_items(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES public.pricelist_items(id) ON DELETE CASCADE,
  scope_prefix TEXT,
  relation_type TEXT NOT NULL DEFAULT 'GOVERNS' CHECK (relation_type IN (
    'GOVERNS',
    'INFORMS',
    'EXCLUDES',
    'NEEDS_REVIEW'
  )),
  confidence NUMERIC(5, 4) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.pricelists
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_reference_document_id UUID REFERENCES public.reference_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version_label TEXT,
  ADD COLUMN IF NOT EXISTS publisher TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS parser_version TEXT,
  ADD COLUMN IF NOT EXISTS parse_status TEXT DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS source_storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS source_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS intro_text TEXT,
  ADD COLUMN IF NOT EXISTS outro_text TEXT,
  ADD COLUMN IF NOT EXISTS terms_text TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE public.pricelist_items
  ADD COLUMN IF NOT EXISTS parent_item_id UUID REFERENCES public.pricelist_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hierarchy_path TEXT,
  ADD COLUMN IF NOT EXISTS page_number INT,
  ADD COLUMN IF NOT EXISTS sort_order INT,
  ADD COLUMN IF NOT EXISTS source_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_row JSONB;

ALTER TABLE public.reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_document_incorporations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricelist_item_note_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access their reference documents" ON public.reference_documents;
CREATE POLICY "Users can access their reference documents" ON public.reference_documents
  FOR ALL TO authenticated
  USING (contractor_id = (SELECT auth.uid()) OR public.is_super_admin())
  WITH CHECK (contractor_id = (SELECT auth.uid()) OR public.is_super_admin());

DROP POLICY IF EXISTS "Users can access their reference chunks" ON public.reference_document_chunks;
CREATE POLICY "Users can access their reference chunks" ON public.reference_document_chunks
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.reference_documents rd
      WHERE rd.id = reference_document_id
        AND (rd.contractor_id = (SELECT auth.uid()) OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.reference_documents rd
      WHERE rd.id = reference_document_id
        AND (rd.contractor_id = (SELECT auth.uid()) OR public.is_super_admin())
    )
  );

DROP POLICY IF EXISTS "Users can access their reference incorporations" ON public.reference_document_incorporations;
CREATE POLICY "Users can access their reference incorporations" ON public.reference_document_incorporations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_id
        AND (p.contractor_id = (SELECT auth.uid()) OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_id
        AND (p.contractor_id = (SELECT auth.uid()) OR public.is_super_admin())
    )
  );

DROP POLICY IF EXISTS "Users can access their reference ingest jobs" ON public.reference_ingest_jobs;
CREATE POLICY "Users can access their reference ingest jobs" ON public.reference_ingest_jobs
  FOR ALL TO authenticated
  USING (contractor_id = (SELECT auth.uid()) OR public.is_super_admin())
  WITH CHECK (contractor_id = (SELECT auth.uid()) OR public.is_super_admin());

DROP POLICY IF EXISTS "Users can access their pricelist note links" ON public.pricelist_item_note_links;
CREATE POLICY "Users can access their pricelist note links" ON public.pricelist_item_note_links
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.pricelists p
      WHERE p.id = pricelist_id
        AND (
          p.contractor_id = (SELECT auth.uid())
          OR p.is_global = true
          OR public.is_super_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.pricelists p
      WHERE p.id = pricelist_id
        AND (p.contractor_id = (SELECT auth.uid()) OR public.is_super_admin())
    )
  );

CREATE INDEX IF NOT EXISTS idx_reference_documents_project_type
  ON public.reference_documents(project_id, reference_type);

CREATE INDEX IF NOT EXISTS idx_reference_documents_contractor
  ON public.reference_documents(contractor_id);

CREATE INDEX IF NOT EXISTS idx_reference_documents_content_hash
  ON public.reference_documents(content_hash);

CREATE INDEX IF NOT EXISTS idx_reference_document_chunks_document_ordinal
  ON public.reference_document_chunks(reference_document_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_reference_document_chunks_section
  ON public.reference_document_chunks(reference_document_id, section_code);

CREATE INDEX IF NOT EXISTS idx_reference_document_chunks_search
  ON public.reference_document_chunks USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_reference_incorporations_project
  ON public.reference_document_incorporations(project_id, status);

CREATE INDEX IF NOT EXISTS idx_reference_ingest_jobs_project_status
  ON public.reference_ingest_jobs(project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricelist_items_hierarchy_path
  ON public.pricelist_items(pricelist_id, hierarchy_path);

CREATE INDEX IF NOT EXISTS idx_pricelist_items_page_number
  ON public.pricelist_items(pricelist_id, page_number);

CREATE INDEX IF NOT EXISTS idx_pricelist_item_note_links_pricelist
  ON public.pricelist_item_note_links(pricelist_id, scope_prefix);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.reference_documents,
  public.reference_document_chunks,
  public.reference_document_incorporations,
  public.reference_ingest_jobs,
  public.pricelist_item_note_links
TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.reference_documents,
  public.reference_document_chunks,
  public.reference_document_incorporations,
  public.reference_ingest_jobs,
  public.pricelist_item_note_links
TO service_role;
