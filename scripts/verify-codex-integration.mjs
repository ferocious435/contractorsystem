// Current composition retains local radar/pricing and three approved business actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {account,models,ownerId} from './codex-runtime/fixtures.mjs';
import {queueFixture,projectId,savedProfile} from './codex-runtime/queue-fixtures.mjs';
import {createRuntimeService} from '../src/server/ai/runtime.server.ts';
import {createAiJobService} from '../src/server/ai/service.server.ts';
import {registeredAiKinds,getAiHandler} from '../src/server/ai/handlers/index.ts';
import {createAiJobClient} from '../src/utils/ai-job-client.ts';
registerHooks({resolve(specifier,context,next){
 if(['@/lib/gemini','@google/generative-ai'].includes(specifier))throw Error('RETIRED_PROVIDER_REACHED');
 return next(specifier,context);
}});
function runtime({signedIn=true,profile=savedProfile}={}){
 return createRuntimeService({authenticate:async()=>ownerId,kinds:registeredAiKinds,
  profiles:{read:async()=>profile,inspect:async()=>profile,save:async()=>{throw Error('No model choice made by a test');}},
  client:{request:async method=>method==='account/read'?{account:signedIn?account:null}:{data:models},startLogin:async()=>{throw Error('No implicit login');}}});
}
test('the actual registry exposes only the three selected business actions',async()=>{
 const descriptor=await (await runtime().get(new Request('http://localhost/api/ai/runtime'))).json();
 assert.equal(descriptor.available,true);assert.deepEqual(descriptor.kinds.toSorted(),['consultant','document_analysis','letter']);
 for(const kind of ['scan','scan_preview','pricing','work_change','support_enrichment'])assert.equal(getAiHandler(kind),null);
});
test('each selected action can be ready without importing unrelated native actions',async()=>{
 for(const action of ['letter','consultant','document_analysis'])assert.equal((await (await runtime().get(new Request('http://localhost/api/ai/runtime?action='+action))).json()).available,true);
 assert.equal((await (await runtime().get(new Request('http://localhost/api/ai/runtime?action=scan'))).json()).available,false);
});
for(const route of ['generate-letter','chat','scan','scan/preview','scan/enrich','pricing/evaluate-ai','documents/process','parse','ai/jobs'])test(`active ${route} loads without the removed external provider`,async()=>{
 const entry=await import(`../src/app/api/${route}/route.ts`);assert.equal(typeof entry[route==='scan/preview'?'GET':'POST'],'function');
});
test('missing login or owner choice is explained without selecting a model',async()=>{
 const request=()=>new Request('http://localhost/api/ai/runtime');
 const login=await (await runtime({signedIn:false}).get(request())).json(),choice=await (await runtime({profile:null}).get(request())).json();
 assert.equal(login.reason,'AI_LOGIN_REQUIRED');assert.equal(choice.reason,'AI_PROFILE_REQUIRED');assert.equal(login.available,false);assert.equal(choice.available,false);assert.equal(choice.profile,null);
});
test('unauthorized work or a missing owner choice cannot create a business action',async()=>{
 const fixture=queueFixture();let signedIn=false;
 const service=createAiJobService({store:fixture.store,worker:{initialize:async()=>{},run:async()=>{},abort(){}},authenticate:async()=>signedIn?{id:ownerId}:null,resolveOwner:async()=>ownerId,ownsProject:async()=>true,readProfile:async()=>null,handlerFor:()=>({validate:()=>({}),execute:async()=>{throw Error('No inference without a choice');}})});
 const request=()=>new Request('http://localhost/api/ai/jobs'),payload={projectId,requestKey:'missing-choice',clientContextId:projectId};
 assert.equal((await service.create(request(),'letter',payload)).status,401);signedIn=true;
 const reply=await service.create(request(),'letter',payload);assert.equal(reply.status,503);assert.equal((await reply.json()).code,'AI_PROFILE_REQUIRED');assert.equal(fixture.rows.size,0);assert.equal(fixture.modelTurns,0);
});
test('a lost acknowledgement has a bounded wait and a recoverable timeout',async()=>{
 const timeout=AbortSignal.timeout,budgets=[];
 AbortSignal.timeout=milliseconds=>{budgets.push(milliseconds);const controller=new AbortController();queueMicrotask(()=>controller.abort(new DOMException('deadline','TimeoutError')));return controller.signal;};
 const client=createAiJobClient({fetchImpl:async(_url,options)=>new Promise((_resolve,reject)=>{
  const signal=options?.signal;if(!signal)return reject(Error('Missing deadline'));if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 })});
 try{await assert.rejects(client.start('/api/generate-letter',{projectId},'uncertain-start'),error=>error.code==='AI_TIMEOUT');assert.ok(budgets.length&&budgets.every(value=>value>0&&value<=30000));}finally{AbortSignal.timeout=timeout;}
});
