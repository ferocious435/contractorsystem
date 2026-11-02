import test from 'node:test';import assert from 'node:assert/strict';
import {createAiJobStore} from '../src/server/ai/jobs.server.ts';
import {ownerId} from './codex-runtime/fixtures.mjs';
const project='30000000-0000-4000-8000-000000000003',job='50000000-0000-4000-8000-000000000005',lease='60000000-0000-4000-8000-000000000006';
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
