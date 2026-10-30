import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {temporaryRuntime,ownerId,otherId,account,models,selectedModel} from './codex-runtime/fixtures.mjs';
import {createRuntimeProfileStore} from '../src/server/ai/profile.server.ts';
import {fetchAiReadiness} from '../src/hooks/useAiReadiness.ts';
const runtimeModule=existsSync(new URL('../src/server/ai/runtime.server.ts',import.meta.url))?await import('../src/server/ai/runtime.server.ts'):{};
const clientModule=existsSync(new URL('../src/utils/ai-job-client.ts',import.meta.url))?await import('../src/utils/ai-job-client.ts'):{};
const projectId='30000000-0000-4000-8000-000000000003',jobId='40000000-0000-4000-8000-000000000004',contextId='50000000-0000-4000-8000-000000000005';
const kinds=['letter','consultant','scan','scan_preview','pricing','work_change','support_enrichment','document_analysis'];
const json=(value,status=200)=>Response.json(value,{status});
const job=(state='RUNNING',revision=2)=>({id:jobId,projectId,kind:'letter',state,revision,conversationId:null,clientContextId:contextId,result:state==='SUCCEEDED'?{message:'saved result'}:null,error:null});
const req=(body)=>new Request('http://localhost/api/ai/runtime',{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
async function runtime(t,{authenticated=true,authorized=true}={}){
  assert.equal(typeof runtimeModule.createRuntimeService,'function','Runtime settings service is missing');const dir=await temporaryRuntime(t);let signedIn=authenticated,turnStartCalls=0,loginCalls=0;
  const metadata=async()=>({account:signedIn?account:null,models:signedIn?models:[]});const profiles=createRuntimeProfileStore({runtimeDir:dir,metadata});
  const client={async request(method){if(method==='account/read')return {account:signedIn?account:null};if(method==='model/list')return {data:signedIn?models:[],nextCursor:null};throw Error('Unexpected metadata RPC');},async startLogin(){loginCalls++;return {authUrl:'https://auth.openai.com/authorize?synthetic=1',loginId:'synthetic-login'};},async runTurn(){turnStartCalls++;throw Error('Settings must not generate');}};
  const api=runtimeModule.createRuntimeService({authenticate:async()=>{if(!authorized)throw Object.assign(Error('forbidden'),{code:'AI_ACCESS_DENIED',status:403});return ownerId;},client,profiles,kinds:()=>kinds});
  return {api,profiles,get turnStartCalls(){return turnStartCalls;},get loginCalls(){return loginCalls;},signIn(){signedIn=true;}};
}
function client(options){assert.equal(typeof clientModule.createAiJobClient,'function','In-app job observer is missing');return clientModule.createAiJobClient(options);}

test('Codex readiness is accepted without the old Local AI provider restriction',async()=>{
  const readiness=await fetchAiReadiness(async()=>json({available:true,provider:'Codex',reason:null,kinds}));assert.equal(readiness.available,true);assert.equal(readiness.provider,'Codex');
});
test('settings never preselect a model and save exactly the manual choice',async t=>{
  const fx=await runtime(t);let response=await fx.api.get(req()),before=await response.json();assert.equal(response.status,200);assert.equal(before.profile,null);assert.equal(before.configured,false);assert.equal(await fx.profiles.read(ownerId),null);
  response=await fx.api.post(req({operation:'save',selection:{model:selectedModel,effort:'low'},expectedRevision:0}));assert.equal(response.status,200);
  const saved=await response.json();assert.equal(saved.profile.model,selectedModel);assert.equal(saved.profile.effort,'low');assert.equal(saved.profile.revision,1);assert.equal(fx.turnStartCalls,0);
  const after=await (await fx.api.get(req())).json();assert.equal(after.available,true);assert.ok(!JSON.stringify(after).includes(account.email));assert.ok(!JSON.stringify(after).includes('accountFingerprint'));assert.ok(!JSON.stringify(after).includes('ownerId'));
});
test('foreign users cannot read runtime account state or change its saved profile',async t=>{
  const fx=await runtime(t,{authorized:false});assert.equal((await fx.api.get(req())).status,403);assert.equal((await fx.api.post(req({operation:'save',selection:{model:selectedModel,effort:null},expectedRevision:0}))).status,403);assert.equal(await fx.profiles.read(ownerId),null);assert.equal(fx.turnStartCalls,0);assert.equal(fx.loginCalls,0);
});
test('login is explicit and never accepts API keys, tokens or a browser owner ID',async t=>{
  const fx=await runtime(t,{authenticated:false});assert.equal((await (await fx.api.get(req())).json()).reason,'AI_LOGIN_REQUIRED');assert.equal(fx.loginCalls,0);
  for(const body of [{operation:'login',apiKey:'PRIVATE'},{operation:'login',ownerId:otherId},{operation:'save',selection:{model:selectedModel,effort:null,token:'PRIVATE'},expectedRevision:0}])assert.equal((await fx.api.post(req(body))).status,400);
  const response=await fx.api.post(req({operation:'login'}));assert.equal(response.status,200);assert.match((await response.json()).authUrl,/^https:\/\/auth\.openai\.com\//);assert.equal(fx.loginCalls,1);assert.equal(fx.turnStartCalls,0);
});
test('browser observer backs off, stops on success and returns only a stored result',async()=>{
  const delays=[],progress=[];let reads=0;
  const api=client({fetchImpl:async(url,options)=>options?.method==='POST'?json({success:true,job:job('QUEUED',1)},202):json({success:true,job:++reads<5?job():job('SUCCEEDED',3)}),sleep:async ms=>delays.push(ms)});
  await api.start('/api/generate-letter',{projectId,clientContextId:contextId},'one-button');const result=await api.observe(jobId,{onProgress:value=>progress.push(value.state)});
  assert.deepEqual(result,{message:'saved result'});assert.deepEqual(delays,[1000,2000,4000,5000]);assert.equal(reads,5);assert.deepEqual(progress,['RUNNING','SUCCEEDED']);
});
test('leaving the page aborts observation without posting cancellation',async()=>{
  const controller=new AbortController();let cancelPosts=0;
  const api=client({fetchImpl:async(url,options)=>{if(options?.method==='POST')cancelPosts++;return json({success:true,jobs:[job()],job:job()});},sleep:async(ms,signal)=>signal.throwIfAborted()});
  await api.restore(projectId,'letter',contextId);await assert.rejects(api.observe(jobId,{signal:controller.signal,onProgress:()=>controller.abort()}),error=>error.name==='AbortError');assert.equal(cancelPosts,0);
});
test('a response from another project never reaches the current editor',async()=>{
  let delivered=0;const api=client({fetchImpl:async(url)=>String(url).includes('kind=')?json({success:true,jobs:[job()]}):json({success:true,job:{...job('SUCCEEDED',3),projectId:otherId}}),sleep:async()=>{}});
  await api.restore(projectId,'letter',contextId);await assert.rejects(api.observe(jobId,{onProgress:()=>delivered++}),error=>error.code==='AI_CONTEXT_MISMATCH');assert.equal(delivered,0);
});
test('reopening the form restores its result without another generation request',async()=>{
  let turns=0;const api=client({fetchImpl:async(url,options)=>{if(options?.method==='POST')turns++;return json({success:true,jobs:[job('SUCCEEDED',3)]});}});
  const saved=await api.restore(projectId,'letter',contextId);assert.deepEqual(saved[0].result,{message:'saved result'});assert.equal(turns,0);
});
test('cancellation refreshes a claim revision once while preserving the exact job target',async()=>{
  let posts=0;const api=client({fetchImpl:async(url,options)=>{if(options?.method==='POST'){posts++;assert.ok(String(url).includes(jobId+'/cancel'));return posts===1?json({success:false,code:'AI_JOB_CONFLICT'},409):json({success:true,job:job('CANCELLED',3)});}return String(url).includes('kind=')?json({success:true,jobs:[job('QUEUED',1)]}):json({success:true,job:job()});}});
  await api.restore(projectId,'letter',contextId);assert.equal((await api.cancel(jobId,1)).state,'CANCELLED');assert.equal(posts,2);
});
test('an edit or a newer ticket keeps the returned option out of the live editor',()=>{
  assert.equal(typeof clientModule.canApplyAiResult,'function');const captured={projectId,kind:'letter',clientContextId:contextId,ticket:1,editorRevision:3};
  assert.equal(clientModule.canApplyAiResult(job('SUCCEEDED',3),captured,{...captured,editorRevision:4}),false);assert.equal(clientModule.canApplyAiResult(job('SUCCEEDED',3),captured,{...captured,ticket:2}),false);assert.equal(clientModule.canApplyAiResult(job('SUCCEEDED',3),captured,captured),true);
});
