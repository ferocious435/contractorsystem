-- Extend the existing internal document job. No business table or public write grant is added.
create index if not exists contractor_ai_active_document_reading
on public.project_ai_jobs(owner_id,project_id,(payload->>'documentId'))
where kind='document_analysis' and payload->>'operation'='read_source' and state in ('QUEUED','RUNNING');

create or replace function public.contractor_ai_enqueue(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.project_ai_jobs;owner uuid=(p->>'ownerId')::uuid;project uuid=(p->>'projectId')::uuid;
begin
 if not exists(select 1 from public.projects where id=project and contractor_id=owner)
  or (select count(*) from public.profiles where role='super_admin')<>1
  or not exists(select 1 from public.profiles where id=owner and role='super_admin') then raise exception 'AI_ACCESS_DENIED';end if;
 if (p->'profile'->>'ownerId') is distinct from owner::text or jsonb_typeof(p->'payload') is distinct from 'object' then raise exception 'AI_PROFILE_INVALID';end if;
 if p->>'kind'='document_analysis' and p->'payload'->>'operation'='read_source' then
  perform set_config('lock_timeout','5s',true);
  perform 1 from public.projects where id=project and contractor_id=owner for update;
  if not found then raise exception 'AI_ACCESS_DENIED';end if;
  -- Do not take a job row lock after the project lock: completion locks them in the reverse order.
  select * into j from public.project_ai_jobs q where q.owner_id=owner and q.project_id=project
   and q.kind='document_analysis' and q.payload->>'operation'='read_source' and q.payload->>'documentId'=p->'payload'->>'documentId'
   and (q.state='QUEUED' or q.state='RUNNING' and q.lease_expires_at>clock_timestamp()
    and exists(select 1 from private.contractor_ai_lease l where l.slot=1 and l.job_id=q.id and l.lease_token=q.lease_token and l.expires_at>clock_timestamp()))
   order by q.created_at,q.id limit 1;
  if j.id is not null then
   if j.profile_snapshot is distinct from p->'profile' then raise exception 'AI_PROFILE_INVALID';end if;
   if j.state='RUNNING' and private.contractor_ai_context_hash(project) is distinct from j.context_snapshot->>'sourcesHash' then raise exception 'AI_CONTEXT_CHANGED';end if;
   return to_jsonb(j);
  end if;
 end if;
 insert into public.project_ai_jobs(owner_id,project_id,kind,request_key,input_hash,payload,profile_snapshot,conversation_id,client_context_id)
 values(owner,project,p->>'kind',p->>'requestKey',p->>'inputHash',p->'payload',p->'profile',(p->>'conversationId')::uuid,(p->>'clientContextId')::uuid)
 on conflict(owner_id,project_id,request_key) do nothing returning * into j;
 if j.id is null then select * into j from public.project_ai_jobs where owner_id=owner and project_id=project and request_key=p->>'requestKey';
  if j.input_hash<>p->>'inputHash' then raise exception 'AI_KEY_CONFLICT';end if;
 end if;
 return to_jsonb(j);
end;$$;

create or replace function public.contractor_ai_progress(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l private.contractor_ai_lease;j public.project_ai_jobs;stamp timestamptz=clock_timestamp();completed numeric;total numeric;
begin
 if jsonb_typeof(p) is distinct from 'object' or p-array['id','leaseToken','phase','completedUnits','totalUnits']<>'{}'::jsonb
  or coalesce(p->>'phase','') not in ('reading','analysis')
  or jsonb_typeof(p->'completedUnits') is distinct from 'number' or jsonb_typeof(p->'totalUnits') is distinct from 'number' then raise exception 'AI_INPUT_INVALID';end if;
 completed=(p->>'completedUnits')::numeric;total=(p->>'totalUnits')::numeric;
 if completed<>trunc(completed) or total<>trunc(total) or completed<0 or total<0 or total>10000 or completed>total then raise exception 'AI_INPUT_INVALID';end if;
 select * into l from private.contractor_ai_lease where slot=1 for update;
 if l.job_id is distinct from (p->>'id')::uuid or l.lease_token is distinct from (p->>'leaseToken')::uuid or l.expires_at<=stamp then return 'false';end if;
 select * into j from public.project_ai_jobs where id=l.job_id for update;
 if j.state<>'RUNNING' or j.kind<>'document_analysis' or j.lease_token is distinct from l.lease_token or j.lease_expires_at<=stamp then return 'false';end if;
 update public.project_ai_jobs set progress=jsonb_build_object('phase',p->>'phase','completedUnits',completed::integer,'totalUnits',total::integer),updated_at=stamp where id=j.id;
 return 'true';
end;$$;

create or replace function public.contractor_ai_complete(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l private.contractor_ai_lease;j public.project_ai_jobs;e jsonb;stamp timestamptz=clock_timestamp();previous_json jsonb;previous_hash text;
begin
 select * into l from private.contractor_ai_lease where slot=1 for update;
 if l.job_id is distinct from (p->>'id')::uuid or l.lease_token is distinct from (p->>'leaseToken')::uuid or l.expires_at<=stamp then return 'false';end if;
 select * into j from public.project_ai_jobs where id=l.job_id for update;
 if j.state<>'RUNNING' or j.lease_token is distinct from l.lease_token or j.lease_expires_at<=stamp then return 'false';end if;
 perform set_config('lock_timeout','5s',true);
 perform 1 from public.projects where id=j.project_id and contractor_id=j.owner_id for update;
 if not found then raise exception 'AI_ACCESS_DENIED';end if;
 perform 1 from public.documents where project_id=j.project_id for share;
 perform 1 from public.contradictions where project_id=j.project_id for share;
 perform 1 from public.pricing_ledger where project_id=j.project_id for share;
 perform 1 from public.document_scan_state where project_id=j.project_id for share;
 lock table public.reference_documents,public.reference_document_chunks,public.reference_document_incorporations,public.pricelists,public.pricelist_items,public.vo_letters,public.vo_letter_items in share mode;
 stamp=clock_timestamp();
 if l.expires_at<=stamp or j.lease_expires_at<=stamp then return 'false';end if;
 if private.contractor_ai_context_hash(j.project_id) is distinct from j.context_snapshot->>'sourcesHash' then raise exception 'AI_CONTEXT_CHANGED';end if;
 if jsonb_typeof(p->'effects')<>'array' then raise exception 'AI_EFFECT_INVALID';end if;
 for e in select * from jsonb_array_elements(p->'effects') loop
  if j.kind='document_analysis' then
   if e->>'type' is distinct from 'DOCUMENT_ANALYSIS' or e->>'targetId' is distinct from j.payload->>'documentId' then raise exception 'AI_EFFECT_INVALID';end if;
   if j.payload->>'operation'='read_source' then
    if (e->'data')-array['parsed_json','ocr_status','extracted_text','extracted_text_hash','content_hash','processed_at'] is distinct from '{}'::jsonb then raise exception 'AI_EFFECT_INVALID';end if;
    select coalesce(parsed_json,'{}'::jsonb),content_hash into previous_json,previous_hash from public.documents where id=(e->>'targetId')::uuid and project_id=j.project_id;
    if (e->'data')?'content_hash' then
     if coalesce(e->'data'->>'content_hash','')!~'^[a-f0-9]{64}$' then raise exception 'AI_EFFECT_INVALID';end if;
     if previous_hash is not null and previous_hash is distinct from e->'data'->>'content_hash' then raise exception 'AI_SOURCE_CHANGED';end if;
    end if;
    if (e->'data')?'parsed_json' and
     ((e->'data'->'parsed_json')-array['source_reading','source_reading_units','source_reading_visual_descriptions','source_reading_history','analysis_stale','analysis_reading_text_hash'])
      is distinct from (previous_json-array['source_reading','source_reading_units','source_reading_visual_descriptions','source_reading_history','analysis_stale','analysis_reading_text_hash']) then raise exception 'AI_EFFECT_INVALID';end if;
   end if;
  end if;
  perform private.contractor_ai_apply_effect(j.project_id,e);
 end loop;
 update public.project_ai_jobs set state='SUCCEEDED',result=p->'result',error=null,revision=revision+1,lease_token=null,lease_expires_at=null,finished_at=stamp,updated_at=stamp where id=j.id;
 update private.contractor_ai_lease set job_id=null,lease_token=null,expires_at=null where slot=1;return 'true';
end;$$;

revoke all on function public.contractor_ai_enqueue(jsonb),public.contractor_ai_progress(jsonb),public.contractor_ai_complete(jsonb) from public,anon,authenticated;
grant execute on function public.contractor_ai_enqueue(jsonb),public.contractor_ai_progress(jsonb),public.contractor_ai_complete(jsonb) to service_role;
