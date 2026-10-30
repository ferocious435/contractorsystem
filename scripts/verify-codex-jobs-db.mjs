import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runSql,runSqlAsync,jsonSql,databaseTransport} from './codex-runtime/db.mjs';
import {ownerId,otherId,selectedModel} from './codex-runtime/fixtures.mjs';
import {radarReadClient,radarIds} from './codex-runtime/radar-fixtures.mjs';
import {createAiWorker} from '../src/server/ai/worker.server.ts';
import {runRadarScan} from '../src/server/ai/radar-service.server.ts';
const jobsModule=existsSync(new URL('../src/server/ai/jobs.server.ts',import.meta.url))?await import('../src/server/ai/jobs.server.ts'):{};
const project='30000000-0000-4000-8000-000000000003',foreign='40000000-0000-4000-8000-000000000004';
const doc='50000000-0000-4000-8000-000000000005',foreignDoc='60000000-0000-4000-8000-000000000006';
const profile={ownerId,model:selectedModel,effort:null,revision:1,accountFingerprint:'a'.repeat(64)};
const prepared={result:{message:'תשובה שמורה'},effects:[]};
const api=()=>{assert.equal(typeof jobsModule.createAiJobStore,'function','Stored job contract is missing');return jobsModule.createAiJobStore(databaseTransport());};
beforeEach(()=>{
  runSql(`delete from public.vo_letter_items;delete from public.vo_letters;delete from public.reference_document_incorporations;delete from public.reference_document_chunks;delete from public.reference_documents;delete from public.pricelist_items;delete from public.pricelists;
  delete from public.document_scan_state; delete from public.contradictions; delete from public.pricing_ledger; delete from public.documents;
  insert into public.profiles values('${ownerId}','super_admin'),('${otherId}','member') on conflict(id) do nothing;
  insert into public.projects values('${project}','${ownerId}','synthetic'),('${foreign}','${otherId}','foreign') on conflict(id) do nothing;
  insert into public.documents(id,project_id,title,version,extracted_text,parsed_json,ai_status) values('${doc}','${project}','A',1,'complete text','{}','PENDING'),('${foreignDoc}','${foreign}','B',1,'other text','{}','PENDING');`);
  if(jsonSql("select to_jsonb(to_regclass('public.project_ai_jobs') is not null);"))runSql('delete from public.project_ai_jobs; update private.contractor_ai_lease set job_id=null,lease_token=null,expires_at=null;');
});
const enqueue=(store,key='button-1',payload={text:'business input'},context={})=>store.enqueue(ownerId,project,'letter',payload,key,profile,context);

