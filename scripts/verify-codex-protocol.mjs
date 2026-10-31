import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fakeCodex,temporaryRuntime,manualClock,flush,ownerId,otherId,selectedModel,account,models,finalText} from './codex-runtime/fixtures.mjs';

async function moduleWhenPresent(file){if(!existsSync(new URL(file,import.meta.url)))return {};return import(file);}
const protocol=await moduleWhenPresent('../src/server/ai/codex-client.server.ts');
const profiles=await moduleWhenPresent('../src/server/ai/profile.server.ts');
const owners=await moduleWhenPresent('../src/server/ai/owner.server.ts');
const profile={ownerId,accountFingerprint:'',model:selectedModel,effort:'low',revision:1};
const input={text:'כתוב תשובה בעברית.',outputSchema:{type:'object',required:['message'],properties:{message:{type:'string'}},additionalProperties:false}};
function client(fx,runtimeDir,extra={}){assert.equal(typeof protocol.createCodexClient,'function','Codex runtime client is missing');return protocol.createCodexClient({spawnProcess:fx.spawnProcess,runtimeDir,...extra});}
async function readyProfile(){assert.equal(typeof profiles.accountFingerprint,'function','Account binding is missing');return {...profile,accountFingerprint:profiles.accountFingerprint(account)};}
function store(runtimeDir,metadata){assert.equal(typeof profiles.createRuntimeProfileStore,'function','Manual runtime profile store is missing');return profiles.createRuntimeProfileStore({runtimeDir,metadata});}

// Break: falling back to a process/global model would send a turn without an owner choice.
test('no saved owner model means no process or inference starts',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex(),api=client(fx,dir);t.after(()=>api.close());
  await assert.rejects(api.runTurn(input,null,new AbortController().signal),e=>e.code==='AI_PROFILE_REQUIRED');
  assert.equal(fx.spawns.length,0);assert.equal(fx.turnStartCalls,0);
});
// Break: losing split UTF-8, correlating the wrong ID or accepting only a delta corrupts the answer.
test('split UTF-8 RPC frames produce only the completed final answer',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({fragmentBytes:2,onRequest(request,child){
    if(request.method==='model/list')child.send({id:'unrelated-request',result:{data:[]}});
    if(request.method==='turn/start')child.send({method:'item/reasoning/textDelta',params:{threadId:'business-thread',turnId:'business-turn',delta:'SYNTHETIC_PRIVATE_REASONING'}});
  }}),api=client(fx,dir);t.after(()=>api.close());
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
  assert.equal(fx.turnStartCalls,1);
});
test('a completed event received before turn-start response is not lost',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='turn/start'){child.finish();child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});return false;}}}),api=client(fx,dir);t.after(()=>api.close());
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
});
test('another thread cannot supply the current answer',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='turn/start')child.finish('other-thread','other-turn','{"message":"WRONG PROJECT"}');}}),api=client(fx,dir);t.after(()=>api.close());
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
});
test('process exit after a partial answer never becomes success',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='turn/start'){
    child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});
    child.send({method:'item/agentMessage/delta',params:{threadId:'business-thread',turnId:'business-turn',itemId:'answer',delta:'partial'}});
    queueMicrotask(()=>child.emit('exit',1,null));return false;
  }}}),api=client(fx,dir);t.after(()=>api.close());
  await assert.rejects(api.runTurn(input,await readyProfile(),new AbortController().signal),e=>e.code==='AI_RESPONSE_INCOMPLETE');
});
test('failed or interrupted terminal states reject a supplied answer',async t=>{
  const dir=await temporaryRuntime(t);
  for(const status of ['failed','interrupted']){const fx=fakeCodex({onRequest(request,child){if(request.method==='turn/start'){child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});child.finish('business-thread','business-turn',finalText,status);return false;}}}),api=client(fx,dir);t.after(()=>api.close());
    await assert.rejects(api.runTurn(input,await readyProfile(),new AbortController().signal),e=>e.code==='AI_RESPONSE_INCOMPLETE');}
});
test('metadata timeout rejects its own request without a model retry',async t=>{
  const dir=await temporaryRuntime(t),clock=manualClock(),fx=fakeCodex({onRequest(request){if(request.method==='model/list')return false;}}),api=client(fx,dir,{clock:clock.api,requestTimeoutMs:25});t.after(()=>api.close());
  const pending=api.request('model/list',{});const rejected=assert.rejects(pending,e=>e.code==='AI_TIMEOUT');await fx.until('model/list');clock.advance(26);await rejected;assert.equal(fx.turnStartCalls,0);
});
test('abort interrupts the owned turn and discards a late successful answer',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='turn/start'){child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});return false;}}}),api=client(fx,dir);t.after(()=>api.close());
  const controller=new AbortController(),pending=api.runTurn(input,await readyProfile(),controller.signal),rejected=assert.rejects(pending,e=>e.code==='AI_CANCELLED');
  await fx.until('turn/start');await flush();controller.abort();fx.processes[0].finish();await rejected;
});
test('buffered data from a cancelled child cannot terminate the next owned task',async t=>{
  const dir=await temporaryRuntime(t);let starts=0;
  const fx=fakeCodex({onRequest(request,child,current){if(request.method==='turn/start'){
    starts++;child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});
    if(starts===2){current.processes[0].send({id:'old-tool',method:'item/commandExecution/requestApproval',params:{threadId:'business-thread',turnId:'business-turn'}});queueMicrotask(()=>child.finish());}
    return false;
  }}}),api=client(fx,dir);t.after(()=>api.close());
  const controller=new AbortController(),first=api.runTurn(input,await readyProfile(),controller.signal),cancelled=assert.rejects(first,e=>e.code==='AI_CANCELLED');
  await fx.until('turn/start');await flush();controller.abort();await cancelled;
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
});
test('an unsolicited tool request is denied and cannot keep a business turn running',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='turn/start'){
    child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});
    child.send({id:'server-tool',method:'item/commandExecution/requestApproval',params:{threadId:'business-thread',turnId:'business-turn',command:'write forbidden'}});return false;
  }}}),api=client(fx,dir);t.after(()=>api.close());
  await assert.rejects(api.runTurn(input,await readyProfile(),new AbortController().signal),e=>e.code==='AI_TOOL_FORBIDDEN');
  assert.equal(fx.processes[0].killed,true);
});

