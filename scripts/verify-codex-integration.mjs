import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {account,models,ownerId} from './codex-runtime/fixtures.mjs';
import {queueFixture,projectId,savedProfile} from './codex-runtime/queue-fixtures.mjs';
import {createRuntimeService} from '../src/server/ai/runtime.server.ts';
import {createAiJobService} from '../src/server/ai/service.server.ts';
import {registeredAiKinds} from '../src/server/ai/handlers/index.ts';
import * as comparison from '../src/server/ai/comparison.server.ts';
import {createAiJobClient} from '../src/utils/ai-job-client.ts';
import {requestPricingJob,cancelPricingJob} from '../src/components/pricing/pricingJobApi.ts';

// A legacy engine import would otherwise initialize its client before a test can
// prove that the public entry point has stopped depending on it. Never infer here.
registerHooks({resolve(specifier,context,next){
 if(['@/lib/gemini','@/lib/ollama','@google/generative-ai'].includes(specifier))throw Error('OLD_ENGINE_REACHED: '+specifier);
 return next(specifier,context);
}});
const kinds=['letter','consultant','scan','scan_preview','pricing','work_change','support_enrichment','document_analysis'];
const request=()=>new Request('http://localhost/api/ai/runtime');
function runtime({signedIn=true,profile=savedProfile}={}){
 return createRuntimeService({authenticate:async()=>ownerId,kinds:registeredAiKinds,
  profiles:{read:async()=>profile,inspect:async()=>profile,save:async()=>{throw Error('No manual selection in a test');}},
  client:{request:async method=>method==='account/read'?{account:signedIn?account:null}:{data:models},startLogin:async()=>{throw Error('No implicit login');}}});
}

test('the actual registered program becomes ready for all eight approved actions',async()=>{
 const descriptor=await (await runtime().get(request())).json();assert.equal(descriptor.available,true);assert.equal(descriptor.provider,'Codex');assert.deepEqual(descriptor.kinds.toSorted(),kinds.toSorted());
});
test('the compatibility entry point uses only the context-bound comparison adapter',async()=>{
 const compatible=await import('../src/lib/comparison-ai.ts');assert.equal(compatible.generateComparisonText,comparison.generateComparisonText);assert.equal(compatible.getComparisonAiIdentity,comparison.getComparisonAiIdentity);
 await assert.rejects(compatible.generateComparisonText('untrusted request'),error=>error.code==='AI_EXECUTION_REQUIRED');
});
for(const route of ['generate-letter','chat','scan','scan/preview','scan/enrich','pricing/evaluate-ai','documents/process','parse','ai/jobs'])test(`active ${route} entry loads without the retired engine`,async()=>{
 const entry=await import(`../src/app/api/${route}/route.ts`);assert.equal(typeof entry.POST,'function');
});
test('missing login or owner choice is explained without an implicit model selection',async()=>{
 const login=await (await runtime({signedIn:false}).get(request())).json(),choice=await (await runtime({profile:null}).get(request())).json();
 assert.equal(login.reason,'AI_LOGIN_REQUIRED');assert.equal(choice.reason,'AI_PROFILE_REQUIRED');assert.equal(login.available,false);assert.equal(choice.available,false);assert.equal(choice.profile,null);
});
test('an unauthorized request or missing owner choice cannot create operational work',async()=>{
 const fixture=queueFixture();let signedIn=false;
 const service=createAiJobService({store:fixture.store,worker:{initialize:async()=>{},run:async()=>{},abort(){}},authenticate:async()=>signedIn?{id:ownerId}:null,resolveOwner:async()=>ownerId,ownsProject:async()=>true,readProfile:async()=>null,handlerFor:()=>({validate:()=>({}),execute:async()=>{throw Error('No inference without a choice');}})});
 const payload={projectId,requestKey:'missing-choice',clientContextId:projectId};
 assert.equal((await service.create(request(),'letter',payload)).status,401);signedIn=true;
 const reply=await service.create(request(),'letter',payload);assert.equal(reply.status,503);assert.equal((await reply.json()).code,'AI_PROFILE_REQUIRED');assert.equal(fixture.rows.size,0);assert.equal(fixture.modelTurns,0);
});

test('an unacknowledged start has a bounded wait and keeps a recoverable timeout',async()=>{
 const timeout=AbortSignal.timeout,budgets=[];
 AbortSignal.timeout=milliseconds=>{budgets.push(milliseconds);const controller=new AbortController();queueMicrotask(()=>controller.abort(new DOMException('request deadline','TimeoutError')));return controller.signal;};
 const client=createAiJobClient({fetchImpl:async(_url,options)=>new Promise((_resolve,reject)=>{
  const signal=options?.signal;if(!signal)return reject(Error('A start without a deadline can hang forever'));
  if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 })});
 try{await assert.rejects(client.start('/api/generate-letter',{projectId},'uncertain-start'),error=>error.code==='AI_TIMEOUT');assert.ok(budgets.length>0&&budgets.every(value=>value>0&&value<=30000));}finally{AbortSignal.timeout=timeout;}
});

