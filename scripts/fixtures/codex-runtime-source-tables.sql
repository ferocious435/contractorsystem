-- Minimal synthetic source tables used by guarded radar/pricing integration tests.
create table if not exists public.reference_documents(id uuid primary key,contractor_id uuid references public.profiles,project_id uuid references public.projects,title text,status text,reference_type text,source_document_id uuid,text_hash text);
create table if not exists public.reference_document_chunks(id uuid primary key,reference_document_id uuid references public.reference_documents,text text,ordinal integer,chunk_type text,page_from integer,section_code text);
create table if not exists public.reference_document_incorporations(id uuid primary key,project_id uuid references public.projects,reference_document_id uuid references public.reference_documents,incorporated_by_document_id uuid references public.documents,quote text,status text);
create table if not exists public.pricelists(id uuid primary key,contractor_id uuid references public.profiles,project_id uuid references public.projects,is_global boolean default false,name text,status text);
create table if not exists public.pricelist_items(id uuid primary key,pricelist_id uuid references public.pricelists,description text,unit_price numeric);
alter table public.pricing_ledger add column if not exists contradiction_id uuid;
alter table public.documents add column if not exists category text,add column if not exists doc_type text,add column if not exists storage_path text,add column if not exists storage_bucket text,add column if not exists file_url text,add column if not exists created_at timestamptz;
create table if not exists public.vo_letters(id uuid primary key,project_id uuid references public.projects,status text);
create table if not exists public.vo_letter_items(id uuid primary key,letter_id uuid references public.vo_letters,ledger_item_id uuid references public.pricing_ledger);
alter table public.vo_letters enable row level security;
alter table public.vo_letter_items enable row level security;
grant all on public.vo_letters,public.vo_letter_items to service_role;
alter table public.reference_documents enable row level security;
alter table public.reference_document_chunks enable row level security;
alter table public.reference_document_incorporations enable row level security;
alter table public.pricelists enable row level security;
alter table public.pricelist_items enable row level security;
grant all on public.reference_documents,public.reference_document_chunks,public.reference_document_incorporations,public.pricelists,public.pricelist_items to service_role;
