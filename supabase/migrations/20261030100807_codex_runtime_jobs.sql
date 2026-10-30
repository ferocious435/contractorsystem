-- Internal job writes are invoked by the server role; browser access is read-only.
create schema if not exists private;
create table if not exists public.project_ai_jobs (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),
 project_id uuid not null references public.projects(id),kind text not null check(kind in ('letter','consultant','scan','scan_preview','pricing','work_change','support_enrichment','document_analysis')),
 state text not null default 'QUEUED' check(state in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')),
 request_key text not null check(length(request_key) between 1 and 128),input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,profile_snapshot jsonb not null,context_snapshot jsonb not null default '{}',
 conversation_id uuid,client_context_id uuid,result jsonb,error jsonb,progress jsonb not null default '{}',
 revision integer not null default 1,attempt integer not null default 0,worker_id text,lease_token uuid,lease_expires_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 unique(owner_id,project_id,request_key)
);
create index if not exists contractor_ai_jobs_queue on public.project_ai_jobs(created_at,id) where state='QUEUED';
create index if not exists contractor_ai_jobs_context on public.project_ai_jobs(owner_id,project_id,kind,client_context_id,created_at desc);
alter table public.project_ai_jobs enable row level security;
drop policy if exists contractor_ai_owned_read on public.project_ai_jobs;
create policy contractor_ai_owned_read on public.project_ai_jobs for select to authenticated using (
 owner_id=(select auth.uid()) and exists(select 1 from public.projects p where p.id=project_id and p.contractor_id=(select auth.uid()))
);
revoke all on public.project_ai_jobs from public,anon,authenticated;
grant select(id,project_id,kind,state,revision,conversation_id,client_context_id,result,error,created_at,updated_at,finished_at) on public.project_ai_jobs to authenticated;
grant all on public.project_ai_jobs to service_role;
create table if not exists private.contractor_ai_lease (
 slot integer primary key check(slot=1),job_id uuid references public.project_ai_jobs(id) on delete set null,lease_token uuid,expires_at timestamptz
);
insert into private.contractor_ai_lease(slot) values(1) on conflict do nothing;
alter table private.contractor_ai_lease enable row level security;
revoke all on private.contractor_ai_lease from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on private.contractor_ai_lease to service_role;

create or replace function private.contractor_ai_context_hash(project uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object(
 'project',(select xmin::text from public.projects where id=project),
 'documents',(select jsonb_agg(jsonb_build_array(id,xmin::text) order by id) from public.documents where project_id=project),
 'findings',(select jsonb_agg(jsonb_build_array(id,xmin::text) order by id) from public.contradictions where project_id=project),
 'pricing',(select jsonb_agg(jsonb_build_array(id,xmin::text) order by id) from public.pricing_ledger where project_id=project),
 'scan',(select jsonb_agg(jsonb_build_array(id,xmin::text) order by id) from public.document_scan_state where project_id=project))::text);
$$;
revoke all on function private.contractor_ai_context_hash(uuid) from public,anon,authenticated;
grant execute on function private.contractor_ai_context_hash(uuid) to service_role;