const pricingJob=(state='RUNNING')=>({id:'70000000-0000-4000-8000-000000000011',projectId,kind:'pricing',state,revision:2,conversationId:null,clientContextId:ownerId,result:state==='SUCCEEDED'?{success:true,total_excl_vat:150}:null,error:null});
test('a pricing cancellation reports an answer that finished before cancellation',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async(_url,options)=>Response.json(options?.method==='POST'?{success:true,job:pricingJob('SUCCEEDED')}:{success:true,jobs:[pricingJob()]});
 try{assert.equal((await cancelPricingJob(projectId,ownerId,'pricing'))?.state,'SUCCEEDED');}finally{globalThis.fetch=original;}
});
test('pricing cancellation cannot be confirmed when no accepted job is known',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({success:true,jobs:[]});
 try{await assert.rejects(cancelPricingJob(projectId,ownerId,'pricing'),error=>error.code==='AI_START_UNCONFIRMED');}finally{globalThis.fetch=original;}
});
test('cancelling during an uncertain pricing start cannot cancel an older job',async()=>{
 const original=globalThis.fetch;let accepted,cancelPosts=0,ready;const starting=new Promise(resolve=>ready=resolve);
 globalThis.fetch=async(url,options)=>{
  if(options?.method==='POST'&&!String(url).includes('/cancel')){ready();return new Promise(resolve=>accepted=()=>resolve(Response.json({success:true,job:pricingJob('SUCCEEDED')},{status:202})));}
  if(options?.method==='POST'){cancelPosts++;return Response.json({success:true,job:pricingJob('CANCELLED')});}
  return Response.json({success:true,jobs:[pricingJob()]});
 };
 const action=requestPricingJob(projectId,ownerId,'pricing');
 try{await starting;await assert.rejects(cancelPricingJob(projectId,ownerId,'pricing'),error=>error.code==='AI_START_UNCONFIRMED');assert.equal(cancelPosts,0);}finally{accepted();await action;globalThis.fetch=original;}
});

test('a release cannot mistake incomplete native evidence for an accepted assistant',async()=>{
 const native=existsSync(new URL('./codex-runtime/native.mjs',import.meta.url))?await import('./codex-runtime/native.mjs'):{};
 assert.equal(typeof native.validateNativeAcceptance,'function','Native acceptance verifier is missing');
 for(const evidence of [{accepted:true},{native:true,accepted:true,sourceHash:'a'.repeat(64),buildId:'fixture',cases:{}}])assert.throws(()=>native.validateNativeAcceptance(evidence,{sourceHash:'a'.repeat(64),buildId:'fixture'}));
});

test('native price fixture rows preserve source prices and supply each batch row metadata',async()=>{
 const {nativePriceItems}=await import('./codex-runtime/native.mjs');assert.equal(typeof nativePriceItems,'function');
 const rows=nativePriceItems([{id:ownerId,rate:75,metadata:{source:'fixture'},xmin:'private'},{id:projectId,item_type:'NOTE',description:'המחיר כולל פיזור.'}],value=>value);
 assert.deepEqual(rows,[{id:ownerId,rate:75,metadata:{source:'fixture'}},{id:projectId,item_type:'NOTE',description:'המחיר כולל פיזור.',metadata:{}}]);
});

test('native acceptance binds every reviewed output to the verified program and canary checks',async()=>{
 const {validateNativeAcceptance}=await import('./codex-runtime/native.mjs'),evidence={version:1,native:true,accepted:true,sourceHash:'a'.repeat(64),buildId:'fixture',nativeJobs:9,nativeInferenceVerified:true,canaryFilesUnchanged:true,noCanaryDisclosure:true,foreignProjectRejected:true,fixtureCleanupVerified:true,cases:{},review:{}};
 for(const kind of kinds){evidence.cases[kind]={kind,state:'SUCCEEDED',verified:true,sourceHash:evidence.sourceHash,jobId:'70000000-0000-4000-8000-000000000001',inputHash:'b'.repeat(64),outputHash:'c'.repeat(64)};evidence.review[kind]={meaning:true,hebrew:true,facts:true,outputHash:'c'.repeat(64)};}
 assert.equal(validateNativeAcceptance(evidence,{sourceHash:evidence.sourceHash,buildId:'fixture'}),evidence);
 for(const change of [value=>{value.canaryFilesUnchanged=false;},value=>{delete value.cases.document_analysis;},value=>{value.review.letter.facts=false;},value=>{value.review.letter.outputHash='d'.repeat(64);}]){const changed=structuredClone(evidence);change(changed);assert.throws(()=>validateNativeAcceptance(changed,{sourceHash:evidence.sourceHash,buildId:'fixture'}));}
 assert.throws(()=>validateNativeAcceptance(evidence,{sourceHash:'d'.repeat(64),buildId:'fixture'}));
});
