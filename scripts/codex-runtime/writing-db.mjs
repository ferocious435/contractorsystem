import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {prepareLettersDb,runLettersSql,jsonSql,verifyTestTarget} from '../letters-db.mjs';
import {migrationPath} from './db.mjs';
export async function prepareWritingDb(){
  let present=false;try{verifyTestTarget();present=true;}catch(error){if(!/no such object|No such object/i.test(error.message))throw error;}
  if(!present)await prepareLettersDb();verifyTestTarget();
  if(!jsonSql("select to_jsonb(to_regprocedure('public.preview_letter_draft(uuid,text,uuid[])') is not null);"))throw Error('Synthetic legacy letter preview is not initialized');
  runLettersSql(`do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end$$;
  create table if not exists public.profiles(id uuid primary key,role varchar not null);alter table public.profiles enable row level security;
  alter table public.documents add column if not exists ai_status text default 'PENDING',add column if not exists processed_at timestamptz;
  alter table public.contradictions add column if not exists description text,add column if not exists strategy_advice text,add column if not exists severity text,
   add column if not exists related_contradiction_id uuid,add column if not exists pricing_status text,add column if not exists category text,add column if not exists scan_signature varchar;
  create table if not exists public.document_scan_state(id uuid primary key,project_id uuid references public.projects,contract_doc_ids text[] default '{}',work_doc_id uuid references public.documents,
   contract_signature varchar,work_signature varchar,scan_signature varchar unique,status varchar,findings_count integer,scanned_at timestamptz,
   total_work_docs integer,processed_work_docs integer,current_step text,error_message text,started_at timestamptz,updated_at timestamptz,completed_at timestamptz);
  alter table public.document_scan_state enable row level security;
  grant usage on schema public,auth to service_role;grant execute on all functions in schema auth to service_role;
  grant select,insert,update,delete on all tables in schema public to service_role;grant execute on all functions in schema public to service_role;`);
  const migration=migrationPath();if(!migration)throw Error('Missing runtime migration');runLettersSql(readFileSync(migration,'utf8'));
}
export function writingRpc(){return {async rpc(name,{p}){if(!/^contractor_ai_[a-z_]+$/.test(name))throw Error('Unexpected runtime SQL function');try{return {data:jsonSql(`set local role service_role; select public.${name}(:'body'::jsonb);`,{params:{body:JSON.stringify(p)}}),error:null};}catch(error){return {data:null,error:{code:error.code,message:error.message}};}}};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepareWritingDb();
