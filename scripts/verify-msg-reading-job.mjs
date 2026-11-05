import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {registerHooks} from 'node:module';
import {msgFixture,nativeMsgFixture,uncompressedRtf} from './fixtures/msg-fixtures.mjs';import {digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {queueFixture,projectId,savedProfile} from './codex-runtime/queue-fixtures.mjs';import {ownerId} from './codex-runtime/fixtures.mjs';
import {pricingRows,pricingReadClient,pricingIds,applyPricingEffects} from './codex-runtime/pricing-fixtures.mjs';
let nativeCalls=0;globalThis.__msgNativeForJobTest=async()=>{nativeCalls++;return nativeMsgFixture();};
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.endsWith('/src/server/documents/msg-native.server.ts'))return {url:'data:text/javascript,export const extractMsgNative=(...args)=>globalThis.__msgNativeForJobTest(...args)',shortCircuit:true};return result;}});
const {createAiWorker}=await import('../src/server/ai/worker.server.ts'),{createDocumentHandler}=await import('../src/server/ai/handlers/document.ts');
const {createReadingPatch,resolveReadingVersion,getCurrentDocumentReading}=await import('../src/utils/document-reading-history.ts');
const {buildVisualSourceManifest}=await import('../src/utils/visual-source-manifest.ts');
const {assembleDocumentReading}=await import('../src/utils/document-reading-history.ts');
const {prepareDocumentAnalysisInput}=await import('../src/utils/document-text-extraction.ts');
async function run({operation='read_source',repeat=false,tamper,validated=false,changedSource=false,body='יש לשמור מעבר פתוח.',attachments=[],oldText='',rtf,rtfInSync}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'contractorsystem-msg-job-')),prior=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=directory;
 try{
  const file=msgFixture({body,attachments,rtf,rtfInSync}),rows=pricingRows(),doc=rows.documents.find(d=>d.id===pricingIds.work);Object.assign(doc,{title:'source.msg',content_hash:changedSource?'9'.repeat(64):digest(file),extracted_text:oldText,extracted_text_hash:digest(oldText),ocr_status:'REQUIRES_REVIEW',ai_status:validated?'VALIDATED':'PENDING',parsed_json:{owner_note:'keep',summary:'Manual summary',financial_data:{total_amount:123}}});
  const before=structuredClone(rows);let database=pricingReadClient(rows),prepared;const startNative=nativeCalls;
  const fx=queueFixture({onGenerate:async()=>JSON.stringify({type:'Instruction',category:'EXECUTION',is_reference:false,reference_family:null,authority_scope:null,incorporated_by_contract:null,summary:'Keep the route open.',full_markdown:'Not the source',financial_data:{total_amount:null,items:[]},date:null,parties:[],key_terms:[],warnings:[]})});
  const handler=createDocumentHandler({database:()=>database,download:async()=>file,runtimeDir:path.join(directory,'ContractorSystem','ai-runtime'),models:async()=>({data:[{model:savedProfile.model,inputModalities:['text','image']}]})});
  async function once(key){await fx.store.enqueue(ownerId,projectId,'document_analysis',{documentId:doc.id,operation},key,savedProfile,{clientContextId:doc.id});await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>({...handler,async execute(payload,execution){return prepared=await handler.execute(payload,execution);}}),clock:fx.clock,startedAt:0}).run();if(prepared&&[...fx.rows.values()].at(-1).state==='SUCCEEDED')applyPricingEffects(rows,prepared);}
  await once('msg-reading-job');const firstNative=nativeCalls-startNative,firstModel=fx.modelTurns,firstDoc=structuredClone(rows.documents.find(d=>d.id===doc.id));
  if(repeat){tamper?.(rows.documents.find(d=>d.id===doc.id));database=pricingReadClient(rows);await once('msg-reading-repeat');}
  return {rows,before,doc:rows.documents.find(d=>d.id===doc.id),firstDoc,prepared,job:[...fx.rows.values()].at(-1),firstNative,nativeTurns:nativeCalls-startNative,firstModel,modelTurns:fx.modelTurns};
 }finally{if(prior===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=prior;const resolved=await fs.realpath(directory),base=await fs.realpath(os.tmpdir());assert.equal(path.dirname(resolved),base);assert.ok(path.basename(resolved).startsWith('contractorsystem-msg-job-'));await fs.rm(resolved,{recursive:true,force:false});}
}
test('upload_and_analyze_use_the_full_msg_reader',async()=>{
 const result=await run({operation:'analyze'});assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.doc.parsed_json.source_reading?.format,'MSG');assert.equal(result.doc.parsed_json.source_reading.complete,true);assert.ok(result.doc.extracted_text.includes('יש לשמור מעבר פתוח.'));assert.equal(result.modelTurns,1);assert.equal(result.nativeTurns,1);assert.deepEqual(result.rows.pricing_ledger,result.before.pricing_ledger);
});
test('unchanged_complete_msg_skips_all_inference',async()=>{
 const result=await run({repeat:true});assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.prepared.result.cached,true);assert.equal(result.modelTurns,0);assert.equal(result.nativeTurns,result.firstNative);assert.equal(result.doc.extracted_text,result.firstDoc.extracted_text);assert.deepEqual(result.doc.parsed_json.source_reading,result.firstDoc.parsed_json.source_reading);
});

