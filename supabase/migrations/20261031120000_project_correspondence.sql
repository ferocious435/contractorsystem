-- Ordinary project correspondence has no financial row, amount or VAT snapshot.
create table public.project_correspondence (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 client_draft_id uuid not null, revision integer not null check(revision>0),
 status text not null default 'DRAFT' check(status in ('DRAFT','SENT')),
 subject text not null,recipient text not null default '',content text not null,
 source_refs jsonb not null default '[]' check(jsonb_typeof(source_refs)='array'),
 last_operation_id uuid not null,last_request_hash text not null,
 sent_marked_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(project_id,client_draft_id),check((status='SENT')=(sent_marked_at is not null))
);
alter table public.project_correspondence enable row level security;
create policy correspondence_owner on public.project_correspondence for all to authenticated
 using(exists(select 1 from public.projects p where p.id=project_id and p.contractor_id=(select auth.uid())))
 with check(exists(select 1 from public.projects p where p.id=project_id and p.contractor_id=(select auth.uid())));
revoke all on public.project_correspondence from public,anon,authenticated;
grant select,insert,update on public.project_correspondence to authenticated;
grant all on public.project_correspondence to service_role;

create function public.guard_project_correspondence_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(current_setting('contractorsystem.correspondence_write',true),'')<>'1' then raise exception 'Use correspondence workflow' using errcode='42501';end if;
 return new;
end;$$;
create trigger correspondence_write_guard before insert or update on public.project_correspondence for each row execute function public.guard_project_correspondence_write();

create function public.write_project_correspondence(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare project uuid;draft uuid;operation uuid;expected integer;j public.project_correspondence;
 request_hash text=md5(p::text);ref jsonb;doc public.documents;sources jsonb='[]';
begin
 if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) k where k not in ('operation','projectId','clientDraftId','operationId','expectedRevision','subject','recipient','content','sourceRefs'))
  or coalesce(p->>'operation','') not in ('save','markSent') then raise exception 'Invalid correspondence input' using errcode='PT400';end if;
 begin project=(p->>'projectId')::uuid;draft=(p->>'clientDraftId')::uuid;operation=(p->>'operationId')::uuid;expected=(p->>'expectedRevision')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid correspondence identity' using errcode='PT400';end;
 if project is null or draft is null or operation is null or expected is null or expected<0 then raise exception 'Invalid correspondence identity' using errcode='PT400';end if;
 if auth.uid() is null or not exists(select 1 from public.projects where id=project and contractor_id=auth.uid()) then raise exception 'Project unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(project::text||draft::text,0));
 select * into j from public.project_correspondence where project_id=project and client_draft_id=draft for update;
 if j.id is not null and j.last_operation_id=operation then
  if j.last_request_hash<>request_hash then raise exception 'Changed retry' using errcode='PT409';end if;
  return to_jsonb(j);
 end if;
 if (j.id is null and expected<>0) or (j.id is not null and (j.revision<>expected or j.status<>'DRAFT')) then raise exception 'Correspondence changed' using errcode='PT409';end if;
 perform set_config('contractorsystem.correspondence_write','1',true);
 if p->>'operation'='markSent' then
  if j.id is null then raise exception 'Save the draft first' using errcode='PT409';end if;
  update public.project_correspondence set status='SENT',sent_marked_at=clock_timestamp(),revision=revision+1,
   last_operation_id=operation,last_request_hash=request_hash,updated_at=clock_timestamp() where id=j.id returning * into j;
  return to_jsonb(j);
 end if;
 if jsonb_typeof(p->'subject') is distinct from 'string' or length(trim(p->>'subject')) not between 1 and 500
  or jsonb_typeof(p->'recipient') is distinct from 'string' or length(p->>'recipient')>500
  or jsonb_typeof(p->'content') is distinct from 'string' or length(trim(p->>'content')) not between 1 and 100000
  or jsonb_typeof(p->'sourceRefs') is distinct from 'array' then raise exception 'Invalid correspondence text' using errcode='PT400';end if;
 if jsonb_array_length(p->'sourceRefs')>32 then raise exception 'Too many sources' using errcode='PT400';end if;
 for ref in select value from jsonb_array_elements(p->'sourceRefs') loop
  if jsonb_typeof(ref)<>'object' or coalesce(ref->>'basis','')<>'DOCUMENT' or length(coalesce(ref->>'quote','')) not between 1 and 8000 then raise exception 'Source unavailable' using errcode='PT422';end if;
  begin select * into doc from public.documents where id=(ref->>'documentId')::uuid and project_id=project and deleted_at is null;
  exception when invalid_text_representation then raise exception 'Source unavailable' using errcode='PT422';end;
  if doc.id is null or not public.letter_document_readable(to_jsonb(doc)) or position(ref->>'quote' in coalesce(doc.extracted_text,''))=0 then raise exception 'Source changed or unreadable' using errcode='PT422';end if;
  sources=sources||jsonb_build_array(jsonb_build_object('documentId',doc.id,'title',doc.title,'quote',ref->>'quote','pageLabel',null,'basis','DOCUMENT','status','VERIFIED','manualNote',null));
 end loop;
 if j.id is null then
  insert into public.project_correspondence(project_id,client_draft_id,revision,subject,recipient,content,source_refs,last_operation_id,last_request_hash)
   values(project,draft,1,p->>'subject',p->>'recipient',p->>'content',sources,operation,request_hash) returning * into j;
 else
  update public.project_correspondence set subject=p->>'subject',recipient=p->>'recipient',content=p->>'content',source_refs=sources,
   revision=revision+1,last_operation_id=operation,last_request_hash=request_hash,updated_at=clock_timestamp() where id=j.id returning * into j;
 end if;
 return to_jsonb(j);
end;$$;
revoke all on function public.write_project_correspondence(jsonb) from public,anon;
grant execute on function public.write_project_correspondence(jsonb) to authenticated;
revoke all on function public.guard_project_correspondence_write() from public,anon,authenticated;
notify pgrst,'reload schema';
