import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {runLettersSql,jsonSql} from './letters-db.mjs';
import {seedLettersTestData,syntheticIds as id} from './fixtures/letter-rpc-test-adapter.mjs';
import {writingRpc} from './codex-runtime/writing-db.mjs';
import {createAiJobStore} from '../src/server/ai/jobs.server.ts';
import {savedProfile} from './codex-runtime/queue-fixtures.mjs';
beforeEach(()=>{seedLettersTestData();runLettersSql(`insert into public.profiles values('${id.userA}','super_admin'),('${id.userB}','member') on conflict(id) do update set role=excluded.role;insert into private.contractor_ai_lease(slot) values(1) on conflict do nothing;`);});
const payload={letterType:'general',itemIds:[id.rowA,id.rowB,id.rowC],recipient:'synthetic',subject:'coordination',keyPoints:'15.11.2026',tone:'friendly'};
async function active(){const store=createAiJobStore(writingRpc());const job=await store.enqueue(id.userA,id.projectA,'letter',payload,crypto.randomUUID(),savedProfile,{});return {store,job:await store.claim('synthetic',Date.now()),queued:job};}
test('an active server-owned letter job reuses the authoritative preview without copying tokens',async()=>{
  assert.ok(jsonSql("select to_jsonb(to_regprocedure('public.contractor_ai_letter_preview(jsonb)') is not null);"),'Background letter preview operation is missing');
  const {job}=await active(),rpc=writingRpc(),response=await rpc.rpc('contractor_ai_letter_preview',{p:{jobId:job.id}});assert.equal(response.error,null);assert.equal(response.data.ownerId,id.userA);assert.equal(response.data.projectId,id.projectA);assert.deepEqual(response.data.preview.snapshot.totals,{net:.09,vat:.03,gross:.12});
  assert.equal(jsonSql(`set local role service_role;select public.contractor_ai_letter_preview(:'body'::jsonb);select to_jsonb(auth.uid() is null);`,{params:{body:JSON.stringify({jobId:job.id})}}),true);
});
test('browser roles, a cancelled job and forged ownership cannot use the background preview',async()=>{
  const {store,job}=await active();assert.throws(()=>runLettersSql(`select public.contractor_ai_letter_preview(:'body'::jsonb);`,{role:'authenticated',userId:id.userA,params:{body:JSON.stringify({jobId:job.id})}}),/permission denied/);
  const rpc=writingRpc();assert.ok((await rpc.rpc('contractor_ai_letter_preview',{p:{jobId:job.id,ownerId:id.userB}})).error);
  await store.cancel(id.userA,job.id,job.revision);assert.ok((await rpc.rpc('contractor_ai_letter_preview',{p:{jobId:job.id}})).error);
  assert.equal(jsonSql('select to_jsonb(count(*)) from public.vo_letters;'),1);
});
test('expired or reassigned jobs cannot load a privileged letter preview',async()=>{
  const {job}=await active(),rpc=writingRpc();runLettersSql("update private.contractor_ai_lease set expires_at=clock_timestamp()-interval '1 second';");assert.match((await rpc.rpc('contractor_ai_letter_preview',{p:{jobId:job.id}})).error.message,/AI_LEASE_LOST/);
  runLettersSql(`update private.contractor_ai_lease set expires_at=clock_timestamp()+interval '30 seconds';update public.projects set contractor_id='${id.userB}' where id='${id.projectA}';`);assert.match((await rpc.rpc('contractor_ai_letter_preview',{p:{jobId:job.id}})).error.message,/AI_ACCESS_DENIED/);
});
test('a rejected official preview restores the previous database principal',async()=>{
  const store=createAiJobStore(writingRpc());await store.enqueue(id.userA,id.projectA,'letter',{...payload,letterType:'official_vo'},crypto.randomUUID(),savedProfile,{});const job=await store.claim('worker',Date.now());
  const preserved=jsonSql(`set local role service_role;select set_config('request.jwt.claim.sub',:'previous',true);select set_config('contractor.test.job',:'job',true);
  do $$begin perform public.contractor_ai_letter_preview(jsonb_build_object('jobId',current_setting('contractor.test.job')));exception when sqlstate 'PT422' then null;end$$;
  select to_jsonb(auth.uid()=:'previous'::uuid);`,{params:{previous:id.userB,job:job.id}});assert.equal(preserved,true);assert.equal(jsonSql('select to_jsonb(count(*)) from public.vo_letters;'),1);
});
