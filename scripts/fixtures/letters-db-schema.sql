-- Synthetic only. No production records or credentials are copied here.
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema public,auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create type public.ledger_item_type as enum ('BASE_CONTRACT','PENDING_VO','APPROVED_VO','SENT_VO');
create type public.ledger_item_source as enum ('BOQ','DEKEL','CUSTOM_ANALYSIS');
create table public.projects(id uuid primary key default gen_random_uuid(),name text not null,contractor_id uuid not null,
 client_name text,budget numeric default 0,contractor_name text,created_at timestamptz default now());
create table public.documents(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects,
 title text,extracted_text text,parsed_json jsonb,ocr_status text,content_hash text,extracted_text_hash text,
 storage_path text,file_url text,deleted_at timestamptz,version integer,created_at timestamptz default now());
create table public.contradictions(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects,
 title text,status text,source_execution_doc_id uuid references public.documents,target_contract_doc_id uuid references public.documents,
 evidence_data jsonb,created_at timestamptz default now());
create table public.pricing_ledger(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects,
 type public.ledger_item_type default 'BASE_CONTRACT',source public.ledger_item_source default 'BOQ',item_code text,description text,unit text,
 quantity numeric(12,2) default 0,unit_price_excl_vat numeric(15,2) default 0,total_price_excl_vat numeric,
 vat_rate numeric(5,4) not null default .18,markup_percentage numeric(5,4) default 0,
 contradiction_id uuid references public.contradictions,ai_rationale text,governing_notes jsonb,expert_strategy jsonb,
 evidence_data jsonb default '[]',created_at timestamptz default now());
create table public.vo_letters(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects on delete cascade,
 letter_number text not null,recipient_name text,recipient_role text,subject text not null,status text default 'DRAFT',content text,
 total_amount_excl_vat numeric default 0,vat_rate numeric not null default .18 check(vat_rate=.18),
 created_at timestamptz default now(),updated_at timestamptz default now());
create table public.vo_letter_items(id uuid primary key default gen_random_uuid(),letter_id uuid references public.vo_letters on delete cascade,
 ledger_item_id uuid references public.pricing_ledger on delete cascade,sort_order integer default 0,unique(letter_id,ledger_item_id));
alter table public.projects enable row level security;
alter table public.documents enable row level security;
alter table public.contradictions enable row level security;
alter table public.pricing_ledger enable row level security;
alter table public.vo_letters enable row level security;
alter table public.vo_letter_items enable row level security;
create policy owner_projects on public.projects for all using(contractor_id=auth.uid()) with check(contractor_id=auth.uid());
create policy owner_documents on public.documents for all using(project_id in(select id from public.projects where contractor_id=auth.uid()));
create policy owner_contradictions on public.contradictions for all using(project_id in(select id from public.projects where contractor_id=auth.uid()));
create policy owner_ledger on public.pricing_ledger for all using(project_id in(select id from public.projects where contractor_id=auth.uid()));
create policy owner_letters on public.vo_letters for all to authenticated using(project_id in(select id from public.projects where contractor_id=auth.uid()));
create policy owner_links on public.vo_letter_items for all to authenticated using(letter_id in(select id from public.vo_letters));
grant select,insert,update,delete on all tables in schema public to authenticated,anon;
