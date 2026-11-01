import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import '../src/server/ai/worker.server.ts';
import {createAiJobClient} from '../src/utils/ai-job-client.ts';
import * as actions from '../src/components/documents/documentAiApi.ts';
import {makeTextInput} from '../src/utils/document-text-extraction.ts';
import {prepareDocumentAiInput} from '../src/utils/document-ai-input.ts';
import {validateDocumentAnalysis} from '../src/server/ai/handlers/document.ts';
import {assessDocumentSourceReadiness} from '../src/utils/document-source-readiness.ts';
import {readingAnalysisFingerprint} from '../src/utils/document-reading-history.ts';
import {refreshWorkChangeReading} from '../src/utils/work-change-reading-server.ts';
import {docx,paragraph} from './fixtures/docx-image-fixtures.mjs';
import {digest,literal,sourceDocument,visualRegistry} from './codex-runtime/visual-reading-fixtures.mjs';
import {savedProfile} from './codex-runtime/queue-fixtures.mjs';
const project=sourceDocument().project_id,id=sourceDocument().id,jobId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const job=(overrides={})=>({id:jobId,projectId:project,kind:'document_analysis',clientContextId:id,conversationId:null,state:'QUEUED',revision:1,result:null,error:null,operation:'analyze',...overrides});
const reply=()=>({type:'Instruction',category:'EXECUTION',is_reference:false,reference_family:null,authority_scope:null,incorporated_by_contract:null,summary:'Source summary',full_markdown:'Not the original source',financial_data:{total_amount:null,items:[]},date:null,parties:[],key_terms:[],warnings:[]});

test('upload_starts_program_job_without_chat',async()=>{
 assert.equal(typeof actions.uploadDocumentAndAnalyze,'function');const before=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});
  if(options?.body instanceof FormData)return Response.json({success:true,duplicate:true,document:sourceDocument({ocr_status:'REQUIRES_REVIEW'})});
  if(String(url)==='/api/documents/process')return Response.json({success:true,job:job()});
  if(String(url).includes('/api/ai/jobs/'))return Response.json({success:true,job:job({state:'SUCCEEDED',revision:3,result:{documentId:id,success:true}})});
  return Response.json({success:true,documents:[sourceDocument()]});};
 try{const saved=await actions.uploadDocumentAndAnalyze(project,new File(['source'],'source.docx'),'EXECUTION');assert.equal(saved.id,id);
  const started=requests.find(r=>r.url==='/api/documents/process');assert.equal(JSON.parse(started.options.body).operation,'analyze');
  assert.ok(!requests.some(r=>/extract-text|chat|consultant/.test(r.url)));assert.equal(requests.filter(r=>r.url==='/api/documents/process').length,1);
 }finally{globalThis.fetch=before;}
});
test('reload_restores_read_or_analyze_with_correct_phase',async()=>{
 const seen=[],rows=[job({operation:'read_source',state:'RUNNING',revision:2,progress:{phase:'reading',completedUnits:1,totalUnits:3}}),job({operation:'read_source',state:'RUNNING',revision:2,progress:{phase:'reading',completedUnits:2,totalUnits:3}}),job({operation:'read_source',state:'SUCCEEDED',revision:3,result:{documentId:id}})];
 const client=createAiJobClient({sleep:async()=>{},fetchImpl:async()=>Response.json({success:true,job:rows.shift()})});
 await client.observe(jobId,{projectId:project,onProgress:value=>seen.push(value)});
 assert.deepEqual(seen.filter(r=>r.progress).map(r=>r.progress.completedUnits),[1,2]);assert.ok(seen.every(r=>r.operation==='read_source'));
});
test('project_switch_ignores_late_result',async()=>{
 assert.equal(typeof actions.documentJobMatches,'function');assert.equal(actions.documentJobMatches(job(),project,id,'analyze'),true);
 assert.equal(actions.documentJobMatches(job(),jobId,id,'analyze'),false);assert.equal(actions.documentJobMatches(job({operation:'read_source'}),project,id,'analyze'),false);
 const before=globalThis.fetch,controller=new AbortController();globalThis.fetch=async()=>{controller.abort();return Response.json({success:true,job:job()});};
 try{await assert.rejects(actions.requestDocumentAnalysis(project,id,{signal:controller.signal}));}finally{globalThis.fetch=before;}
});