// Break: a user must never write jobs or invoke privileged transitions via the browser key.
test('job RLS and grants protect foreign rows and all browser writes',async()=>{
  assert.equal(jsonSql("select to_jsonb(to_regclass('public.project_ai_jobs') is not null);"),true,'Durable job table is missing');
  const store=api(),job=await enqueue(store);
  assert.equal(jsonSql('select to_jsonb(count(*)) from public.project_ai_jobs;',{role:'authenticated',userId:ownerId}),1);
  assert.equal(jsonSql('select to_jsonb(count(*)) from public.project_ai_jobs;',{role:'authenticated',userId:otherId}),0);
  for(const statement of ["insert into public.project_ai_jobs default values;","update public.project_ai_jobs set state='SUCCEEDED';","delete from public.project_ai_jobs;","select public.contractor_ai_claim('{}');"]){
    assert.throws(()=>runSql(statement,{role:'authenticated',userId:ownerId}),/permission denied/);
  }
  assert.throws(()=>runSql('select profile_snapshot from public.project_ai_jobs;',{role:'authenticated',userId:ownerId}),/permission denied/);
  assert.throws(()=>runSql('select id from public.project_ai_jobs;',{role:'anon'}),/permission denied/);
  assert.equal((await store.readOwned(ownerId,project,job.id)).id,job.id);
  assert.equal(await store.readOwned(otherId,project,job.id),null);
});
test('the same owned request key returns one job while a changed payload conflicts',async()=>{
  const store=api();const [a,b]=await Promise.all([enqueue(store),enqueue(store)]);assert.equal(a.id,b.id);
  await assert.rejects(enqueue(store,'button-1',{text:'changed'}),e=>e.code==='AI_KEY_CONFLICT');
  assert.equal(jsonSql('select to_jsonb(count(*)) from public.project_ai_jobs;'),1);
});
test('ownership and manual profile cannot be reassigned by a queued request',async()=>{
  const store=api();await assert.rejects(store.enqueue(ownerId,foreign,'letter',{},'k',profile,{}),e=>e.code==='AI_ACCESS_DENIED');
  await assert.rejects(store.enqueue(otherId,foreign,'letter',{},'k',profile,{}),e=>e.code==='AI_PROFILE_INVALID');
  assert.equal(jsonSql('select to_jsonb(count(*)) from public.project_ai_jobs;'),0);
});
test('two concurrent database claimants share one global execution lease',async()=>{
  const store=api();await enqueue(store);await enqueue(store,'button-2');
  const claimed=await Promise.all([store.claim('worker-a',Date.now()),store.claim('worker-b',Date.now())]);assert.equal(claimed.filter(Boolean).length,1);
  const first=claimed.find(Boolean);await store.heartbeat(first.id,first.leaseToken);assert.equal(await store.complete(first.id,first.leaseToken,prepared),true);
  assert.equal(await store.complete(first.id,first.leaseToken,prepared),false);
  const second=await store.claim('worker-b',Date.now());assert.ok(second);assert.notEqual(second.id,first.id);
});
test('cancellation invalidates the old lease and late business effects',async()=>{
  const store=api(),queued=await enqueue(store),job=await store.claim('worker',Date.now());
  const cancelled=await store.cancel(ownerId,job.id,job.revision);assert.equal(cancelled.state,'CANCELLED');
  const revision=runSql(`select xmin::text from public.documents where id='${doc}';`);
  assert.equal(await store.complete(job.id,job.leaseToken,{result:{done:true},effects:[{type:'DOCUMENT_ANALYSIS',targetId:doc,expectedRevision:revision,data:{parsed_json:{changed:true},ai_status:'COMPLETED'}}]}),false);
  assert.deepEqual(jsonSql(`select parsed_json from public.documents where id='${doc}';`),{});
  await assert.rejects(store.cancel(ownerId,job.id,queued.revision),e=>e.code==='AI_JOB_CONFLICT');
});
test('an expired lease cannot heartbeat or finish and is interrupted without replay',async()=>{
  const store=api();await enqueue(store);const job=await store.claim('worker',Date.now());
  runSql("update private.contractor_ai_lease set expires_at=clock_timestamp()-interval '1 second'; update public.project_ai_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where state='RUNNING';");
  await assert.rejects(store.heartbeat(job.id,job.leaseToken),e=>e.code==='AI_LEASE_LOST');assert.equal(await store.complete(job.id,job.leaseToken,prepared),false);
  assert.equal(await store.interruptStale(Date.now()),1);assert.equal(await store.claim('new-worker',Date.now()),null);
  assert.equal((await store.readOwned(ownerId,project,job.id)).state,'INTERRUPTED');
});
test('all verified effects and success commit atomically with source revisions',async()=>{
  const store=api();await enqueue(store);const job=await store.claim('worker',Date.now());
  const revision=runSql(`select xmin::text from public.documents where id='${doc}';`);
  const effect={type:'DOCUMENT_ANALYSIS',targetId:doc,expectedRevision:revision,data:{parsed_json:{read:true},ai_status:'COMPLETED'}};
  await assert.rejects(store.complete(job.id,job.leaseToken,{result:{done:true},effects:[effect,{...effect,expectedRevision:'incorrect'}]}),e=>e.code==='AI_SOURCE_CHANGED');
  assert.deepEqual(jsonSql(`select parsed_json from public.documents where id='${doc}';`),{});assert.equal((await store.readOwned(ownerId,project,job.id)).state,'RUNNING');
  assert.equal(await store.complete(job.id,job.leaseToken,{result:{done:true},effects:[effect]}),true);
  assert.deepEqual(jsonSql(`select parsed_json from public.documents where id='${doc}';`),{read:true});assert.equal((await store.readOwned(ownerId,project,job.id)).state,'SUCCEEDED');
});
test('a document changed or added during generation refuses stale results',async()=>{
  const store=api();await enqueue(store);const job=await store.claim('worker',Date.now());
  runSql(`update public.documents set extracted_text='later approval',version=2 where id='${doc}';`);
  await assert.rejects(store.complete(job.id,job.leaseToken,prepared),e=>e.code==='AI_CONTEXT_CHANGED');
  assert.equal((await store.readOwned(ownerId,project,job.id)).result,null);
});
test('a concurrent source transaction cannot cross the final success check',async()=>{
  const store=api();await enqueue(store);const job=await store.claim('worker',Date.now());
  let signalLocked;const locked=new Promise(resolve=>signalLocked=resolve);
  const updating=runSqlAsync(`update public.documents set extracted_text='concurrent approval',version=3 where id='${doc}';select 'SOURCE_LOCKED';select pg_sleep(3);`,{onOutput:text=>{if(text.includes('SOURCE_LOCKED'))signalLocked();}});
  await locked;
  try{await assert.rejects(store.complete(job.id,job.leaseToken,prepared),e=>e.code==='AI_CONTEXT_CHANGED');}finally{await updating;}
  assert.equal((await store.readOwned(ownerId,project,job.id)).state,'RUNNING');
});
test('effect targets cannot escape their project or alter financial amounts',async()=>{
  const store=api();await enqueue(store);const job=await store.claim('worker',Date.now());
  for(const effect of [{type:'DOCUMENT_ANALYSIS',targetId:foreignDoc,expectedRevision:'new',data:{parsed_json:{bad:true}}},{type:'PRICING_EVIDENCE',targetId:doc,expectedRevision:'new',data:{quantity:100000}},{type:'arbitrary_sql',targetId:doc,expectedRevision:'new',data:{}}]){
    await assert.rejects(store.complete(job.id,job.leaseToken,{result:null,effects:[effect]}),e=>['AI_EFFECT_INVALID','AI_SOURCE_CHANGED'].includes(e.code));
  }
  assert.deepEqual(jsonSql(`select parsed_json from public.documents where id='${foreignDoc}';`),{});
});
test('safe DTOs and correlated lists restore stored results without internal credentials',async()=>{
  const store=api(),job=await enqueue(store,'chat-1',{question:'saved'}, {conversationId:doc,clientContextId:doc});const running=await store.claim('worker',Date.now());await store.complete(running.id,running.leaseToken,prepared);
  const list=await store.listOwned(ownerId,project,'letter',doc);assert.equal(list.length,1);assert.equal(list[0].id,job.id);assert.deepEqual(list[0].result,prepared.result);
  for(const key of ['ownerId','leaseToken','profile','accountFingerprint','payload','inputHash'])assert.equal(Object.hasOwn(list[0],key),false);
  assert.deepEqual(await store.listOwned(ownerId,foreign,'letter',doc),[]);
});
test('verified finding and scan progress persist in the same successful transaction',async()=>{
  const store=api(),finding='70000000-0000-4000-8000-000000000007',scan='80000000-0000-4000-8000-000000000008';
  assert.equal(await store.sourceRevision(project,'SCAN_FINDING',finding),'new');
  await enqueue(store);const job=await store.claim('worker',Date.now());
  assert.equal(await store.complete(job.id,job.leaseToken,{result:{findings:1},effects:[
    {type:'SCAN_FINDING',targetId:finding,expectedRevision:'new',data:{title:'verified instruction',description:'grounded synthetic result',source_execution_doc_id:doc,target_contract_doc_id:doc,evidence_data:{source:doc}}},
    {type:'SCAN_STATE',targetId:scan,expectedRevision:'new',data:{work_doc_id:doc,contract_doc_ids:[doc],contract_signature:'contract',work_signature:'work',scan_signature:'fixture-signature',status:'COMPLETED',findings_count:1}}
  ]}),true);
  assert.equal(jsonSql(`select to_jsonb(findings_count) from public.document_scan_state where id='${scan}';`),1);
  assert.equal(jsonSql(`select to_jsonb(status) from public.contradictions where id='${finding}';`),'OPEN');
});
test('pricing annotations leave quantity, unit price and VAT unchanged',async()=>{
  const store=api(),item='90000000-0000-4000-8000-000000000009';
  runSql(`insert into public.pricing_ledger(id,project_id,quantity,unit_price_excl_vat,vat_rate) values('${item}','${project}',3,.03,.18);`);
  const revision=await store.sourceRevision(project,'PRICING_EVIDENCE',item);await enqueue(store);const job=await store.claim('worker',Date.now());
  assert.equal(await store.complete(job.id,job.leaseToken,{result:{reviewed:true},effects:[{type:'PRICING_EVIDENCE',targetId:item,expectedRevision:revision,data:{ai_rationale:'saved explanation',evidence_data:{source:doc}}}]}),true);
  assert.deepEqual(jsonSql(`select jsonb_build_array(quantity,unit_price_excl_vat,vat_rate,ai_rationale) from public.pricing_ledger where id='${item}';`),[3,.03,.18,'saved explanation']);
});
test('failure releases only its own active lease and never replaces another saved answer',async()=>{
  const store=api();await enqueue(store);const first=await store.claim('worker',Date.now());await store.complete(first.id,first.leaseToken,prepared);
  await enqueue(store,'next-action');const second=await store.claim('worker',Date.now());
  assert.equal(await store.fail(second.id,first.leaseToken,{code:'AI_FAILED',message:'PRIVATE_TOKEN'}),false);
  assert.equal(await store.fail(second.id,second.leaseToken,{code:'AI_FAILED',message:'PRIVATE_TOKEN'}),true);
  const failed=await store.readOwned(ownerId,project,second.id);assert.equal(failed.state,'FAILED');assert.ok(!JSON.stringify(failed).includes('PRIVATE_TOKEN'));
  assert.deepEqual((await store.readOwned(ownerId,project,first.id)).result,prepared.result);assert.equal(await store.claim('worker',Date.now()),null);
});
test('startup interrupts old queued work while preserving a new explicit action',async()=>{
  const store=api(),old=await enqueue(store,'old-action');runSql(`update public.project_ai_jobs set created_at=clock_timestamp()-interval '1 minute' where id='${old.id}';`);
  const fresh=await enqueue(store,'new-explicit-action');assert.equal(await store.interruptStale(Date.now(),Date.now()-30000),1);
  assert.equal((await store.readOwned(ownerId,project,old.id)).state,'INTERRUPTED');assert.equal((await store.claim('worker',Date.now())).id,fresh.id);
});

