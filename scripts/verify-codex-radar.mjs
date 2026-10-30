import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {queueFixture,projectId} from './codex-runtime/queue-fixtures.mjs';
import {radarReadClient,radarRows,radarIds} from './codex-runtime/radar-fixtures.mjs';
import {createAiWorker} from '../src/server/ai/worker.server.ts';
import {buildDocumentFingerprint,buildDocumentSetFingerprint,buildScanMemorySignature} from '../src/utils/document-scan-memory.ts';
import {CONTRACT_SCAN_MEMORY_VERSION} from '../src/utils/contract-scan-quality.ts';
import {registerHooks} from 'node:module';
import {createAiJobService} from '../src/server/ai/service.server.ts';
import {ownerId} from './codex-runtime/fixtures.mjs';
import {savedProfile} from './codex-runtime/queue-fixtures.mjs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const effects=existsSync(new URL('../src/server/ai/project-effects.server.ts',import.meta.url))?await import('../src/server/ai/project-effects.server.ts'):{};
const radar=existsSync(new URL('../src/server/ai/radar-service.server.ts',import.meta.url))?await import('../src/server/ai/radar-service.server.ts'):{};
const preview=existsSync(new URL('../src/server/ai/radar-preview.server.ts',import.meta.url))?await import('../src/server/ai/radar-preview.server.ts'):{};
registerHooks({resolve(specifier,context,next){if(/\/api\/scan\/(?:preview\/)?route\.ts$/.test(context.parentURL??'')){
 if(specifier==='@/server/ai/service.server')return {url:'data:text/javascript,export const readAiRequest=r=>r.json();export const createOwnedAiJob=(r,k,b)=>globalThis.__radarService.create(r,k,b);export const getAiJobService=()=>globalThis.__radarService;export const authenticateRuntimeOwner=async()=>{const u=await globalThis.__radarClient.auth.getUser();if(!u.data.user)throw Object.assign(Error("unauthorized"),{status:401});return u.data.user.id;};',shortCircuit:true};
 if(specifier==='@/utils/supabase/server')return {url:'data:text/javascript,export const createClient=async()=>globalThis.__radarClient;',shortCircuit:true};
 if(specifier==='@/lib/comparison-ai')return {url:'data:text/javascript,export const getComparisonAiIdentity=()=>({provider:"forbidden",model:"forbidden"});export const generateComparisonText=async()=>{globalThis.__oldRadarTurns++;throw Error("OLD_ENGINE_FORBIDDEN");};',shortCircuit:true};}
 return next(specifier,context);}});

test('a database preparation context cannot be fabricated outside an active owned job',async()=>{
 assert.equal(typeof effects.createProjectEffectClient,'function');await assert.rejects(effects.createProjectEffectClient(radarReadClient(),{projectId}),error=>error.code==='AI_EXECUTION_REQUIRED');
});

test('the actual project client prepares final changes without sending any database write',async()=>{
 assert.equal(typeof effects.createProjectEffectClient,'function');const client=radarReadClient(),before=structuredClone(client.rows),fx=queueFixture();let prepared;
 fx.handler={validate:raw=>raw,async execute(_payload,execution){const transaction=await effects.createProjectEffectClient(client,execution);await transaction.client.from('contradictions').update({description:'checked answer'}).eq('id',radarIds.finding).eq('project_id',projectId);await transaction.client.from('document_scan_state').upsert({project_id:projectId,work_doc_id:radarIds.work,contract_doc_ids:[radarIds.contract],scan_signature:'new',status:'COMPLETED',findings_count:1},{onConflict:'scan_signature'});prepared=await transaction.effects();return {result:{prepared:true},effects:prepared};}};
 await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal([...fx.rows.values()][0].state,'SUCCEEDED');assert.deepEqual(client.rows,before);assert.equal(client.writes,0);assert.equal(prepared.length,2);assert.equal(prepared.find(item=>item.type==='SCAN_FINDING').expectedRevision,'3');assert.equal(prepared.find(item=>item.type==='SCAN_STATE').expectedRevision,'new');
});

