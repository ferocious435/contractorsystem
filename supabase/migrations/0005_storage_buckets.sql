insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Access to Documents' AND tablename = 'objects' AND schemaname = 'storage') THEN
        CREATE POLICY "Public Access to Documents" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload documents' AND tablename = 'objects' AND schemaname = 'storage') THEN
        CREATE POLICY "Authenticated users can upload documents" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update their own documents' AND tablename = 'objects' AND schemaname = 'storage') THEN
        CREATE POLICY "Users can update their own documents" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents' AND auth.uid() = owner) WITH CHECK (bucket_id = 'documents' AND auth.uid() = owner);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete their own documents' AND tablename = 'objects' AND schemaname = 'storage') THEN
        CREATE POLICY "Users can delete their own documents" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents' AND auth.uid() = owner);
    END IF;
END
$$;
