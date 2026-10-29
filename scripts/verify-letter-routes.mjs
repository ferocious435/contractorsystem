import './redesign/load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {createSyntheticLetterClient,seedLettersTestData,syntheticIds as id} from './fixtures/letter-rpc-test-adapter.mjs';
import {jsonSql,runLettersSql} from './letters-db.mjs';

// Replace only the real session factory in this test process. Routes and handlers run unchanged.
registerHooks({load(url,context,next){
 if(url.endsWith('/src/utils/supabase/server.ts'))return {format:'module',shortCircuit:true,
  source:'export async function createClient(){return globalThis.__letterRouteClient;}'};
 return next(url,context);
}});
const moduleApi=await import('../src/utils/letter-persistence-server.ts').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const currentRoute=await import('../src/app/api/pricing/vo-letters/route.ts');
const ids=[id.rowA,id.rowB,id.rowC];
const financialItems=ids.map(ledgerItemId=>({ledgerItemId,quantity:1,unitPriceExclVat:.03,net:.03,vatRate:.18,vat:.01,gross:.04,
 conditionBasis:'manual',conditionNote:'כל התנאים כלולים',description:'סינתטי',itemCode:null,unit:null,sources:[{documentId:null,title:null,pageLabel:null,quote:null,basis:'MANUAL',status:'REQUIRES_VERIFICATION',manualNote:'כל התנאים כלולים'}]}));
const snapshot={calculationVersion:'letter-individual-v1',items:financialItems,totals:{net:.09,vat:.03,gross:.12}};
const sourceRevisions=Object.fromEntries(ids.map(key=>[key,'a'.repeat(64)]));
function requestBody(patch={}){return {projectId:id.projectA,docType:'general',itemIds:ids,clientDraftId:randomUUID(),
 expectedRevision:0,operationId:randomUUID(),subject:'Synthetic subject',recipientName:'Synthetic recipient',content:'טקסט סינתטי',sourceRevisions,...patch};}