test('prepared changes cannot edit money, leave the project, or discard human/financial history',async()=>{
 assert.equal(typeof effects.createProjectEffectClient,'function');const rows=radarRows();rows.contradictions[0].evidence_data={user_review:{note:'Keep my conclusion'}};const client=radarReadClient(rows),fx=queueFixture();let prepared,failure;
 fx.handler={validate:raw=>raw,async execute(_payload,execution){try{const transaction=await effects.createProjectEffectClient(client,execution);
  await assert.rejects(async()=>await transaction.client.from('pricing_ledger').update({unit_price_excl_vat:9000}).eq('project_id',projectId),error=>error.code==='AI_EFFECT_INVALID');
  await assert.rejects(async()=>await transaction.client.from('contradictions').insert({project_id:'20000000-0000-4000-8000-000000000002',title:'foreign'}),error=>error.code==='AI_ACCESS_DENIED');
  await transaction.client.from('contradictions').delete().eq('id',radarIds.finding);prepared=await transaction.effects();return {result:{prepared:true},effects:prepared};}catch(error){failure=error;throw error;}}};
 await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal([...fx.rows.values()][0].state,'SUCCEEDED',failure?.stack);assert.deepEqual(prepared,[]);assert.equal(client.rows.contradictions.length,1);assert.equal(client.writes,0);
});

test('cancelled work cannot release a late collection of already checked changes',async()=>{
 assert.equal(typeof effects.createProjectEffectClient,'function');const client=radarReadClient(),before=structuredClone(client.rows),fx=queueFixture();let release,ready;const started=new Promise(resolve=>ready=resolve);
 fx.handler={validate:raw=>raw,async execute(_payload,execution){const transaction=await effects.createProjectEffectClient(client,execution);await transaction.client.from('contradictions').update({description:'late checked answer'}).eq('id',radarIds.finding);ready();await new Promise(resolve=>release=resolve);return {result:{done:true},effects:await transaction.effects()};}};
 await fx.enqueue();const worker=createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}),running=worker.run();await started;const job=[...fx.rows.values()][0];await fx.store.cancel(job.ownerId,job.id,job.revision);worker.abort(job.id);release();await running;assert.equal(job.state,'CANCELLED');assert.deepEqual(client.rows,before);assert.equal(client.writes,0);
});

test('scoped reference reads preserve the first select count/header options at the real transport boundary',async()=>{
 const client=radarReadClient(),from=client.from,selectCalls=[];client.from=table=>{const query=from(table);if(table==='reference_document_chunks'){const select=query.select;query.select=(...args)=>{selectCalls.push(args);return select(...args);};}return query;};const fx=queueFixture();
 fx.handler={validate:raw=>raw,async execute(_payload,execution){const transaction=await effects.createProjectEffectClient(client,execution);await transaction.client.from('reference_document_chunks').select('id',{count:'exact'}).range(0,49);return {result:{read:true},effects:await transaction.effects()};}};
 await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal([...fx.rows.values()][0].state,'SUCCEEDED');assert.equal(selectCalls[0][1]?.count,'exact');assert.equal(client.writes,0);
});

test('radar work runs through the saved parent execution rather than an HTTP recursion or another engine',()=>{
 assert.equal(typeof radar.runRadarScan,'function');
});

const claim={role:'INSTRUCTION',subject:'עטיפת הצינור',attribute:'CEMENT_CONTENT',value:'4%',scope:null,location:null,party:null,condition:null,period:null};
const candidate={title:'עטיפת הצינור',category:'סתירה',work_quote:'עטיפת הצינור תבוצע בחול מצומנט 4%.',contract_quote:'עטיפת הצינור תבוצע בחול מצומנט 8%.',comparison:{work:claim,baseline:{...claim,role:'CONTRACT_RULE',value:'8%'}}};
const freshRows=()=>{const rows=radarRows();rows.contradictions=[];return rows;};
async function runScan(rows,payload={},findings=[candidate],configure=client=>client,profile=savedProfile){
 assert.equal(typeof radar.runRadarScan,'function');let prepared,failure;const client=configure(radarReadClient(rows)),fx=queueFixture({onGenerate:async()=>JSON.stringify({result:findings})});
 fx.handler={validate:raw=>raw,async execute(_raw,execution){try{return prepared=await radar.runRadarScan(client,payload,execution);}catch(error){failure=error;throw error;}}};
 await fx.store.enqueue(profile.ownerId,projectId,'scan',payload,'radar-test-action',profile,{});await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();return {prepared,failure,fx,client,job:[...fx.rows.values()][0]};
}
function applyPrepared(rows,prepared){for(const effect of prepared.effects){const table=effect.type==='SCAN_FINDING'?'contradictions':effect.type==='SCAN_STATE'?'document_scan_state':'documents';let row=rows[table].find(item=>item.id===effect.targetId);if(effect.data.delete_automatic){rows[table]=rows[table].filter(item=>item.id!==effect.targetId);continue;}if(!row){row={id:effect.targetId,project_id:projectId,xmin:'10'};rows[table].push(row);}Object.assign(row,structuredClone(effect.data));}}

