-- Create a bucket for storing contractor documents
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

-- Set up security policies for the documents bucket

-- Allow public access to view files (since it's a public bucket, this simplifies fetching the URL for Gemini)
-- If we want strict privacy later, we should use signed URLs, but for MVP public is fine
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'documents' );

-- Allow authenticated users to upload files
create policy "Authenticated users can upload documents"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'documents' );

-- Allow authenticated users to update their own files (or any file they have access to)
create policy "Authenticated users can update documents"
on storage.objects for update
to authenticated
using ( bucket_id = 'documents' );

-- Allow authenticated users to delete documents
create policy "Authenticated users can delete documents"
on storage.objects for delete
to authenticated
using ( bucket_id = 'documents' );