// Break: a tool carried only in an early event or the final turn must not bypass isolation.
for(const timing of ['started','early','terminal'])test(`operational tool items are rejected in ${timing} events`,async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='turn/start'){
    const item={type:'imageView',id:'outside-image',path:'C:/outside/canary.png'};
    if(timing!=='early')child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});
    if(timing==='terminal')child.send({method:'turn/completed',params:{threadId:'business-thread',turn:{id:'business-turn',status:'completed',items:[item,{type:'agentMessage',id:'answer',text:finalText,phase:'final_answer'}]}}});
    else child.send({method:'item/started',params:{threadId:'business-thread',turnId:'business-turn',item}});
    if(timing==='early')child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});
    child.finish();return false;
  }}}),api=client(fx,dir);t.after(()=>api.close());
  await assert.rejects(api.runTurn(input,await readyProfile(),new AbortController().signal),e=>e.code==='AI_TOOL_FORBIDDEN');
  assert.equal(fx.processes[0].killed,true);
});

test('business threads cannot advertise local image, browser, sleep or generation tools',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex(),api=client(fx,dir);t.after(()=>api.close());
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
  const thread=fx.frames.find(frame=>frame.method==='thread/start');
  for(const name of ['view_image','browser_use','computer_use','image_generation','sleep_tool'])assert.equal(thread.params.config.features[name],false,`${name} must be disabled`);
});
test('operational threads disable hosted search even when the inherited configuration enables it',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='config/read'){child.reply(request,{config:{model_provider:null,web_search:'live'},layers:[],origins:{}});return false;}}}),api=client(fx,dir);t.after(()=>api.close());
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
  assert.equal(fx.frames.find(frame=>frame.method==='thread/start').params.config.web_search,'disabled');
});
test('all standalone MCP layers are excluded from the business thread',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({configLayers:[{name:{type:'user'},version:'1',config:{mcp_servers:{outside:{enabled:true,required:true,env:{PRIVATE:'do-not-forward'}}}}}]}),api=client(fx,dir);t.after(()=>api.close());
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
  assert.equal(fx.mcpStarts,0);
});

