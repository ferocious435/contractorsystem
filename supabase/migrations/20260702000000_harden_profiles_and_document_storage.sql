-- Harden profile roles and document storage for the Codex MVP security gate.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND NOT public.is_super_admin()
  THEN
    RAISE EXCEPTION 'profile role cannot be changed by this user';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_role_escalation_before_update ON public.profiles;
CREATE TRIGGER prevent_profile_role_escalation_before_update
BEFORE UPDATE OF role ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_role_escalation();

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, company_name) ON public.profiles TO authenticated;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT DEFAULT 'documents',
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

UPDATE public.documents
SET
  storage_bucket = COALESCE(storage_bucket, 'documents'),
  storage_path = COALESCE(
    storage_path,
    NULLIF(
      regexp_replace(
        COALESCE(file_url, ''),
        '^.*/storage/v1/object/(public|authenticated|sign)/documents/([^?]+).*$',
        '\2'
      ),
      COALESCE(file_url, '')
    )
  )
WHERE storage_path IS NULL
  AND COALESCE(file_url, '') LIKE '%/storage/v1/object/%/documents/%';

UPDATE storage.buckets
SET public = false
WHERE id = 'documents';

DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Access to Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own document objects" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own document objects" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own document objects" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own document objects" ON storage.objects;

CREATE POLICY "Users can read own document objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    owner = auth.uid()
    OR owner_id = auth.uid()::text
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE contractor_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can upload own document objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE contractor_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can update own document objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    owner = auth.uid()
    OR owner_id = auth.uid()::text
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE contractor_id = auth.uid()
    )
  )
)
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE contractor_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can delete own document objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    owner = auth.uid()
    OR owner_id = auth.uid()::text
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects WHERE contractor_id = auth.uid()
    )
  )
);