test('an actual radar job prepares grounded findings and scan state without mutating sources',async()=>{
 const run=await runScan(freshRows());assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.equal(run.client.writes,0);assert.equal(run.fx.modelTurns,1);assert.equal(run.prepared.result.success,true);assert.equal(run.prepared.effects.filter(item=>item.type==='SCAN_FINDING').length,1);assert.equal(run.prepared.effects.find(item=>item.type==='SCAN_STATE').data.status,'COMPLETED');
});

test('unchanged complete sources reuse a valid zero-result historical scan even after provider change',async()=>{
 const rows=freshRows(),[contract,work]=rows.documents;
 rows.document_scan_state=[{id:'60000000-0000-4000-8000-000000000001',project_id:projectId,work_doc_id:work.id,contract_doc_ids:[contract.id],contract_signature:buildDocumentSetFingerprint([contract]),work_signature:buildDocumentFingerprint(work),scan_signature:buildScanMemorySignature({engineVersion:CONTRACT_SCAN_MEMORY_VERSION,projectId,contractFingerprint:buildDocumentSetFingerprint([contract]),workFingerprint:buildDocumentFingerprint(work),relatedWorkFingerprint:buildDocumentSetFingerprint([]),aiIdentity:'Local AI:qwen3:4b'}),status:'COMPLETED',findings_count:0,xmin:'4'}];
 const run=await runScan(rows);assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.equal(run.fx.modelTurns,0);assert.equal(run.prepared.result.memory.unchanged,1);assert.equal(run.prepared.effects.length,0);
});

test('unchanged newly checked sources and results never run the model again',async()=>{
 const rows=freshRows(),first=await runScan(rows);assert.equal(first.job.state,'SUCCEEDED',first.failure?.stack);applyPrepared(rows,first.prepared);const again=await runScan(rows);assert.equal(again.job.state,'SUCCEEDED',again.failure?.stack);assert.equal(again.fx.modelTurns,0);assert.equal(again.prepared.result.memory.unchanged,1);
});

test('neutral source text cannot produce an actionable radar card',async()=>{
 const rows=freshRows();rows.documents[1].extracted_text='הישיבה נפתחה בשעה תשע.';const neutral={...candidate,category:'אירוע שטח',contract_quote:null,work_quote:rows.documents[1].extracted_text,comparison:{work:{...claim,role:'EVENT',subject:'הישיבה',attribute:'OTHER',value:null},baseline:null}};
 const run=await runScan(rows,{},[neutral]);assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.equal(run.prepared.effects.filter(item=>item.type==='SCAN_FINDING'&&!item.data.delete_automatic).length,0);
});

test('a fabricated source quote leaves existing findings intact and does not mark a document complete',async()=>{
 const rows=freshRows(),run=await runScan(rows,{},[{...candidate,work_quote:'הקבלן נדרש לתשלום שלא קיים במקור.'}]);assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.equal(run.prepared.result.partial,true);assert.equal(run.prepared.effects.filter(item=>item.type==='SCAN_FINDING').length,0);assert.ok(run.prepared.effects.some(item=>item.type==='SCAN_STATE'&&item.data.status==='ERROR'));
});

test('a partly unread PDF remains skipped with no model turn or completed scan state',async()=>{
 const rows=freshRows();Object.assign(rows.documents[1],{title:'mixed.pdf',storage_path:'mixed.pdf',parsed_json:{source_reading:{format:'pdf',total_pages:2,readable_pages:1,pages:[{page:1,status:'READABLE',chars:80},{page:2,status:'UNREADABLE',chars:0}]}},ocr_status:'REQUIRES_REVIEW'});
 const run=await runScan(rows,{workDocId:radarIds.work});assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.equal(run.fx.modelTurns,0);assert.equal(run.prepared.result.partial,true);assert.ok(run.prepared.effects.some(item=>item.type==='SCAN_STATE'&&item.data.status==='SKIPPED'));assert.ok(!run.prepared.effects.some(item=>item.type==='SCAN_STATE'&&item.data.status==='COMPLETED'));
});