test('an unset provider reported as null still uses the explicitly pinned OpenAI thread',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='config/read'){child.reply(request,{config:{model_provider:null},layers:[],origins:{}});return false;}}}),api=client(fx,dir);t.after(()=>api.close());
  assert.equal(await api.runTurn(input,await readyProfile(),new AbortController().signal),finalText);
  assert.equal(fx.frames.find(frame=>frame.method==='thread/start').params.modelProvider,'openai');
});
test('an explicitly configured different provider cannot silently receive an operational turn',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='config/read'){child.reply(request,{config:{model_provider:'other-provider'},layers:[],origins:{}});return false;}}}),api=client(fx,dir);t.after(()=>api.close());
  await assert.rejects(api.runTurn(input,await readyProfile(),new AbortController().signal),e=>e.code==='AI_POLICY_UNSAFE');assert.equal(fx.turnStartCalls,0);
});
test('child environment excludes application secrets and inherited source instructions',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({threadSources:[path.join(process.cwd(),'AGENTS.md')]}),api=client(fx,dir,{environment:{PATH:process.env.PATH,LOCALAPPDATA:dir,SUPABASE_SERVICE_ROLE_KEY:'PRIVATE_DB',OPENAI_API_KEY:'PRIVATE_API'}});t.after(()=>api.close());
  await assert.rejects(api.runTurn(input,await readyProfile(),new AbortController().signal),e=>e.code==='AI_POLICY_UNSAFE');
  assert.equal(fx.spawns[0].options.env.SUPABASE_SERVICE_ROLE_KEY,undefined);assert.equal(fx.spawns[0].options.env.OPENAI_API_KEY,undefined);assert.equal(fx.turnStartCalls,0);
});
test('a different account or missing selected model never silently falls back',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex(),api=client(fx,dir);t.after(()=>api.close());
  const saved=await readyProfile();fx.account={...account,email:'another@example.invalid'};
  await assert.rejects(api.runTurn(input,saved,new AbortController().signal),e=>e.code==='AI_ACCOUNT_CHANGED');
  fx.account=structuredClone(account);fx.models=[];
  await assert.rejects(api.runTurn(input,saved,new AbortController().signal),e=>e.code==='AI_MODEL_UNAVAILABLE');assert.equal(fx.turnStartCalls,0);
});
test('raw process RPC is unavailable and server error details do not expose secrets',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='model/list'){child.send({id:request.id,error:{code:403,message:'PRIVATE_ACCESS_TOKEN'}});return false;}}}),api=client(fx,dir);t.after(()=>api.close());
  await assert.rejects(api.request('command/exec',{command:['forbidden']}),e=>e.code==='AI_METHOD_FORBIDDEN');
  await assert.rejects(api.request('model/list',{}),e=>e.code==='AI_UNAVAILABLE'&&!e.message.includes('PRIVATE_ACCESS_TOKEN'));
});
test('an oversized unfinished RPC frame terminates the owned process',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='model/list'){child.stdout.write('x'.repeat(1025));return false;}}}),api=client(fx,dir,{maxLineBytes:1024});t.after(()=>api.close());
  await assert.rejects(api.request('model/list',{}),e=>e.code==='AI_RESPONSE_TOO_LARGE');assert.equal(fx.processes[0].killed,true);
});
test('owner resolution ignores user-editable roles and rejects ambiguous ownership',async()=>{
  assert.equal(typeof owners.resolveRuntimeOwner,'function','Verified runtime owner resolver is missing');
  const admin=rows=>({from(table){assert.equal(table,'profiles');let filtered=rows;return {select(){return this;},eq(key,value){filtered=filtered.filter(row=>row[key]===value);return this;},limit(n){return Promise.resolve({data:filtered.slice(0,n),error:null});}};}});
  assert.equal(await owners.resolveRuntimeOwner(admin([{id:otherId,role:'member',user_metadata:{role:'super_admin'}},{id:ownerId,role:'super_admin'}])),ownerId);
  await assert.rejects(owners.resolveRuntimeOwner(admin([{id:ownerId,role:'super_admin'},{id:otherId,role:'super_admin'}])),e=>e.code==='AI_OWNER_UNAVAILABLE');
});
test('manual profiles persist selected values with compare-and-set revision and account binding',async t=>{
  const dir=await temporaryRuntime(t);let current=structuredClone(account);const metadata=async()=>({account:current,models});const api=store(dir,metadata);
  assert.equal(await api.read(ownerId),null);
  const saved=await api.save(ownerId,{model:selectedModel,effort:'low'},0);assert.equal(saved.model,selectedModel);assert.equal(saved.revision,1);assert.equal(saved.ownerId,ownerId);assert.ok(!JSON.stringify(saved).includes(account.email));
  assert.deepEqual(await api.read(ownerId),saved);assert.equal(await api.read(otherId),null);
  await assert.rejects(api.save(ownerId,{model:selectedModel,effort:null},0),e=>e.code==='AI_PROFILE_CONFLICT');
  current={...account,email:'other@example.invalid'};await assert.rejects(api.read(ownerId),e=>e.code==='AI_ACCOUNT_CHANGED');
});
test('concurrent manual saves cannot lose the first owner revision',async t=>{
  const dir=await temporaryRuntime(t),api=store(dir,async()=>({account,models}));
  const results=await Promise.allSettled([api.save(ownerId,{model:selectedModel,effort:'low'},0),api.save(ownerId,{model:selectedModel,effort:null},0)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal((await api.read(ownerId)).revision,1);
});
test('invalid owner paths, unsupported choices and extra credential fields never become a profile',async t=>{
  const dir=await temporaryRuntime(t),api=store(dir,async()=>({account,models}));
  for(const selection of [{model:'not-in-catalog',effort:null},{model:selectedModel,effort:'not-supported'},{model:selectedModel,effort:null,token:'PRIVATE'}])await assert.rejects(api.save(ownerId,selection,0));
  await assert.rejects(api.save('../outside',{model:selectedModel,effort:null},0),e=>e.code==='AI_PROFILE_INVALID');
  assert.equal(await api.read(ownerId),null);
});
test('a malformed persisted profile is not silently treated as an absent owner choice',async t=>{
  const dir=await temporaryRuntime(t),api=store(dir,async()=>({account,models}));await api.save(ownerId,{model:selectedModel,effort:'low'},0);
  async function jsonFiles(folder){const found=[];for(const entry of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())found.push(...await jsonFiles(file));else if(entry.name.endsWith('.json'))found.push(file);}return found;}
  const files=await jsonFiles(dir);assert.equal(files.length,1);const original=await readFile(files[0],'utf8');assert.ok(!original.includes(account.email));await writeFile(files[0],'{broken');
  await assert.rejects(api.read(ownerId),e=>e.code==='AI_PROFILE_INVALID');
});
test('explicit sign-in exposes only an approved ChatGPT authorization URL',async t=>{
  const dir=await temporaryRuntime(t),fx=fakeCodex({onRequest(request,child){if(request.method==='account/login/start'){assert.deepEqual(request.params,{type:'chatgpt'});child.reply(request,{type:'chatgpt',loginId:'test-login',authUrl:'https://auth.openai.com/authorize?synthetic=1'});return false;}}}),api=client(fx,dir);t.after(()=>api.close());fx.account=null;
  assert.equal(typeof api.startLogin,'function');assert.deepEqual(await api.startLogin(),{loginId:'test-login',authUrl:'https://auth.openai.com/authorize?synthetic=1'});assert.equal(fx.turnStartCalls,0);
  await assert.rejects(api.request('account/login/start',{type:'apiKey',apiKey:'PRIVATE'}),e=>e.code==='AI_METHOD_FORBIDDEN');
});
