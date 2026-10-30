-- Synthetic schema only: no production credentials, files or records.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create table public.profiles(id uuid primary key,role varchar not null);
create table public.projects(id uuid primary key,contractor_id uuid not null,name text);
create table public.documents(id uuid primary key,project_id uuid references public.projects,title text,version integer,
 content_hash varchar,extracted_text_hash varchar,extracted_text text,parsed_json jsonb,ai_status text,ocr_status text,processed_at timestamptz,deleted_at timestamptz);
create type public.contradiction_severity as enum ('HIGH','MEDIUM','LOW');
create type public.contradiction_status as enum ('OPEN','IGNORED','MOVED_TO_PRICING','AUTO_RESOLVED','ARCHIVED');
create type public.pricing_item_status as enum ('PENDING','PRICED','REJECTED');
create table public.contradictions(id uuid primary key,project_id uuid references public.projects,title varchar,description text,strategy_advice text,
 severity public.contradiction_severity,status public.contradiction_status,source_execution_doc_id uuid references public.documents,target_contract_doc_id uuid references public.documents,
 related_contradiction_id uuid,pricing_status public.pricing_item_status,evidence_data jsonb,category text,scan_signature varchar,created_at timestamptz default now());
create table public.document_scan_state(id uuid primary key,project_id uuid references public.projects,contract_doc_ids text[] not null default '{}',work_doc_id uuid references public.documents,
 contract_signature varchar,work_signature varchar,scan_signature varchar unique,status varchar,findings_count integer,scanned_at timestamptz,
 total_work_docs integer,processed_work_docs integer,current_step text,error_message text,started_at timestamptz,updated_at timestamptz,completed_at timestamptz);
create table public.pricing_ledger(id uuid primary key,project_id uuid references public.projects,quantity numeric,unit_price_excl_vat numeric,vat_rate numeric,
 ai_rationale text,governing_notes jsonb,expert_strategy jsonb,evidence_data jsonb);
alter table public.projects enable row level security;
create policy owned_projects on public.projects for select to authenticated using(contractor_id=auth.uid());
grant select on public.projects to authenticated;
grant all on all tables in schema public to service_role;