test('preview source loading is a complete read-only operation and contains no generated answer',async()=>{
 assert.equal(typeof preview.loadRadarPreview,'function');const rows=freshRows(),first=await runScan(rows);applyPrepared(rows,first.prepared);const client=radarReadClient(rows),finding=rows.contradictions[0],loaded=await preview.loadRadarPreview(client,projectId,finding.id,'C-'+finding.id.replaceAll('-','').slice(0,6));assert.equal(loaded.diagnostics.success,true);assert.equal(loaded.diagnostics.localResult,undefined);assert.equal(client.writes,0);assert.equal(loaded.diagnostics.coverage.project.complete,true);
});

test('an explicit preview job validates the known pair and returns only a saved answer without business effects',async()=>{
 assert.equal(typeof preview.runRadarPreview,'function');const rows=freshRows(),first=await runScan(rows);applyPrepared(rows,first.prepared);const finding=rows.contradictions[0],client=radarReadClient(rows),fx=queueFixture({onGenerate:async()=>JSON.stringify({contradiction_confirmed:true,explanation:'נמצאו הוראות שונות לגבי אחוז הצמנט.',missing_evidence:[],confidence:.9})});
 fx.handler={validate:raw=>raw,execute:(_payload,execution)=>preview.runRadarPreview(client,{findingId:finding.id,findingRef:'C-'+finding.id.replaceAll('-','').slice(0,6)},execution)};await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();const job=[...fx.rows.values()][0];assert.equal(job.state,'SUCCEEDED');assert.equal(job.result.localResult.contradiction_confirmed,true);assert.equal(client.writes,0);assert.equal(fx.modelTurns,1);
});

test('a preview cannot confirm invented saved source evidence or incomplete reading',async()=>{
 assert.equal(typeof preview.runRadarPreview,'function');const rows=freshRows(),first=await runScan(rows);applyPrepared(rows,first.prepared);rows.contradictions[0].evidence_data.work_quote='מקור שלא קיים';const fx=queueFixture();fx.handler={validate:raw=>raw,execute:(_payload,execution)=>preview.runRadarPreview(radarReadClient(rows),{findingId:rows.contradictions[0].id,findingRef:'C-TEST'},execution)};await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal([...fx.rows.values()][0].state,'FAILED');assert.equal(fx.modelTurns,0);
});