test('a changed global reference clause invalidates an answer before commit',async()=>{
 const store=api(),reference='71000000-0000-4000-8000-000000000001',chunk='71000000-0000-4000-8000-000000000002';
 runSql(`insert into public.reference_documents(id,contractor_id,project_id,title,status) values('${reference}','${ownerId}',null,'reference','READY');insert into public.reference_document_chunks(id,reference_document_id,text) values('${chunk}','${reference}','original clause');`);
 await enqueue(store);const job=await store.claim('worker',Date.now());runSql(`update public.reference_document_chunks set text='later governing clause' where id='${chunk}';`);
 await assert.rejects(store.complete(job.id,job.leaseToken,prepared),error=>error.code==='AI_CONTEXT_CHANGED');
});
test('a new global price list or changed price source invalidates an answer',async()=>{
 const store=api(),list='72000000-0000-4000-8000-000000000001',item='72000000-0000-4000-8000-000000000002';await enqueue(store);const first=await store.claim('worker',Date.now());
 runSql(`insert into public.pricelists(id,contractor_id,is_global,name) values('${list}','${otherId}',true,'global');insert into public.pricelist_items(id,pricelist_id,description,unit_price) values('${item}','${list}','actual source',.03);`);
 await assert.rejects(store.complete(first.id,first.leaseToken,prepared),error=>error.code==='AI_CONTEXT_CHANGED');await store.fail(first.id,first.leaseToken,{code:'AI_FAILED',message:'changed'});
 await enqueue(store,'changed-price');const second=await store.claim('worker',Date.now());runSql(`update public.pricelist_items set unit_price=.04 where id='${item}';`);await assert.rejects(store.complete(second.id,second.leaseToken,prepared),error=>error.code==='AI_CONTEXT_CHANGED');
});
test('an unrelated private source does not become this project context',async()=>{
 const store=api();await enqueue(store);const job=await store.claim('worker',Date.now());runSql(`insert into public.reference_documents(id,contractor_id,project_id,title,status) values('73000000-0000-4000-8000-000000000001','${otherId}','${foreign}','private reference','READY');`);assert.equal(await store.complete(job.id,job.leaseToken,prepared),true);
});
test('only unreviewed automatic findings can be removed by verified replacement effects',async()=>{
 const store=api(),finding='74000000-0000-4000-8000-000000000001';runSql(`insert into public.contradictions(id,project_id,scan_signature,status,pricing_status,evidence_data) values('${finding}','${project}','obsolete','OPEN','PENDING','{}');`);await enqueue(store);const job=await store.claim('worker',Date.now()),revision=await store.sourceRevision(project,'SCAN_FINDING',finding);
 assert.equal(await store.complete(job.id,job.leaseToken,{result:{replaced:true},effects:[{type:'SCAN_FINDING',targetId:finding,expectedRevision:revision,data:{delete_automatic:true}}]}),true);assert.equal(jsonSql(`select to_jsonb(count(*)) from public.contradictions where id='${finding}';`),0);
});
test('replacement cannot delete reviewed or financially linked findings',async()=>{
 const store=api(),reviewed='75000000-0000-4000-8000-000000000001',priced='75000000-0000-4000-8000-000000000002';
 runSql(`insert into public.contradictions(id,project_id,scan_signature,status,pricing_status,evidence_data) values('${reviewed}','${project}','reviewed','OPEN','PENDING','{"user_review":{"note":"Keep my conclusion"}}'),('${priced}','${project}','financial','OPEN','PENDING','{}');insert into public.pricing_ledger(id,project_id,contradiction_id,quantity,unit_price_excl_vat,vat_rate) values('75000000-0000-4000-8000-000000000003','${project}','${priced}',3,.03,.18);`);
 await enqueue(store);const job=await store.claim('worker',Date.now());for(const id of [reviewed,priced]){const revision=await store.sourceRevision(project,'SCAN_FINDING',id);await assert.rejects(store.complete(job.id,job.leaseToken,{result:{deleted:true},effects:[{type:'SCAN_FINDING',targetId:id,expectedRevision:revision,data:{delete_automatic:true}}]}),error=>error.code==='AI_EFFECT_INVALID');}assert.equal(jsonSql('select to_jsonb(count(*)) from public.contradictions;'),2);
});

