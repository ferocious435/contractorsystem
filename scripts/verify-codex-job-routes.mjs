import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {queueFixture,projectId,savedProfile} from './codex-runtime/queue-fixtures.mjs';
import {ownerId,otherId} from './codex-runtime/fixtures.mjs';
const serviceModule=existsSync(new URL('../src/server/ai/service.server.ts',import.meta.url))?await import('../src/server/ai/service.server.ts'):{};
const workerModule=existsSync(new URL('../src/server/ai/worker.server.ts',import.meta.url))?await import('../src/server/ai/worker.server.ts'):{};
function setup(options={}){assert.equal(typeof serviceModule.createAiJobService,'function','Owned job API is missing');const fx=queueFixture();const worker=workerModule.createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0});
  const service=serviceModule.createAiJobService({store:fx.store,worker,authenticate:async()=>({id:ownerId}),resolveOwner:async()=>ownerId,ownsProject:async(owner,project)=>owner===ownerId&&project===projectId,readProfile:async()=>savedProfile,handlerFor:kind=>kind==='letter'?fx.handler:null,...options});return {fx,worker,service};}
const request=(suffix='',body)=>new Request('http://localhost/api/ai/jobs'+suffix,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
const body={projectId,requestKey:'button-once',question:'business input'};
test('two identical accepted HTTP actions yield one saved result and one model turn',async()=>{
  const {fx,worker,service}=setup();const a=await service.create(request('',body),'letter',body),b=await service.create(request('',body),'letter',body);
  assert.equal(a.status,202);assert.equal(b.status,202);const aj=await a.json(),bj=await b.json();assert.equal(aj.job.id,bj.job.id);await worker.run();assert.equal(fx.modelTurns,1);
  const response=await service.read(request('?projectId='+projectId),aj.job.id);assert.equal(response.status,200);assert.deepEqual((await response.json()).job.result,{answer:'saved business result'});assert.equal(fx.modelTurns,1);
});
test('authentication, verified installation owner and project access precede model work',async()=>{
  for(const [options,status] of [[{authenticate:async()=>null},401],[{authenticate:async()=>({id:otherId,user_metadata:{role:'super_admin'}})},403],[{ownsProject:async()=>false},403]]){const {fx,service}=setup(options);assert.equal((await service.create(request('',body),'letter',body)).status,status);assert.equal(fx.modelTurns,0);assert.equal(fx.rows.size,0);}
});
test('raw prompts, thread IDs, owner credentials and unregistered operations are rejected',async()=>{
  const {fx,service}=setup();for(const extra of [{prompt:'raw'},{threadId:'development-thread'},{ownerId},{profile:savedProfile},{model:'browser-picked'}])assert.equal((await service.create(request('',body),'letter',{...body,...extra})).status,400);
  assert.equal((await service.create(request('',body),'scan',body)).status,400);assert.equal(fx.modelTurns,0);assert.equal(fx.rows.size,0);
});
test('a missing or foreign saved runtime profile cannot start an accepted action',async()=>{
  for(const profile of [null,{...savedProfile,ownerId:otherId}]){const {fx,service}=setup({readProfile:async()=>profile});const response=await service.create(request('',body),'letter',body);assert.ok([400,409,503].includes(response.status));assert.equal(fx.modelTurns,0);assert.equal(fx.rows.size,0);}
});
test('list, read and cancel stay within the owned project and never generate',async()=>{
  const {fx,service}=setup();await fx.enqueue();const job=[...fx.rows.values()][0];
  assert.equal((await service.read(request('?projectId='+otherId),job.id)).status,403);assert.equal((await service.read(request('?projectId='+projectId),otherId)).status,404);
  const list=await service.list(request('?projectId='+projectId+'&kind=letter'));assert.equal(list.status,200);assert.equal((await list.json()).jobs.length,1);
  const cancelled=await service.cancel(request('?projectId='+projectId),job.id,job.revision);assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).job.state,'CANCELLED');assert.equal(fx.modelTurns,0);
});
test('generic request parsing authenticates first and accepts only the fixed envelope',async()=>{
  const unauth=setup({authenticate:async()=>null});assert.equal((await unauth.service.post(new Request('http://localhost/api/ai/jobs',{method:'POST',body:'{bad'}))).status,401);
  const {fx,service,worker}=setup();const response=await service.post(request('',{kind:'letter',projectId,requestKey:'fixed-envelope',payload:{question:'own business request'}}));assert.equal(response.status,202);await worker.run();assert.equal(fx.modelTurns,1);
});
test('cancel request parsing also authenticates before reading an invalid body',async()=>{
  const {fx,service}=setup({authenticate:async()=>null});const response=await service.cancelRequest(new Request('http://localhost/api/ai/jobs/fake/cancel',{method:'POST',body:'{bad'}),otherId);assert.equal(response.status,401);assert.equal(fx.modelTurns,0);
});