function httpSetup(){const rows=radarRows();Object.assign(rows.contradictions[0],{source_execution_doc_id:radarIds.work,target_contract_doc_id:radarIds.contract,evidence_data:{...candidate,analysis_instruction_version:'fixture'}});globalThis.__radarClient=radarReadClient(rows);globalThis.__oldRadarTurns=0;
 const fx=queueFixture(),handler={validate:raw=>raw,execute:async()=>({result:{success:true},effects:[]})},worker={initialize:async()=>{},run:async()=>{},abort:()=>{}};
 globalThis.__radarService=createAiJobService({store:fx.store,worker,authenticate:async()=>{const user=await globalThis.__radarClient.auth.getUser();return user.data.user;},resolveOwner:async()=>ownerId,ownsProject:async(owner,project)=>owner===ownerId&&project===projectId,readProfile:async()=>savedProfile,handlerFor:()=>handler});return fx;
}
const httpRequest=(url,body)=>new Request('http://localhost'+url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
test('the real radar POST accepts one saved job while status GET does not start any execution',async()=>{
 const fx=httpSetup(),route=await import('../src/app/api/scan/route.ts'),response=await route.POST(httpRequest('/api/scan',{projectId,requestKey:'radar-button'}));assert.equal(response.status,202);const job=(await response.json()).job;assert.equal(job.kind,'scan');assert.equal(job.state,'QUEUED');assert.equal(globalThis.__radarClient.writes,0);assert.equal(globalThis.__oldRadarTurns,0);
 const status=await route.GET(httpRequest('/api/scan?projectId='+projectId));assert.equal(status.status,200);assert.equal(fx.rows.size,1);assert.equal(globalThis.__oldRadarTurns,0);
});
test('the real preview GET reads sources without generation and the explicit POST enqueues verification',async()=>{
 const fx=httpSetup(),route=await import('../src/app/api/scan/preview/route.ts');const response=await route.GET(httpRequest('/api/scan/preview?findingRef=C-500000'));assert.equal(response.status,200);const body=await response.json();assert.equal(body.localResult,undefined);assert.equal(globalThis.__oldRadarTurns,0);assert.equal(fx.rows.size,0);
 const accepted=await route.POST(httpRequest('/api/scan/preview',{projectId,requestKey:'preview-button',findingId:radarIds.finding,findingRef:'C-500000',clientContextId:radarIds.finding}));assert.equal(accepted.status,202);assert.equal((await accepted.json()).job.kind,'scan_preview');assert.equal(globalThis.__oldRadarTurns,0);
});

test('the radar browser action sends an idempotent job request and observes the saved result',async()=>{
 const original=globalThis.fetch,requests=[],job={id:'70000000-0000-4000-8000-000000000001',projectId,kind:'scan',state:'QUEUED',revision:1,conversationId:null,clientContextId:radarIds.work,result:null,error:null};
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});return Response.json({success:true,job:options?.method==='POST'?job:{...job,state:'SUCCEEDED',revision:3,result:{success:true,found:1,memory:{scanned:1,unchanged:0,total:1}}}},{status:options?.method==='POST'?202:200});};
 try{const api=await import('../src/components/features/contradiction-radar/api/contradictionRadarApi.ts'),result=await api.rescanRadarItem(projectId,radarIds.work);assert.equal(result.found,1);assert.equal(requests.length,2);assert.ok(JSON.parse(requests[0].options.body).requestKey);assert.equal(JSON.parse(requests[0].options.body).clientContextId,radarIds.work);assert.equal(requests[1].options?.method,undefined);}finally{globalThis.fetch=original;}
});
test('the preview offers an explicit check button and does not claim generation while reading saved diagnostics',async()=>{
 const {LocalAiResultView}=await import('../src/app/local-ai-check/LocalAiCheckClient.tsx');
 const view=renderToStaticMarkup(React.createElement(LocalAiResultView,{findingRef:'C-500000',result:{projectId,findingId:radarIds.finding},error:'',isExtracting:false,extractionStatus:'',isApplyingReview:false,reviewStatus:'',onReextract:async()=>{},onApplyCorrection:async()=>{},onCheck:async()=>{},onCancel:async()=>{},isChecking:false}));assert.ok(view.includes('Проверить с помощником'));const loading=renderToStaticMarkup(React.createElement(LocalAiResultView,{findingRef:'C-500000',result:null,error:'',isExtracting:false,extractionStatus:'',isApplyingReview:false,reviewStatus:'',onReextract:async()=>{},onApplyCorrection:async()=>{}}));assert.ok(!loading.includes('Модель читает'));
});

test('a later documented approval prevents the previous conflicting instruction becoming a current card',async()=>{
 const rows=freshRows();const first=await runScan(rows,{workDocId:radarIds.work});assert.equal(first.prepared.effects.filter(effect=>effect.type==='SCAN_FINDING').length,1);
 rows.documents.push({...rows.documents[1],id:'40000000-0000-4000-8000-000000000003',title:'אישור 02.01.2026.txt',content_hash:'c'.repeat(64),extracted_text:'עטיפת הצינור בחול מצומנט 4% אושרה על ידי המתכנן. הנושא הושלם ואין צורך בפעולה נוספת.'});
 const later=await runScan(rows,{workDocId:radarIds.work});assert.equal(later.job.state,'SUCCEEDED',later.failure?.stack);assert.equal(later.prepared.effects.filter(effect=>effect.type==='SCAN_FINDING'&&!effect.data.delete_automatic).length,0);
});
test('a changed related source rechecks its affected pair and preserves an unrelated completed document',async()=>{
 const rows=freshRows();rows.documents.push({...rows.documents[1],id:'40000000-0000-4000-8000-000000000003',title:'המשך 02.01.2026.txt',content_hash:'c'.repeat(64),extracted_text:'בהמשך להוראה: עטיפת הצינור תבוצע בחול מצומנט 4%.'},{...rows.documents[1],id:'40000000-0000-4000-8000-000000000004',title:'ביטוח 03.01.2026.txt',content_hash:'d'.repeat(64),extracted_text:'תעודת הביטוח עודכנה ונמסרה למנהל הפרויקט.'});
 const first=await runScan(rows,{},[]);assert.equal(first.job.state,'SUCCEEDED',first.failure?.stack);applyPrepared(rows,first.prepared);rows.documents[2].extracted_text+=' יש לתאם את עטיפת הצינור מול המתכנן.';rows.documents[2].extracted_text_hash=null;
 const changed=await runScan(rows,{},[]);assert.equal(changed.job.state,'SUCCEEDED',changed.failure?.stack);assert.equal(changed.fx.modelTurns,2);assert.equal(changed.prepared.result.memory.unchanged,1);
});