create or replace function public.contractor_ai_enqueue(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.project_ai_jobs;owner uuid=(p->>'ownerId')::uuid;project uuid=(p->>'projectId')::uuid;
begin
 if not exists(select 1 from public.projects where id=project and contractor_id=owner)
  or (select count(*) from public.profiles where role='super_admin')<>1
  or not exists(select 1 from public.profiles where id=owner and role='super_admin') then raise exception 'AI_ACCESS_DENIED';end if;
 if p->'profile'->>'ownerId'<>owner::text or jsonb_typeof(p->'payload')<>'object' then raise exception 'AI_PROFILE_INVALID';end if;
 insert into public.project_ai_jobs(owner_id,project_id,kind,request_key,input_hash,payload,profile_snapshot,conversation_id,client_context_id)
 values(owner,project,p->>'kind',p->>'requestKey',p->>'inputHash',p->'payload',p->'profile',(p->>'conversationId')::uuid,(p->>'clientContextId')::uuid)
 on conflict(owner_id,project_id,request_key) do nothing returning * into j;
 if j.id is null then select * into j from public.project_ai_jobs where owner_id=owner and project_id=project and request_key=p->>'requestKey';
  if j.input_hash<>p->>'inputHash' then raise exception 'AI_KEY_CONFLICT';end if;
 end if;
 return to_jsonb(j);
end;$$;

create or replace function public.contractor_ai_interrupt_stale(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer;pending integer=0;cutoff timestamptz=least((p->>'now')::timestamptz,clock_timestamp());
begin
 perform 1 from private.contractor_ai_lease where slot=1 for update;
 update public.project_ai_jobs set state='INTERRUPTED',error='{"code":"AI_INTERRUPTED","message":"Действие прервано. Можно повторить его кнопкой."}',revision=revision+1,lease_token=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp()
 where state='RUNNING' and lease_expires_at<=cutoff;
 get diagnostics n=row_count;
 if p->>'pendingBefore' is not null then
  update public.project_ai_jobs set state='INTERRUPTED',error='{"code":"AI_INTERRUPTED","message":"Действие прервано. Можно повторить его кнопкой."}',revision=revision+1,finished_at=clock_timestamp(),updated_at=clock_timestamp()
  where state='QUEUED' and created_at<(p->>'pendingBefore')::timestamptz;
  get diagnostics pending=row_count;
 end if;
 update private.contractor_ai_lease set job_id=null,lease_token=null,expires_at=null where slot=1 and expires_at<=cutoff;
 return to_jsonb(n+pending);
end;$$;

create or replace function public.contractor_ai_claim(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l private.contractor_ai_lease;j public.project_ai_jobs;token uuid=gen_random_uuid();stamp timestamptz=clock_timestamp();
begin
 select * into l from private.contractor_ai_lease where slot=1 for update;
 if l.job_id is not null and l.expires_at>stamp then return null;end if;
 perform public.contractor_ai_interrupt_stale(jsonb_build_object('now',stamp));
 select * into j from public.project_ai_jobs where state='QUEUED' order by created_at,id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 if not exists(select 1 from public.projects where id=j.project_id and contractor_id=j.owner_id) then
  update public.project_ai_jobs set state='FAILED',revision=revision+1,error='{"code":"AI_ACCESS_DENIED","message":"Нет доступа к проекту."}',finished_at=stamp,updated_at=stamp where id=j.id;return null;
 end if;
 update public.project_ai_jobs set state='RUNNING',revision=revision+1,attempt=attempt+1,worker_id=p->>'workerId',lease_token=token,lease_expires_at=stamp+interval '30 seconds',updated_at=stamp,
 context_snapshot=jsonb_build_object('sourcesHash',private.contractor_ai_context_hash(project_id)) where id=j.id returning * into j;
 update private.contractor_ai_lease set job_id=j.id,lease_token=token,expires_at=j.lease_expires_at where slot=1;
 return to_jsonb(j);
end;$$;

create or replace function public.contractor_ai_heartbeat(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l private.contractor_ai_lease;stamp timestamptz=clock_timestamp();
begin
 select * into l from private.contractor_ai_lease where slot=1 for update;
 if l.job_id is distinct from (p->>'id')::uuid or l.lease_token is distinct from (p->>'leaseToken')::uuid or l.expires_at<=stamp then return 'false';end if;
 update public.project_ai_jobs set lease_expires_at=stamp+interval '30 seconds',updated_at=stamp where id=l.job_id and state='RUNNING' and lease_token=l.lease_token;
 if not found then return 'false';end if;
 update private.contractor_ai_lease set expires_at=stamp+interval '30 seconds' where slot=1;return 'true';
end;$$;

-- Fixed, server-verified effects. No dynamic SQL, target table names, ownership fields or financial amounts.
create or replace function private.contractor_ai_apply_effect(project uuid,e jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare kind text=e->>'type';target uuid=(e->>'targetId')::uuid;wanted text=e->>'expectedRevision';data jsonb=e->'data';actual text;
 finding public.contradictions;scan public.document_scan_state;document public.documents;ledger public.pricing_ledger;
begin
 if jsonb_typeof(data)<>'object' or wanted is null then raise exception 'AI_EFFECT_INVALID';end if;
 if kind='DOCUMENT_ANALYSIS' then
  if data-array['parsed_json','ai_status','ocr_status','extracted_text','content_hash','extracted_text_hash','processed_at']<>'{}'::jsonb then raise exception 'AI_EFFECT_INVALID';end if;
  select * into document from public.documents where id=target and project_id=project for update;
  select xmin::text into actual from public.documents where id=target and project_id=project;
  if actual is distinct from wanted then raise exception 'AI_SOURCE_CHANGED';end if;
  document=jsonb_populate_record(document,data);
  update public.documents set parsed_json=document.parsed_json,ai_status=document.ai_status,ocr_status=document.ocr_status,extracted_text=document.extracted_text,
   content_hash=document.content_hash,extracted_text_hash=document.extracted_text_hash,processed_at=document.processed_at where id=target and project_id=project;
 elsif kind='PRICING_EVIDENCE' then
  if data-array['ai_rationale','governing_notes','expert_strategy','evidence_data']<>'{}'::jsonb then raise exception 'AI_EFFECT_INVALID';end if;
  select * into ledger from public.pricing_ledger where id=target and project_id=project for update;
  select xmin::text into actual from public.pricing_ledger where id=target and project_id=project;
  if actual is distinct from wanted then raise exception 'AI_SOURCE_CHANGED';end if;
  ledger=jsonb_populate_record(ledger,data);
  update public.pricing_ledger set ai_rationale=ledger.ai_rationale,governing_notes=ledger.governing_notes,expert_strategy=ledger.expert_strategy,evidence_data=ledger.evidence_data where id=target and project_id=project;
 elsif kind='SCAN_FINDING' then
  if data-array['title','description','strategy_advice','severity','status','source_execution_doc_id','target_contract_doc_id','related_contradiction_id','pricing_status','evidence_data','category','scan_signature']<>'{}'::jsonb then raise exception 'AI_EFFECT_INVALID';end if;
  select * into finding from public.contradictions where id=target and project_id=project for update;
  select xmin::text into actual from public.contradictions where id=target and project_id=project;
  if (actual is null and wanted<>'new') or (actual is not null and actual<>wanted) then raise exception 'AI_SOURCE_CHANGED';end if;
  if actual is null then finding=jsonb_populate_record(null::public.contradictions,jsonb_build_object('id',target,'project_id',project,'status','OPEN','severity','MEDIUM','pricing_status','PENDING','created_at',clock_timestamp())||data);else finding=jsonb_populate_record(finding,data);end if;
  if finding.source_execution_doc_id is not null and not exists(select 1 from public.documents where id=finding.source_execution_doc_id and project_id=project) then raise exception 'AI_EFFECT_INVALID';end if;
  if finding.target_contract_doc_id is not null and not exists(select 1 from public.documents where id=finding.target_contract_doc_id and project_id=project) then raise exception 'AI_EFFECT_INVALID';end if;
  if finding.related_contradiction_id is not null and not exists(select 1 from public.contradictions where id=finding.related_contradiction_id and project_id=project) then raise exception 'AI_EFFECT_INVALID';end if;
  if actual is null then insert into public.contradictions select (finding).*;else
   update public.contradictions set title=finding.title,description=finding.description,strategy_advice=finding.strategy_advice,severity=finding.severity,status=finding.status,
    source_execution_doc_id=finding.source_execution_doc_id,target_contract_doc_id=finding.target_contract_doc_id,related_contradiction_id=finding.related_contradiction_id,
    pricing_status=finding.pricing_status,evidence_data=finding.evidence_data,category=finding.category,scan_signature=finding.scan_signature where id=target and project_id=project;
  end if;
 elsif kind='SCAN_STATE' then
  if data-array['contract_doc_ids','work_doc_id','contract_signature','work_signature','scan_signature','status','findings_count','scanned_at','total_work_docs','processed_work_docs','current_step','error_message','started_at','updated_at','completed_at']<>'{}'::jsonb then raise exception 'AI_EFFECT_INVALID';end if;
  select * into scan from public.document_scan_state where id=target and project_id=project for update;
  select xmin::text into actual from public.document_scan_state where id=target and project_id=project;
  if (actual is null and wanted<>'new') or (actual is not null and actual<>wanted) then raise exception 'AI_SOURCE_CHANGED';end if;
  if actual is null then scan=jsonb_populate_record(null::public.document_scan_state,jsonb_build_object('id',target,'project_id',project,'contract_doc_ids','[]'::jsonb,'findings_count',0)||data);else scan=jsonb_populate_record(scan,data);end if;
  if not exists(select 1 from public.documents where id=scan.work_doc_id and project_id=project) or exists(select 1 from unnest(scan.contract_doc_ids) d where not exists(select 1 from public.documents where id::text=d and project_id=project)) then raise exception 'AI_EFFECT_INVALID';end if;
  if actual is null then insert into public.document_scan_state select (scan).*;else
   update public.document_scan_state set contract_doc_ids=scan.contract_doc_ids,work_doc_id=scan.work_doc_id,contract_signature=scan.contract_signature,work_signature=scan.work_signature,scan_signature=scan.scan_signature,
    status=scan.status,findings_count=scan.findings_count,scanned_at=scan.scanned_at,total_work_docs=scan.total_work_docs,processed_work_docs=scan.processed_work_docs,current_step=scan.current_step,
    error_message=scan.error_message,started_at=scan.started_at,updated_at=scan.updated_at,completed_at=scan.completed_at where id=target and project_id=project;
  end if;
 else raise exception 'AI_EFFECT_INVALID';end if;
end;$$;
revoke all on function private.contractor_ai_apply_effect(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.contractor_ai_apply_effect(uuid,jsonb) to service_role;

create or replace function public.contractor_ai_complete(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l private.contractor_ai_lease;j public.project_ai_jobs;e jsonb;stamp timestamptz=clock_timestamp();
begin
 select * into l from private.contractor_ai_lease where slot=1 for update;
 if l.job_id is distinct from (p->>'id')::uuid or l.lease_token is distinct from (p->>'leaseToken')::uuid or l.expires_at<=stamp then return 'false';end if;
 select * into j from public.project_ai_jobs where id=l.job_id for update;
 if j.state<>'RUNNING' or j.lease_token is distinct from l.lease_token or j.lease_expires_at<=stamp then return 'false';end if;
 perform set_config('lock_timeout','5s',true);
 -- The parent lock also prevents new FK-bound sources from appearing after this check.
 perform 1 from public.projects where id=j.project_id and contractor_id=j.owner_id for update;
 if not found then raise exception 'AI_ACCESS_DENIED';end if;
 perform 1 from public.documents where project_id=j.project_id for share;
 perform 1 from public.contradictions where project_id=j.project_id for share;
 perform 1 from public.pricing_ledger where project_id=j.project_id for share;
 perform 1 from public.document_scan_state where project_id=j.project_id for share;
 stamp=clock_timestamp();
 if l.expires_at<=stamp or j.lease_expires_at<=stamp then return 'false';end if;
 if private.contractor_ai_context_hash(j.project_id) is distinct from j.context_snapshot->>'sourcesHash' then raise exception 'AI_CONTEXT_CHANGED';end if;
 if jsonb_typeof(p->'effects')<>'array' then raise exception 'AI_EFFECT_INVALID';end if;
 for e in select * from jsonb_array_elements(p->'effects') loop perform private.contractor_ai_apply_effect(j.project_id,e);end loop;
 update public.project_ai_jobs set state='SUCCEEDED',result=p->'result',error=null,revision=revision+1,lease_token=null,lease_expires_at=null,finished_at=stamp,updated_at=stamp where id=j.id;
 update private.contractor_ai_lease set job_id=null,lease_token=null,expires_at=null where slot=1;return 'true';
end;$$;

create or replace function public.contractor_ai_fail(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l private.contractor_ai_lease;stamp timestamptz=clock_timestamp();
begin
 select * into l from private.contractor_ai_lease where slot=1 for update;
 if l.job_id is distinct from (p->>'id')::uuid or l.lease_token is distinct from (p->>'leaseToken')::uuid or l.expires_at<=stamp then return 'false';end if;
 update public.project_ai_jobs set state='FAILED',error=p->'error',revision=revision+1,lease_token=null,lease_expires_at=null,finished_at=stamp,updated_at=stamp where id=l.job_id and state='RUNNING' and lease_token=l.lease_token;
 if not found then return 'false';end if;
 update private.contractor_ai_lease set job_id=null,lease_token=null,expires_at=null where slot=1;return 'true';
end;$$;

create or replace function public.contractor_ai_cancel(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.project_ai_jobs;stamp timestamptz=clock_timestamp();
begin
 perform 1 from private.contractor_ai_lease where slot=1 for update;
 select * into j from public.project_ai_jobs where id=(p->>'id')::uuid and owner_id=(p->>'ownerId')::uuid
 and exists(select 1 from public.projects where id=project_id and contractor_id=(p->>'ownerId')::uuid) for update;
 if j.id is null then raise exception 'AI_ACCESS_DENIED';end if;
 if j.revision<>(p->>'expectedRevision')::integer then raise exception 'AI_JOB_CONFLICT';end if;
 if j.state in ('QUEUED','RUNNING') then
  update public.project_ai_jobs set state='CANCELLED',revision=revision+1,lease_token=null,lease_expires_at=null,finished_at=stamp,updated_at=stamp where id=j.id returning * into j;
  update private.contractor_ai_lease set job_id=null,lease_token=null,expires_at=null where slot=1 and job_id=j.id;
 end if;
 return to_jsonb(j);
end;$$;

create or replace function public.contractor_ai_read(p jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(j) from public.project_ai_jobs j join public.projects project on project.id=j.project_id and project.contractor_id=j.owner_id
 where j.owner_id=(p->>'ownerId')::uuid and j.project_id=(p->>'projectId')::uuid and j.id=(p->>'id')::uuid;
$$;
create or replace function public.contractor_ai_list(p jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc,j.id),'[]'::jsonb) from (
 select j.* from public.project_ai_jobs j join public.projects project on project.id=j.project_id and project.contractor_id=j.owner_id
 where j.owner_id=(p->>'ownerId')::uuid and j.project_id=(p->>'projectId')::uuid and j.kind=p->>'kind'
 and (p->>'clientContextId' is null or j.client_context_id=(p->>'clientContextId')::uuid) order by j.created_at desc,j.id limit 100) j;
$$;
create or replace function public.contractor_ai_source_revision(p jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actual text;project uuid=(p->>'projectId')::uuid;target uuid=(p->>'targetId')::uuid;
begin
 if p->>'type'='DOCUMENT_ANALYSIS' then select xmin::text into actual from public.documents where id=target and project_id=project;
 elsif p->>'type'='SCAN_FINDING' then select xmin::text into actual from public.contradictions where id=target and project_id=project;
 elsif p->>'type'='SCAN_STATE' then select xmin::text into actual from public.document_scan_state where id=target and project_id=project;
 elsif p->>'type'='PRICING_EVIDENCE' then select xmin::text into actual from public.pricing_ledger where id=target and project_id=project;
 else raise exception 'AI_EFFECT_INVALID';end if;
 return to_jsonb(coalesce(actual,'new'));
end;$$;

revoke all on function public.contractor_ai_enqueue(jsonb),public.contractor_ai_claim(jsonb),public.contractor_ai_heartbeat(jsonb),public.contractor_ai_complete(jsonb),public.contractor_ai_fail(jsonb),public.contractor_ai_cancel(jsonb),public.contractor_ai_interrupt_stale(jsonb),public.contractor_ai_read(jsonb),public.contractor_ai_list(jsonb),public.contractor_ai_source_revision(jsonb) from public,anon,authenticated;
grant execute on function public.contractor_ai_enqueue(jsonb),public.contractor_ai_claim(jsonb),public.contractor_ai_heartbeat(jsonb),public.contractor_ai_complete(jsonb),public.contractor_ai_fail(jsonb),public.contractor_ai_cancel(jsonb),public.contractor_ai_interrupt_stale(jsonb),public.contractor_ai_read(jsonb),public.contractor_ai_list(jsonb),public.contractor_ai_source_revision(jsonb) to service_role;

-- Delegate the existing read-only preview to the verified job principal, not browser-provided claims.
-- Only the server role can call this. No user JWT is copied into the queue or model process.
create or replace function public.contractor_ai_letter_preview(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.project_ai_jobs;l private.contractor_ai_lease;preview jsonb;previous_sub text;project_name text;ids uuid[];
begin
 if jsonb_typeof(p)<>'object' or p-array['jobId']<>'{}'::jsonb then raise exception 'AI_INPUT_INVALID';end if;
 select * into l from private.contractor_ai_lease where slot=1 for share;
 select * into j from public.project_ai_jobs where id=(p->>'jobId')::uuid for share;
 if j.id is null or j.kind<>'letter' or j.state<>'RUNNING' or l.job_id is distinct from j.id or l.lease_token is distinct from j.lease_token
  or l.expires_at<=clock_timestamp() or j.lease_expires_at<=clock_timestamp() then raise exception 'AI_LEASE_LOST';end if;
 select coalesce(name,'') into project_name from public.projects where id=j.project_id and contractor_id=j.owner_id for update;
 if not found or not exists(select 1 from public.profiles where id=j.owner_id and role='super_admin') then raise exception 'AI_ACCESS_DENIED';end if;
 if private.contractor_ai_context_hash(j.project_id) is distinct from j.context_snapshot->>'sourcesHash' then raise exception 'AI_CONTEXT_CHANGED';end if;
 select array_agg(value::uuid order by ordinal) into ids from jsonb_array_elements_text(j.payload->'itemIds') with ordinality as requested(value,ordinal);
 previous_sub=current_setting('request.jwt.claim.sub',true);
 perform set_config('request.jwt.claim.sub',j.owner_id::text,true);
 begin
  preview=public.preview_letter_draft(j.project_id,j.payload->>'letterType',ids);
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);raise;
 end;
 return jsonb_build_object('ownerId',j.owner_id,'projectId',j.project_id,'projectName',project_name,'preview',preview);
end;$$;
revoke all on function public.contractor_ai_letter_preview(jsonb) from public,anon,authenticated;
grant execute on function public.contractor_ai_letter_preview(jsonb) to service_role;