test('a concurrent governing-source transaction cannot cross final result validation',async()=>{
 const store=api(),reference='76000000-0000-4000-8000-000000000001',chunk='76000000-0000-4000-8000-000000000002';runSql(`insert into public.reference_documents(id,contractor_id,title,status) values('${reference}','${ownerId}','reference','READY');insert into public.reference_document_chunks(id,reference_document_id,text) values('${chunk}','${reference}','original clause');`);
 await enqueue(store);const job=await store.claim('worker',Date.now());let signal;const locked=new Promise(resolve=>signal=resolve),updating=runSqlAsync(`update public.reference_document_chunks set text='concurrent later clause' where id='${chunk}';select 'REFERENCE_LOCKED';select pg_sleep(3);`,{onOutput:value=>{if(value.includes('REFERENCE_LOCKED'))signal();}});await locked;
 try{await assert.rejects(store.complete(job.id,job.leaseToken,prepared),error=>error.code==='AI_CONTEXT_CHANGED');}finally{await updating;}
 assert.equal((await store.readOwned(ownerId,project,job.id)).state,'RUNNING');
});
test('the actual radar service and worker commit their generated effects and reuse them through real SQL',async()=>{
 const store=api(),work='עטיפת הצינור תבוצע בחול מצומנט 4%.',base='עטיפת הצינור תבוצע בחול מצומנט 8%.';let commitFailure;
 const complete=store.complete;store.complete=async(...args)=>{try{return await complete(...args);}catch(error){commitFailure=error;throw error;}};
 runSql(`insert into public.documents(id,project_id,title,category,extracted_text,ocr_status,content_hash) values('${radarIds.contract}','${project}','חוזה.txt','CONTRACT',:'base','COMPLETED','contract'),('${radarIds.work}','${project}','הוראה 01.01.2026.txt','EXECUTION',:'work','COMPLETED','work');`,{params:{base,work}});
 const claim={role:'INSTRUCTION',subject:'עטיפת הצינור',attribute:'CEMENT_CONTENT',value:'4%',scope:null,location:null,party:null,condition:null,period:null};let turns=0;
 const client={async runTurn(){turns++;return JSON.stringify({result:[{title:'עטיפת הצינור',category:'סתירה',work_quote:work,contract_quote:base,comparison:{work:claim,baseline:{...claim,role:'CONTRACT_RULE',value:'8%'}}}]});}};
 const handler={validate:raw=>raw,async execute(payload,execution){const rows=jsonSql(`select jsonb_build_object('projects',(select jsonb_agg(to_jsonb(r)) from public.projects r where id='${project}'),'documents',(select jsonb_agg(to_jsonb(r)||jsonb_build_object('xmin',r.xmin::text)) from public.documents r where project_id='${project}'),'contradictions',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('xmin',r.xmin::text)) from public.contradictions r where project_id='${project}'),'[]'::jsonb),'document_scan_state',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('xmin',r.xmin::text)) from public.document_scan_state r where project_id='${project}'),'[]'::jsonb),'pricing_ledger','[]'::jsonb,'reference_documents','[]'::jsonb,'pricelists','[]'::jsonb,'reference_document_incorporations','[]'::jsonb,'project_ai_jobs',coalesce((select jsonb_agg(to_jsonb(r)) from public.project_ai_jobs r where project_id='${project}'),'[]'::jsonb));`);return runRadarScan(radarReadClient(rows),payload,execution);}};
 const worker=createAiWorker({store,client,handlerFor:()=>handler,startedAt:0}),first=await store.enqueue(ownerId,project,'scan',{},'actual-radar',profile,{});await worker.run();const firstSaved=await store.readOwned(ownerId,project,first.id);assert.equal(firstSaved.state,'SUCCEEDED',commitFailure?.code+' '+commitFailure?.stack+' '+JSON.stringify(firstSaved.error));assert.equal(turns,1);assert.equal(jsonSql(`select to_jsonb(count(*)) from public.contradictions where project_id='${project}';`),1);
 const second=await store.enqueue(ownerId,project,'scan',{},'same-radar-sources',profile,{});await worker.run();const saved=await store.readOwned(ownerId,project,second.id);assert.equal(saved.state,'SUCCEEDED');assert.equal(turns,1);assert.equal(saved.result.memory.unchanged,1);
});

test('a new financial letter link invalidates a stale reconciliation answer',async()=>{
 const store=api(),ledger='94000000-0000-4000-8000-000000000001',letter='95000000-0000-4000-8000-000000000001';runSql(`insert into public.pricing_ledger(id,project_id,quantity,unit_price_excl_vat,vat_rate) values('${ledger}','${project}',3,.03,.18);insert into public.vo_letters(id,project_id,status) values('${letter}','${project}','DRAFT');`);
 await enqueue(store);const job=await store.claim('worker',Date.now());runSql(`insert into public.vo_letter_items(id,letter_id,ledger_item_id) values('96000000-0000-4000-8000-000000000001','${letter}','${ledger}');`);await assert.rejects(store.complete(job.id,job.leaseToken,prepared),error=>error.code==='AI_CONTEXT_CHANGED');
});