test('saved radar status covers more than one response page without losing work documents',async()=>{
 const rows=freshRows();rows.document_scan_state=Array.from({length:501},(_,index)=>({id:'60000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),project_id:projectId,work_doc_id:'40000000-0000-4000-8000-'+String(index+10).padStart(12,'0'),status:'COMPLETED',findings_count:1,updated_at:'2026-10-30T12:00:00.000Z'}));const status=await radar.loadProjectScanState(radarReadClient(rows),projectId);assert.equal(status.total,501);assert.equal(status.processed,501);assert.equal(status.found,501);
});

test('a later resolution retains a real closed issue with its source instead of deleting its history',async()=>{
 const rows=freshRows(),first=await runScan(rows,{workDocId:radarIds.work});applyPrepared(rows,first.prepared);const previous=rows.contradictions[0];
 rows.documents.push({...rows.documents[1],id:'40000000-0000-4000-8000-000000000003',title:'אישור 02.01.2026.txt',content_hash:'c'.repeat(64),extracted_text:'עטיפת הצינור בחול מצומנט 4% אושרה על ידי המתכנן. הנושא הושלם ואין צורך בפעולה נוספת.'});
 const later=await runScan(rows,{workDocId:radarIds.work});assert.equal(later.job.state,'SUCCEEDED',later.failure?.stack);const change=later.prepared.effects.find(effect=>effect.targetId===previous.id);assert.equal(change?.data.status,'ARCHIVED');assert.equal(change?.data.evidence_data.archive_meta.resolution_document_id,rows.documents[2].id);assert.ok(!change.data.delete_automatic);
});
test('completed radar work also removes an unsupported automatic technical record while preserving a user conclusion',async()=>{
 const rows=radarRows(),reviewed={...rows.contradictions[0],id:'50000000-0000-4000-8000-000000000002',evidence_data:{user_review:{note:'Keep my conclusion'}}};rows.contradictions.push(reviewed);const run=await runScan(rows);assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.ok(run.prepared.effects.some(effect=>effect.targetId===radarIds.finding&&effect.data.delete_automatic));assert.ok(!run.prepared.effects.some(effect=>effect.targetId===reviewed.id&&effect.data.delete_automatic));
});

test('an active radar operation has an explicit cancel control in the program',async()=>{
 const {RadarWorkspaceView}=await import('../src/components/features/contradiction-radar/RadarWorkspaceView.tsx');const html=renderToStaticMarkup(React.createElement(RadarWorkspaceView,{state:{isScanning:true,isLoading:false,isReviewing:false,progress:0,contractDocsCount:1,executionDocsCount:1,rescanningIds:new Set()},actions:{scanProject:async()=>{},cancelScan:async()=>{}},derived:{contractDocsCount:1,executionDocsCount:1,filterOptions:[],statusFilterOptions:[],filteredFindings:[],hasContradictions:false}}));assert.ok(html.includes('ביטול הבדיקה'));
});

test('retry skipped restricts work to the existing failed queue and leaves a new unrelated document alone',async()=>{
 const rows=freshRows();rows.document_scan_state=[{id:'60000000-0000-4000-8000-000000000001',project_id:projectId,work_doc_id:radarIds.work,status:'ERROR',scan_signature:'failed',updated_at:'2026-10-30',xmin:'4'}];rows.documents.push({...rows.documents[1],id:'40000000-0000-4000-8000-000000000004',title:'ביטוח.txt',extracted_text:'תעודת הביטוח נמסרה למנהל הפרויקט.'});
 const run=await runScan(rows,{retrySkipped:true},[]);assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.equal(run.fx.modelTurns,1);assert.equal(run.prepared.result.memory.total,1);
});
test('unavailable governing reference chunks cannot become a completed partial comparison',async()=>{
 const rows=freshRows();rows.reference_documents=[{id:'81000000-0000-4000-8000-000000000001',contractor_id:ownerId,project_id:null,status:'READY',title:'reference'}];
 const run=await runScan(rows,{},[],client=>{const from=client.from;client.from=table=>{const query=from(table);if(table==='reference_document_chunks')query.then=(resolve,reject)=>Promise.resolve({data:null,count:null,error:{message:'Synthetic unavailable clause'}}).then(resolve,reject);return query;};return client;});assert.equal(run.job.state,'FAILED');assert.equal(run.fx.modelTurns,0);assert.equal(run.client.writes,0);
});
test('a manually changed test profile reuses a zero-result context recorded beyond the first history page',async()=>{
 const rows=freshRows(),first=await runScan(rows,{},[]);applyPrepared(rows,first.prepared);const otherProfile={...savedProfile,model:'fixture-another-manually-saved-model'};
 rows.project_ai_jobs=Array.from({length:502},(_,index)=>({id:'82000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),project_id:projectId,owner_id:ownerId,kind:'scan',state:'SUCCEEDED',profile_snapshot:index===0?savedProfile:otherProfile,created_at:String(index).padStart(5,'0')}));
 const run=await runScan(rows,{},[],client=>client,otherProfile);assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.equal(run.fx.modelTurns,0);assert.equal(run.prepared.result.memory.unchanged,1);
});

test('an explicitly cancelled preview explains that the earlier answer was retained',async()=>{
 const {LocalAiResultView}=await import('../src/app/local-ai-check/LocalAiCheckClient.tsx'),html=renderToStaticMarkup(React.createElement(LocalAiResultView,{findingRef:'C-500000',result:{projectId,findingId:radarIds.finding,job:{state:'CANCELLED'}},error:'',isExtracting:false,extractionStatus:'',isApplyingReview:false,reviewStatus:'',onReextract:async()=>{},onApplyCorrection:async()=>{}}));assert.ok(html.includes('Проверка отменена. Предыдущий ответ сохранён.'));
});

test('replacing a previously reviewed supported issue preserves its archived history through the final cleanup',async()=>{
 const rows=radarRows();Object.assign(rows.contradictions[0],{title:candidate.title,category:candidate.category,description:'דוגמה סינתטית: הוראות שונות לגבי צמנט.',severity:'HIGH',source_execution_doc_id:radarIds.work,target_contract_doc_id:radarIds.contract,evidence_data:{...candidate,user_review:{note:'Synthetic history retained'}}});const run=await runScan(rows,{workDocId:null,retrySkipped:false});assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.ok(run.prepared.effects.some(effect=>effect.targetId===radarIds.finding&&effect.data.status==='ARCHIVED'));assert.ok(!run.prepared.effects.some(effect=>effect.targetId===radarIds.finding&&effect.data.delete_automatic));
});

test('reconciliation can read owned financial letter links while all money and letters stay immutable',async()=>{
 const rows=radarRows();Object.assign(rows.contradictions[0],{title:candidate.title,category:candidate.category,source_execution_doc_id:radarIds.work,target_contract_doc_id:radarIds.contract,evidence_data:{...candidate,user_review:{note:'Keep my conclusion'}}});rows.pricing_ledger=[{id:'91000000-0000-4000-8000-000000000001',project_id:projectId,contradiction_id:radarIds.finding,quantity:3,unit_price_excl_vat:.03,vat_rate:.18,xmin:'7'}];rows.vo_letters=[{id:'92000000-0000-4000-8000-000000000001',project_id:projectId,status:'DRAFT'}];rows.vo_letter_items=[{id:'93000000-0000-4000-8000-000000000001',letter_id:rows.vo_letters[0].id,ledger_item_id:rows.pricing_ledger[0].id}];const before=structuredClone(rows),run=await runScan(rows);assert.equal(run.job.state,'SUCCEEDED',run.failure?.stack);assert.deepEqual(rows,before);assert.ok(!run.prepared.effects.some(effect=>effect.targetId===radarIds.finding&&effect.data.delete_automatic));assert.ok(run.prepared.effects.every(effect=>effect.type==='SCAN_FINDING'||effect.type==='SCAN_STATE'));
});
