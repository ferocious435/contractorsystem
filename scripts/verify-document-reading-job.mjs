import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createAiWorker} from '../src/server/ai/worker.server.ts';
import {queueFixture,projectId,savedProfile} from './codex-runtime/queue-fixtures.mjs';
import {pricingRows,pricingReadClient,pricingIds,applyPricingEffects} from './codex-runtime/pricing-fixtures.mjs';
import {ownerId} from './codex-runtime/fixtures.mjs';
import {docx,paragraph,image} from './fixtures/docx-image-fixtures.mjs';
import {digest,literal} from './codex-runtime/visual-reading-fixtures.mjs';
const load=async file=>import(file).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith(file.slice(2)))return {};throw error;});
const {createDocumentHandler}=await import('../src/server/ai/handlers/document.ts');
const reading=await load('../src/server/ai/handlers/document-reading.ts');
async function run({validated=false,cancel=false,changedSource=false,unclear=false,operation='read_source'}={}){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'contractorsystem-reading-job-')),previous=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=temp;
 try{
  const png=await sharp({create:{width:80,height:50,channels:3,background:'black'}}).png().toBuffer();
  const file=docx({body:paragraph('Before source image')+image()+paragraph('After source image'),media:{'image1.png':png}}),rows=pricingRows();
  const doc=rows.documents.find(d=>d.id===pricingIds.work);
  Object.assign(doc,{title:'source.docx',content_hash:changedSource?'9'.repeat(64):digest(file),extracted_text:'Previous source text.',extracted_text_hash:digest('Previous source text.'),ai_status:validated?'VALIDATED':'PENDING',parsed_json:{owner_note:'keep',summary:'Manual summary',financial_data:{total_amount:123}}});
  const before=structuredClone(rows),database=pricingReadClient(rows);let prepared;
  const fx=queueFixture({onGenerate:async input=>{
   if(cancel){const current=[...fx.rows.values()][0];await fx.store.cancel(ownerId,current.id,current.revision);}
   if(input.outputSchema.properties?.unitId){const region=JSON.parse(input.text.split('SOURCE REGION: ')[1].split('\n')[0]);return JSON.stringify({unitId:region.unitId,viewId:region.viewId,text:literal,tables:[],visualDescription:'',uncertainties:unclear?['Unclear source']:[]});}
   return '{invalid separate analysis';
  }});
  const handler=createDocumentHandler({database:()=>database,download:async()=>file,runtimeDir:path.join(temp,'ContractorSystem','ai-runtime')});
  await fx.store.enqueue(ownerId,projectId,'document_analysis',{documentId:doc.id,operation},'reading-job',savedProfile,{clientContextId:doc.id});
  await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>({...handler,async execute(payload,execution){return prepared=await handler.execute(payload,execution);}}),clock:fx.clock,startedAt:0}).run();
  if(prepared&&[...fx.rows.values()][0].state==='SUCCEEDED')applyPricingEffects(rows,prepared);
  return {rows,before,prepared,job:[...fx.rows.values()][0],modelTurns:fx.modelTurns};
 }finally{if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true});}
}
test('reading_payload_is_strict_and_default_analysis_remains_compatible',()=>{
 const handler=createDocumentHandler();assert.deepEqual(handler.validate({documentId:pricingIds.work}),{documentId:pricingIds.work});
 assert.deepEqual(handler.validate({documentId:pricingIds.work,operation:'read_source'}),{documentId:pricingIds.work,operation:'read_source'});
 for(const payload of [{documentId:pricingIds.work,operation:'shell'},{documentId:pricingIds.work,operation:'read_source',source_reading:{complete:true}}])assert.throws(()=>handler.validate(payload));
});
test('validated_document_can_be_read_without_changing_manual_fields',async()=>{
 assert.equal(typeof reading.stageDocumentReading,'function','Missing atomic document reading stage');
 const result=await run({validated:true}),doc=result.rows.documents.find(d=>d.id===pricingIds.work),before=result.before.documents.find(d=>d.id===pricingIds.work);
 assert.equal(result.job.state,'SUCCEEDED');assert.equal(doc.ai_status,'VALIDATED');assert.equal(doc.category,before.category);
 for(const key of ['owner_note','summary','financial_data'])assert.deepEqual(doc.parsed_json[key],before.parsed_json[key]);
 assert.match(doc.extracted_text,/Before source image[\s\S]*יש להשאיר[\s\S]*After source image/);
 assert.equal(doc.parsed_json.source_reading.version,'visual-source-reading-v2');assert.equal(result.modelTurns,1);
});
test('cancel_or_source_revision_change_commits_nothing',async()=>{
 for(const options of [{cancel:true},{changedSource:true}]){const result=await run(options);assert.ok(['CANCELLED','FAILED'].includes(result.job.state));assert.equal(result.job.result,null);assert.deepEqual(result.rows,result.before);assert.equal(result.prepared?.effects.length??0,0);if(options.changedSource){assert.equal(result.job.error.code,'AI_SOURCE_CHANGED');assert.equal(result.modelTurns,0);}}
});
test('reading_job_cannot_write_ledger_or_findings',async()=>{
 const result=await run();assert.ok(result.prepared,'Reading did not produce its atomic result');assert.ok(result.prepared.effects.length>0);assert.ok(result.prepared.effects.every(e=>e.type==='DOCUMENT_ANALYSIS'&&e.targetId===pricingIds.work));
 assert.deepEqual(result.rows.pricing_ledger,result.before.pricing_ledger);assert.deepEqual(result.rows.contradictions,result.before.contradictions);
 assert.ok(!JSON.stringify(result.job.result).includes('Before source image'));
});
test('reading_success_survives_analysis_output_failure',async()=>{
 const result=await run({operation:'analyze'}),doc=result.rows.documents.find(d=>d.id===pricingIds.work);
 assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.job.result.partial,true);assert.equal(result.job.result.readingSaved,true);
 assert.equal(doc.parsed_json.source_reading.complete,true);assert.match(doc.extracted_text,/יש להשאיר/);
 assert.deepEqual(result.rows.pricing_ledger,result.before.pricing_ledger);
});
test('a_saved_profile_change_rejects_the_running_result_before_commit',async()=>{
 let current={...savedProfile};const fx=queueFixture({onGenerate:async()=>{current={...current,revision:2};return JSON.stringify({answer:'synthetic result'});}});
 await fx.enqueue('profile-change');
 await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0,inspectProfile:async()=>current}).run();
 const job=[...fx.rows.values()][0];assert.equal(job.state,'FAILED');assert.equal(job.error.code,'AI_PROFILE_INVALID');assert.equal(job.result,null);
});
test('partial_reading_job_points_to_the_text_version_that_was_actually_saved',async()=>{
 const result=await run({unclear:true}),doc=result.rows.documents.find(d=>d.id===pricingIds.work);
 assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.job.result.partial,true);assert.equal(doc.extracted_text,'Previous source text.');
 assert.equal(result.job.result.textHash,doc.extracted_text_hash);
});
