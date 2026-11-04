import test from 'node:test';import assert from 'node:assert/strict';
import {createAiJobStore} from '../src/server/ai/jobs.server.ts';
import {ownerId} from './codex-runtime/fixtures.mjs';
const project='30000000-0000-4000-8000-000000000003',job='50000000-0000-4000-8000-000000000005',lease='60000000-0000-4000-8000-000000000006';

// Break: final-save failures are invisible, or diagnostics leak content or repeat a non-repeatable commit.
test('a failed final commit is safely correlated with its job without being repeated',async()=>{
 const events=[],previous=console.warn;let calls=0;
 const store=createAiJobStore({rpc(name){assert.equal(name,'contractor_ai_complete');calls++;return {abortSignal(){throw Error('A final commit must retain its original request policy');},then(resolve,reject){return Promise.resolve({data:null,error:{code:'ECONNRESET',message:'PRIVATE_PROVIDER_CREDENTIAL'},status:503}).then(resolve,reject);}};}});
 console.warn=(tag,text)=>events.push({tag,...JSON.parse(text)});
 try{await assert.rejects(store.complete(job,lease,{result:{private:'PRIVATE_TASK_DATA'},effects:[]}),e=>e.code==='AI_UNAVAILABLE');}finally{console.warn=previous;}
 assert.equal(calls,1);assert.equal(events.length,1,'The failed final save needs a diagnostic event');const event=events[0];
 assert.equal(event.tag,'[ai-job-rpc]');assert.equal(event.operation,'complete');assert.equal(event.jobId,job);assert.equal(event.status,503);assert.equal(event.timedOut,false);assert.ok(Number.isFinite(Date.parse(event.at)));assert.equal(JSON.stringify(events).includes('PRIVATE_'),false);
});
test('a hung read, heartbeat or progress HTTP call settles before the execution lease expires',async()=>{
 await Promise.all([
  store=>store.readOwned(ownerId,project,job),
  store=>store.heartbeat(job,lease),
  store=>store.reportProgress(job,lease,{phase:'reading',completedUnits:0,totalUnits:1})
 ].map(async run=>{
  let rejectRequest;const request=new Promise((_,reject)=>rejectRequest=reject);
  const transport={rpc(){return {abortSignal(signal){signal.addEventListener('abort',()=>rejectRequest(Object.assign(Error('PRIVATE_TRANSPORT_DETAILS'),{name:'AbortError'})),{once:true});return this;},then(resolve,reject){return request.then(resolve,reject);}};}};
  const store=createAiJobStore(transport);let timer;
  const outcome=await Promise.race([run(store).then(()=>({completed:true}),error=>({code:error.code})),new Promise(resolve=>timer=setTimeout(()=>resolve({pending:true}),9500))]);clearTimeout(timer);
  assert.equal(outcome.pending,undefined,'A stalled control request must time out while the lease can still be renewed');assert.equal(outcome.code,'AI_UNAVAILABLE');
 }));
});
test('the final commit is sent once without a control-request retry or timeout',async()=>{
 let calls=0;const store=createAiJobStore({rpc(name){assert.equal(name,'contractor_ai_complete');calls++;return {abortSignal(){throw Error('Final commit must not use the control-request policy');},then(resolve,reject){return Promise.resolve({data:true,error:null}).then(resolve,reject);}};}});
 assert.equal(await store.complete(job,lease,{result:{answer:'retained'},effects:[]}),true);assert.equal(calls,1);
});

test('a_cancelled_database_claim_recovers_using_the_same_request_without_creating_a_second_job',async()=>{
 const calls=[],row={id:job,project_id:project,owner_id:ownerId,kind:'document_analysis',state:'RUNNING',revision:2,payload:{documentId:job,operation:'read_source'},profile_snapshot:{},context_snapshot:{},lease_token:lease,request_key:'same-durable-request',input_hash:'fixture',attempt:1,lease_expires_at:new Date(31000).toISOString(),result:null,error:null};
 const store=createAiJobStore({rpc(name,params){calls.push({name,params:structuredClone(params)});return Promise.resolve(calls.length===1?{data:null,error:{code:'57014',message:'canceling statement due to statement timeout'},status:500}:{data:row,error:null,status:200});}});
 const result=await store.claim('same-worker',1000);assert.equal(result.id,job);assert.equal(result.requestKey,'same-durable-request');assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
});

test('a_persisting_database_claim_timeout_stops_after_two_retries',async()=>{
 let calls=0;const store=createAiJobStore({rpc(){calls++;return Promise.resolve({data:null,error:{code:'57014',message:'statement timeout'},status:500});}});
 await assert.rejects(store.claim('same-worker',1000),error=>error.code==='AI_UNAVAILABLE');assert.equal(calls,3);
});

test('an_uncertain_claim_response_or_a_final_commit_is_never_replayed',async()=>{
 for(const operation of ['claim','complete']){let calls=0;const store=createAiJobStore({rpc(){calls++;if(operation==='claim')return Promise.reject(Object.assign(Error('connection lost'),{code:'ECONNRESET'}));return Promise.resolve({data:null,error:{code:'57014',message:'statement timeout'},status:500});}});
  await assert.rejects(operation==='claim'?store.claim('same-worker',1000):store.complete(job,lease,{result:{answer:'retained'},effects:[]}),error=>error.code==='AI_UNAVAILABLE');assert.equal(calls,1);
 }
});