const hook=registerHooks({resolve(s,c,n){if(s==='@/utils/supabase/server')return {url:'data:text/javascript,export const createClient=async()=>globalThis.__readingFlowDb;',shortCircuit:true};return n(s,c);}});
const extract=await import('../src/app/api/documents/extract-text/route.ts'),validate=await import('../src/app/api/documents/validate/route.ts');hook.deregister();
function database(row,bytes){
 const counts={updates:0,downloads:0},hooks={beforeUpdate:null};
 return {counts,hooks,auth:{getUser:async()=>({data:{user:{id:'owner'}}})},storage:{from(){return {download:async()=>{counts.downloads++;return {data:new Blob([bytes]),error:null};}};}},from(table){
  let patch;const filters=[],q={select(){return q;},eq(key,value){filters.push(current=>key==='parsed_json'&&typeof value==='string'?JSON.stringify(current[key])===value:current[key]===value);return q;},is(key,value){filters.push(current=>current[key]==value);return q;},
   async maybeSingle(){return {data:table==='projects'?{id:project}:structuredClone(row),error:null};},update(value){patch=value;hooks.beforeUpdate?.();return q;},
   then(ok,bad){const matched=filters.every(filter=>filter(row));if(matched){counts.updates++;Object.assign(row,patch);}return Promise.resolve({error:null,count:matched?1:0}).then(ok,bad);}};return q;
 }};
}
const request=(body,method='POST')=>new Request('http://localhost/api/documents/action',{method,headers:{'content-type':'application/json'},body:JSON.stringify({projectId:project,documentId:id,...body})});
test('old_local_read_does_not_downgrade_visual_proof',async()=>{
 const bytes=docx({body:paragraph('Old native source'),media:{},rels:[]}),row=sourceDocument({title:'source.docx',content_hash:digest(bytes),storage_bucket:'documents',storage_path:'p/source.docx'});
 row.parsed_json.source_reading=visualRegistry({sourceHash:digest(bytes),format:'DOCX'});const before=structuredClone(row),db=database(row,bytes);globalThis.__readingFlowDb=db;
 assert.equal((await extract.POST(request({force:true}))).status,200);assert.deepEqual(row,before);assert.equal(db.counts.updates,0);
});
test('validation_cannot_replace_server_reading_registry',async()=>{
 const row=sourceDocument({ai_status:'SCANNED'});Object.assign(row.parsed_json,{source_reading_units:[{text:'server transcript'}],source_reading_history:[{text:'old server source'}],full_markdown:literal});
 const before=structuredClone(row.parsed_json);globalThis.__readingFlowDb=database(row,Buffer.from('unused'));
 const response=await validate.PUT(request({validatedData:{type:'Instruction',summary:'Owner summary',owner_note:'Owner note',source_reading:{complete:true},source_reading_units:[],source_reading_history:[],full_markdown:'forged source'}},'PUT'));
 assert.equal(response.status,200);for(const key of ['source_reading','source_reading_units','source_reading_history','full_markdown'])assert.deepEqual(row.parsed_json[key],before[key]);
 assert.equal(row.parsed_json.owner_note,'Owner note');assert.equal(row.ai_status,'VALIDATED');
});
test('a_visual_reading_saved_during_old_extraction_is_not_overwritten',async()=>{
 const bytes=docx({body:paragraph('Old local source'),media:{},rels:[]}),row=sourceDocument({title:'source.docx',content_hash:digest(bytes),storage_bucket:'documents',storage_path:'p/source.docx',ocr_status:'REQUIRES_REVIEW',parsed_json:{}});
 const db=database(row,bytes),download=db.storage.from;db.storage.from=()=>({download:async name=>{const result=await download().download(name);row.extracted_text=literal;row.extracted_text_hash=digest(literal);row.ocr_status='COMPLETED';row.parsed_json={source_reading:visualRegistry({sourceHash:digest(bytes),format:'DOCX'})};return result;}});globalThis.__readingFlowDb=db;
 assert.equal((await extract.POST(request({force:true}))).status,200);assert.equal(row.extracted_text,literal);assert.equal(row.parsed_json.source_reading.version,'visual-source-reading-v2');assert.equal(db.counts.updates,0);
});
test('manual_validation_cannot_race_a_new_server_reading',async()=>{
 const row=sourceDocument({ai_status:'SCANNED'}),db=database(row,Buffer.from('unused'));globalThis.__readingFlowDb=db;
 db.hooks.beforeUpdate=()=>{row.parsed_json={...row.parsed_json,source_reading:{...row.parsed_json.source_reading,manifestHash:'9'.repeat(64)}};};
 const response=await validate.PUT(request({validatedData:{type:'Instruction',summary:'Owner summary'}},'PUT'));
 assert.equal(response.status,409);assert.equal(row.parsed_json.source_reading.manifestHash,'9'.repeat(64));assert.equal(db.counts.updates,0);assert.equal(row.ai_status,'SCANNED');
});
test('analysis_uses_corrected_source_text_and_keeps_descriptions_outside_quotes',async()=>{
 const description='The diagram shows an access route.',proof=visualRegistry(),prepared=makeTextInput(Buffer.from('source'),'verified',literal,{readingVerification:proof,visualDescriptions:[{unitId:'pdf:1',location:{page:1},text:description}]});
 const input=await prepareDocumentAiInput(prepared,{...savedProfile,images:true},'unused');assert.ok(input.text.includes(literal));assert.ok(input.text.includes(description));
 const output=reply();output.financial_data.items=[{item_code:null,description:'Invented quotation',unit:null,quote:description,quantity:null,unit_price_excl_vat:null}];
 assert.equal(validateDocumentAnalysis(JSON.stringify(output),{...prepared,title:'source.pdf'}).financial_data.items.length,0);
});
test('a_verified_drawing_without_letters_can_be_analyzed_without_fabricating_literal_text',async()=>{
 const proof=visualRegistry({currentTextHash:digest('')});proof.expectedUnits[0]={...proof.expectedUnits[0],literalHasBody:false,visualHasContent:true,textHash:digest('')};
 const visualDescriptions=[{unitId:'pdf:1',location:{page:1},text:'A route connects the work areas.'}],row=sourceDocument({extracted_text:'',extracted_text_hash:digest(''),parsed_json:{source_reading:proof,source_reading_visual_descriptions:visualDescriptions}});
 assert.equal(assessDocumentSourceReadiness(row).extractionComplete,true);
 const prepared=makeTextInput(Buffer.from('source'),'verified','',{readingVerification:proof,visualDescriptions});assert.equal(prepared.extractedText,'');
 const analysis=validateDocumentAnalysis(JSON.stringify(reply()),{...prepared,title:'source.pdf'});assert.equal(analysis.full_markdown,'');assert.equal(analysis.analysis_status,'COMPLETE');
});
test('long_verified_source_is_preserved_exactly_while_limited_analysis_stays_partial',()=>{
 const full='  Exact source line.\n'.repeat(9000)+'\n ',proof=visualRegistry({currentTextHash:digest(full)});
 const prepared=makeTextInput(Buffer.from('source'),'verified',full,{readingVerification:proof});assert.ok(prepared.extractedText===full,'The full source changed');
 const analysis=validateDocumentAnalysis(JSON.stringify(reply()),{...prepared,title:'source.pdf'});assert.equal(analysis.full_markdown,full);assert.equal(analysis.analysis_status,'PARTIAL');
});
test('database_key_order_and_job_provenance_do_not_force_a_second_analysis',()=>{
 const proof=visualRegistry(),reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,child])=>[key,reorder(child)])):value;
 const roundtrip=reorder(proof);roundtrip.createdBy.jobId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 assert.equal(readingAnalysisFingerprint(proof),readingAnalysisFingerprint(roundtrip));roundtrip.expectedUnits[0].textHash='9'.repeat(64);
 assert.notEqual(readingAnalysisFingerprint(proof),readingAnalysisFingerprint(roundtrip));
});
test('work_change_local_refresh_retains_complete_and_partial_visual_readings_without_io',async()=>{
 for(const complete of [true,false]){
  const row=sourceDocument();row.parsed_json.source_reading.complete=complete;if(!complete){row.parsed_json.source_reading.issues=['Unclear source'];row.ocr_status='REQUIRES_REVIEW';}
  const untouched={from(){throw Error('A saved visual reading must not reach a local writer');},storage:{from(){throw Error('Unexpected source download');}}};
  assert.deepEqual(await refreshWorkChangeReading(untouched,project,[row]),{updatedIds:[],failedIds:[]});
 }
});