test('a_legacy_text_proof_cannot_bypass_the_msg_reader',async()=>{
 const result=await run({repeat:true,tamper:document=>{document.parsed_json.source_reading.format='TEXT';delete document.parsed_json.source_reading.msg;}});
 assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.prepared.result.cached,false);assert.equal(result.doc.parsed_json.source_reading.format,'MSG');assert.equal(result.modelTurns,0);
 assert.ok(result.doc.parsed_json.source_reading_history.some(version=>version.reading?.format==='TEXT'),'Keep the previous evidence even when the text is unchanged');
});

test('legacy_full_msg_with_unsynchronized_rtf_is_not_reused',async()=>{
 const result=await run({body:'Old instruction',rtf:uncompressedRtf('{\\rtf1 New instruction}'),rtfInSync:false,repeat:true,tamper:document=>{
  const reading=document.parsed_json.source_reading;reading.complete=true;reading.nativeComplete=true;reading.issues=[];reading.msg.issues=[];for(const part of reading.msg.parts){part.issues=[];part.status='READ';part.nativeComplete=true;}
 }});
 assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.prepared.result.cached,false);assert.equal(result.doc.parsed_json.source_reading.complete,false);assert.equal(result.modelTurns,0);assert.ok(result.doc.extracted_text.includes('Old instruction'));
});
test('read_source_only_records_its_owned_document_and_preserves_manual_business_fields',async()=>{
 const result=await run({validated:true});assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.doc.ai_status,'VALIDATED');assert.equal(result.doc.parsed_json.owner_note,'keep');assert.equal(result.doc.parsed_json.summary,'Manual summary');assert.deepEqual(result.doc.parsed_json.financial_data,{total_amount:123});assert.equal(result.modelTurns,0);
 assert.ok(result.prepared.effects.every(e=>e.type==='DOCUMENT_ANALYSIS'&&e.targetId===pricingIds.work));for(const table of Object.keys(result.before).filter(t=>t!=='documents'))assert.deepEqual(result.rows[table],result.before[table],table);
});
for(const key of ['ownerId','projectId','documentId'])test('changed_parent_or_other_scope_cannot_reuse_parts_'+key,async()=>{
 const result=await run({repeat:true,tamper:doc=>{doc.parsed_json.source_reading.msg.scope={ownerId,projectId,documentId:doc.id,sourceHash:doc.content_hash,...{[key]:'99999999-9999-4999-8999-999999999999'}};}});
 assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.prepared.result.cached,false);assert.deepEqual(result.doc.parsed_json.source_reading.msg.scope,{ownerId,projectId,documentId:pricingIds.work,sourceHash:result.doc.content_hash});assert.ok(result.nativeTurns>result.firstNative);
});
test('changed_source_is_rejected_before_reading',async()=>{const result=await run({changedSource:true});assert.equal(result.job.state,'FAILED');assert.equal(result.job.error.code,'AI_SOURCE_CHANGED');assert.equal(result.nativeTurns,0);assert.deepEqual(result.rows,result.before);});
test('same_text_keeps_changed_part_evidence',async()=>{
 const result=await run(),doc=result.doc,proof=structuredClone(doc.parsed_json.source_reading),old=structuredClone(proof);proof.complete=false;proof.issues=['MSG_NATIVE_EXTRACTION_WARNING'];proof.msg.parts[0].status='REQUIRES_REVIEW';proof.msg.parts[0].nativeComplete=false;proof.msg.parts[0].issues=['MSG_NATIVE_EXTRACTION_WARNING'];
 const patch=createReadingPatch(doc,{text:doc.extracted_text,textHash:doc.extracted_text_hash,verification:proof,units:[],visualDescriptions:[]});assert.equal(patch.extracted_text,doc.extracted_text);assert.ok(patch.parsed_json.source_reading_history.some(v=>v.text===doc.extracted_text&&JSON.stringify(v.reading)===JSON.stringify(old)));
});
test('partial_msg_keeps_previous_and_full_attempt_with_matching_ranges',async()=>{
 const body='א'.repeat(130001),file=msgFixture({body,attachments:[{name:'archive.zip',data:Buffer.from('PK archive')}]}),manifest=await buildVisualSourceManifest(file,'source.msg'),reading=assembleDocumentReading(manifest,[]);
 reading.verification.createdBy={jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rulesVersion:'visual-reading-rules-v2',profileRevision:1};
 const doc={id:pricingIds.work,project_id:projectId,title:'source.msg',content_hash:digest(file),extracted_text:'Earlier source text.',extracted_text_hash:digest('Earlier source text.'),parsed_json:{owner_note:'keep'}};
 const patch=createReadingPatch(doc,reading);assert.equal(patch.extracted_text,doc.extracted_text);const version=patch.parsed_json.source_reading_history.find(v=>v.text===reading.text);assert.ok(version.text.includes(body));assert.equal(version.textHash,digest(version.text));assert.ok(version.reading.msg.parts[0].textRanges.every(r=>r.end<=version.text.length));assert.equal(patch.ocr_status,'REQUIRES_REVIEW');
 assert.ok(patch.parsed_json.source_reading.msg.parts.every(p=>p.textRanges.every(r=>r.end<=patch.extracted_text.length)));assert.ok(resolveReadingVersion({...doc,...patch},{textHash:version.textHash}).text.includes(body));
});
test('raw_msg_extraction_requires_the_full_source_reader',async()=>{await assert.rejects(()=>prepareDocumentAnalysisInput(msgFixture(),'source.msg'),/MSG_SOURCE_READING_REQUIRED/);});
test('analysis_after_a_partial_read_keeps_proof_ranges_with_the_saved_version',async()=>{
 const result=await run({operation:'analyze',body:'New complete native body.',attachments:[{name:'archive.zip',data:Buffer.from('PK archive')}],oldText:'Earlier source text.'});
 assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.job.result.partial,true);assert.equal(result.doc.extracted_text,'Earlier source text.');
 assert.ok(result.doc.parsed_json.source_reading.msg.parts.every(p=>p.textRanges.every(r=>r.end<=result.doc.extracted_text.length)));
});
test('a_catalog_cannot_trust_a_message_reading_copied_from_another_document_or_project',async()=>{
 const {doc}=await run();assert.equal(getCurrentDocumentReading(doc).ready,true);
 for(const changed of [{id:'99999999-9999-4999-8999-999999999999'},{project_id:'99999999-9999-4999-8999-999999999999'}])assert.equal(getCurrentDocumentReading({...doc,...changed}).ready,false);
 const unscoped=structuredClone(doc);delete unscoped.parsed_json.source_reading.msg.scope;assert.equal(getCurrentDocumentReading(unscoped).ready,false);
});