const request=(body,method='POST')=>new Request('http://localhost/api/pricing/vo-letters',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function fakeClient({user=id.userA,project=true,rpcError=null}={}){
 const calls={rpc:[],directWrites:[],reads:[]};
 const client={auth:{getUser:async()=>({data:{user:user?{id:user}:null},error:null})},
  async rpc(name,args){calls.rpc.push({name,args});return {error:rpcError,data:rpcError?null:name==='preview_letter_draft'?{snapshot,sourceRevisions}:
   {letterId:'70000000-0000-4000-8000-000000000001',clientDraftId:args.p_client_draft_id||'80000000-0000-4000-8000-000000000001',status:name==='mark_letter_sent'?'SENT':'DRAFT',revision:name==='mark_letter_sent'?2:1,snapshot,sentMarkedAt:name==='mark_letter_sent'?'2026-10-29T14:00:00.000Z':null}};},
  from(table){calls.reads.push(table);const builder={select(){return builder;},eq(){return builder;},in(){return builder;},
   insert(value){calls.directWrites.push({table,value});throw Error('NON_ATOMIC_WRITE');},
   delete(){calls.directWrites.push({table,delete:true});return builder;},
   maybeSingle:async()=>({data:project?{id:table==='projects'?id.projectA:'70000000-0000-4000-8000-000000000001',project_id:id.projectA}:null,error:null}),
   then(resolve,reject){return Promise.resolve({data:ids.map(key=>({id:key,type:'PENDING_VO',quantity:1,unit_price_excl_vat:.03,vat_rate:.18})),error:null}).then(resolve,reject);}};return builder;},
 };return {client,calls};
}
function handlers(client){assert.equal(typeof moduleApi.createLetterHttpHandlers,'function','Shared protected HTTP handlers are not implemented');
 return moduleApi.createLetterHttpHandlers({createClient:async()=>client});}

test('the actual POST saves one DRAFT through RPC rather than the old immediate SENT writes',async()=>{
 const {client,calls}=fakeClient();globalThis.__letterRouteClient=client;
 const response=await currentRoute.POST(request(requestBody({total_amount_incl_vat:999999,snapshot:{totals:{gross:999999}}})));
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.status,'DRAFT');
 assert.deepEqual(body.snapshot.totals,{net:.09,vat:.03,gross:.12});
 assert.equal(calls.rpc.length,1);assert.equal(calls.rpc[0].name,'save_letter_draft');assert.deepEqual(calls.directWrites,[]);
 assert.equal(calls.rpc[0].args.total_amount_incl_vat,undefined);assert.equal(calls.rpc[0].args.snapshot,undefined);
});
test('authentication and owner checks precede any RPC write',async()=>{
 for(const [options,status] of [[{user:null},401],[{project:false},403]]){
  const {client,calls}=fakeClient(options),response=await handlers(client).save(request(requestBody()));
  assert.equal(response.status,status);assert.equal(calls.rpc.length,0);assert.deepEqual(calls.directWrites,[]);
 }
});
test('partial input, malformed JSON, unknown document type and unsafe revisions return 400',async()=>{
 const {client,calls}=fakeClient(),h=handlers(client);
 for(const patch of [{itemIds:[]},{clientDraftId:null},{expectedRevision:-1},{expectedRevision:1.5},
  {operationId:'not-an-id'},{content:''},{sourceRevisions:{}},{docType:'unknown'},{projectId:null}]){
  assert.equal((await h.save(request(requestBody(patch)))).status,400,JSON.stringify(patch));
 }
 assert.equal((await h.preview(new Request('http://localhost/',{method:'POST',body:'{'}))).status,400);
 assert.equal(calls.rpc.length,0);
});
test('database money, evidence, permission and revision errors become stable HTTP responses',async()=>{
 for(const [code,status,publicCode] of [['PT422',422,'LETTER_NOT_READY'],['PT409',409,'LETTER_CONFLICT'],['42501',403,'LETTER_FORBIDDEN'],['XX000',500,'LETTER_WRITE_FAILED']]){
  const {client}=fakeClient({rpcError:{code,message:'PRIVATE SQL SOURCE AND SECRET'}});
  const response=await handlers(client).save(request(requestBody())),body=await response.json();
  assert.equal(response.status,status);assert.equal(body.success,false);assert.equal(body.code,publicCode);
  assert.ok(!JSON.stringify(body).includes('PRIVATE'));
 }
});
test('preview and separate manual sent forward only their specified RPC arguments',async()=>{
 const {client,calls}=fakeClient(),h=handlers(client);
 assert.equal((await h.preview(request({projectId:id.projectA,docType:'general',itemIds:ids}))).status,200);
 assert.equal((await h.markSent(request({projectId:id.projectA,letterId:'70000000-0000-4000-8000-000000000001',expectedRevision:1,operationId:randomUUID()}))).status,200);
 assert.deepEqual(calls.rpc.map(call=>call.name),['preview_letter_draft','mark_letter_sent']);assert.deepEqual(calls.directWrites,[]);
});
test('the same HTTP factory integrates real preview, retry, revision and sent RPC transactions',async()=>{
 seedLettersTestData();const h=handlers(createSyntheticLetterClient());
 const p=await h.preview(request({projectId:id.projectA,docType:'general',itemIds:ids}));assert.equal(p.status,200);const preview=await p.json();
 const input=requestBody({sourceRevisions:preview.sourceRevisions,total_amount_incl_vat:999999});
 const response=await h.save(request(input));assert.equal(response.status,200);const saved=await response.json();
 assert.equal(saved.status,'DRAFT');assert.deepEqual(saved.snapshot.totals,{net:.09,vat:.03,gross:.12});
 const retry=await h.save(request(input));assert.deepEqual(await retry.json(),saved);
 const foreign=handlers(createSyntheticLetterClient({userId:id.userB}));assert.equal((await foreign.save(request(input))).status,403);
 const edited=await h.save(request({...input,expectedRevision:1,operationId:randomUUID(),content:'עריכה שנשמרה'}));assert.equal(edited.status,200);const v2=await edited.json();assert.equal(v2.revision,2);
 assert.equal((await h.save(request({...input,operationId:randomUUID()}))).status,409);
 const mark=await h.markSent(request({projectId:id.projectA,letterId:saved.letterId,expectedRevision:2,operationId:randomUUID()}));assert.equal(mark.status,200);const sent=await mark.json();assert.equal(sent.status,'SENT');assert.deepEqual(sent.snapshot,saved.snapshot);
});
test('one header DELETE rolls back cascaded links on failure and never resets ledger types',async()=>{
 seedLettersTestData();const h=handlers(createSyntheticLetterClient());const p=await h.preview(request({projectId:id.projectA,docType:'general',itemIds:ids}));
 const saved=await (await h.save(request(requestBody({sourceRevisions:(await p.json()).sourceRevisions})))).json();
 assert.equal((await h.markSent(request({projectId:id.projectA,letterId:saved.letterId,expectedRevision:1,operationId:randomUUID()}))).status,200);
 const state=()=>jsonSql("select jsonb_build_object('letters',(select jsonb_agg(to_jsonb(t) order by id) from public.vo_letters t),'links',(select jsonb_agg(to_jsonb(t) order by id) from public.vo_letter_items t),'types',(select jsonb_agg(type order by id) from public.pricing_ledger));");
 runLettersSql("create function public.test_reject_letter_delete() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_DELETE_FAILURE';end;$$;create trigger test_delete_failure before delete on public.vo_letters for each row execute function public.test_reject_letter_delete();");
 try{const before=state();const result=await h.delete(request({letterId:saved.letterId},'DELETE'));assert.equal(result.status,500);assert.deepEqual(state(),before);}
 finally{runLettersSql('drop trigger test_delete_failure on public.vo_letters;drop function public.test_reject_letter_delete();');}
 const types=state().types;assert.equal(types.filter(type=>type==='SENT_VO').length,3);
 assert.equal((await h.delete(request({letterId:saved.letterId},'DELETE'))).status,200);
 assert.deepEqual(state().types,types);assert.equal(state().links,null);assert.equal(state().letters.length,1);
});
const clientApi=await import('../src/components/features/smart-letter/api/smartLetterApi.ts');
test('client preview and manual sent use the new separate HTTP operations',async()=>{
 const previous=globalThis.fetch,paths=[];const {client}=fakeClient(),h=handlers(client);
 globalThis.fetch=async(url,options)=>{paths.push(url);return (url.endsWith('/preview')?h.preview:h.markSent)(new Request('http://localhost'+url,options));};
 try{
  assert.equal(typeof clientApi.previewVoLetter,'function');assert.equal(typeof clientApi.markVoLetterSent,'function');
  assert.deepEqual((await clientApi.previewVoLetter({projectId:id.projectA,docType:'general',itemIds:ids})).snapshot.totals,{net:.09,vat:.03,gross:.12});
  assert.equal((await clientApi.markVoLetterSent({projectId:id.projectA,letterId:'70000000-0000-4000-8000-000000000001',expectedRevision:1,operationId:randomUUID()})).status,'SENT');
  assert.deepEqual(paths,['/api/pricing/vo-letters/preview','/api/pricing/vo-letters/sent']);
 }finally{globalThis.fetch=previous;}
});
test('client save returns the whole saved draft contract rather than only its ID',async()=>{
 const previous=globalThis.fetch;const {client}=fakeClient(),h=handlers(client);
 globalThis.fetch=(url,options)=>h.save(new Request('http://localhost'+url,options));
 try{const saved=await clientApi.saveVoLetter(requestBody());assert.equal(saved.status,'DRAFT');assert.equal(saved.revision,1);assert.deepEqual(saved.snapshot.totals,{net:.09,vat:.03,gross:.12});}
 finally{globalThis.fetch=previous;}
});
test('legacy client input and incomplete success responses cannot cause a false saved state',async()=>{
 const previous=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({success:true,letterId:'missing-snapshot'});};
 try{const input=requestBody();await assert.rejects(clientApi.saveVoLetter(input));
  globalThis.fetch=async()=>Response.json({success:true,letterId:'70000000-0000-4000-8000-000000000001',clientDraftId:input.clientDraftId,status:'DRAFT',revision:1,sentMarkedAt:null,
   snapshot:{...snapshot,items:[{ledgerItemId:id.rowA,sources:[]}]}});
  await assert.rejects(clientApi.saveVoLetter(input));
  requests=0;const {clientDraftId,expectedRevision,operationId,sourceRevisions,...legacy}=input;
  await assert.rejects(clientApi.saveVoLetter(legacy));assert.equal(requests,0);
 }finally{globalThis.fetch=previous;}
});
