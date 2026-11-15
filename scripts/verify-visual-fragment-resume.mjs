import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {registerHooks} from 'node:module';
import {fragmentReadingFixture,sourceDocument,digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {readVisualSource} from '../src/server/ai/visual-source-reader.server.ts';
import {readTargetedFragments} from '../src/server/ai/visual-fragment-reader.server.ts';
import {createSourceFragmentRenderer} from '../src/server/documents/visual-fragment-renderer.server.ts';
import {createVisualReadingCache,verifiedReadingUnit,readingUnitInputHash,unitReadingLiteral} from '../src/server/ai/visual-reading-cache.server.ts';
import {assembleDocumentReading,createReadingPatch,resolveReadingVersion} from '../src/utils/document-reading-history.ts';
import {planFragmentTargets} from '../src/utils/visual-fragment-contracts.ts';
import {verifyFragmentProof,fragmentBaseHash} from '../src/server/ai/visual-fragment-proof.server.ts';
import {assessVisualReading} from '../src/utils/visual-source-reading.ts';
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='@/utils/visual-source-manifest')return {url:'data:text/javascript,export async function buildVisualSourceManifest(){return structuredClone(globalThis.__fragmentManifest);}',shortCircuit:true};return next(specifier,context);}});
const {stageDocumentReading}=await import('../src/server/ai/handlers/document-reading.ts');hook.deregister();
async function temporary(action){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'contractor-fragment-resume-')),previous=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=folder;try{return await action(path.join(folder,'ContractorSystem','ai-runtime'));}finally{delete globalThis.__fragmentManifest;if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(folder,{recursive:true,force:true});}}
const cacheCall=(cache,name,...args)=>{assert.equal(typeof cache[name],'function','Missing scoped fragment progress: '+name);return cache[name](...args);};
function execution(f,{jobId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',value,unclearFull=false,failFragmentAt=Infinity}={}){
 const calls={full:0,locator:0,fragment:0},progress=[],inputs=[];
 const api={jobId,ownerId:f.scope.ownerId,projectId:f.scope.projectId,profile:{id:f.scope.ownerId,accountFingerprint:'synthetic',model:'fixture',effort:null,revision:1},signal:new AbortController().signal,checkActive:async()=>{},reportProgress:async p=>{progress.push(p);},generate:async input=>{
  inputs.push(input);
  if(input.outputSchema.properties.unitId){calls.full++;const region=JSON.parse(input.text.split('SOURCE REGION: ')[1].split('\n')[0]),r=structuredClone(calls.full%2?f.base.views[0].reading:f.base.views[0].confirmation);return JSON.stringify({...r,viewId:region.viewId,...(unclearFull?{uncertainties:['The substantive source remains unclear']}:{})});}
  if(input.outputSchema.properties.regions){calls.locator++;const data=JSON.parse(input.text.split('\nLOCATOR TASK: ')[1]);return JSON.stringify({regions:data.targets.map(t=>({targetId:t.id,rect:{x:0.02,y:0.1,width:0.96,height:0.7}})),unlocated:[]});}
  calls.fragment++;if(calls.fragment===failFragmentAt)throw Error('Synthetic transport interruption');
  const data=JSON.parse(input.text.split('\nFRAGMENT TASK: ')[1]),a=data.address;
  const targetValue=structuredClone(a.kind==='line'?f.base.views[0].reading.text.split('\n')[a.line]:f.base.tables[a.table][a.row]);if(value&&Array.isArray(targetValue))targetValue[1]=value;
  const blocks=[...data.anchors.map(v=>({id:v.id,address:v.address,value:v.value})),{id:data.targetId,address:a,value:targetValue}].sort((x,y)=>(x.address.kind==='line'?x.address.line:x.address.row)-(y.address.kind==='line'?y.address.line:y.address.row)).map(({id,value})=>({id,value}));
  return JSON.stringify({targetId:data.targetId,blocks,uncertainties:[]});
 }};return {api,calls,progress,inputs};
}
const fixture=options=>fragmentReadingFixture({kind:'IMAGE_FRAME',...options});
const render=f=>createSourceFragmentRenderer(f.bytes,'source.png',f.manifest);
function document(f){const reading=assembleDocumentReading(f.manifest,[f.base],f.scope);reading.verification.createdBy={jobId:f.base.createdBy.jobId,rulesVersion:'visual-reading-rules-v2',profileRevision:1};return sourceDocument({id:f.scope.documentId,project_id:f.scope.projectId,title:'source.png',content_hash:f.scope.sourceHash,extracted_text:f.base.text,extracted_text_hash:digest(f.base.text),ocr_status:'REQUIRES_REVIEW',ai_status:'VALIDATED',category:'EXECUTION',parsed_json:{source_reading:reading.verification,source_reading_units:[structuredClone(f.base)],owner_note:'Owner note',summary:'Owner summary',financial_data:{total_amount:123}}});}
function database(row){let patch;row.xmin??='1';const updates=[],hooks={beforeUpdate:null};return {updates,hooks,from(table){assert.equal(table,'documents');const filters=[],q={update(value){patch=value;hooks.beforeUpdate?.();return q;},eq(k,v){filters.push([k,v]);return q;},select(){return q;},async maybeSingle(){return {data:structuredClone(row),error:null};},then(resolve,reject){const matches=filters.every(([k,v])=>row[k]===v);if(matches){updates.push(structuredClone(patch));Object.assign(row,patch);row.xmin=String(Number(row.xmin)+1);}return Promise.resolve({error:null,count:matches?1:0,data:matches?[row]:[]}).then(resolve,reject);}};return q;}};}
async function composed(f,ex=execution(f)){const unit=await readTargetedFragments({unit:f.unit,saved:f.base,scope:f.scope,execution:ex.api,render:render(f),onCheckpoint:async()=>{}});return {unit,ex};}

// Break caught: ignoring retained partial evidence and sending the full source to AI again.
test('retained_mismatch_uses_only_fragments',async()=>temporary(async()=>{
 const f=await fixture(),ex=execution(f),result=await readVisualSource(f.manifest,f.scope,ex.api,{retainedUnits:[f.base],renderFragment:render(f)});
 assert.equal(ex.calls.full,0);assert.equal(ex.calls.locator,1);assert.equal(ex.calls.fragment,2);assert.equal(result.units[0].complete,true);assert.deepEqual(result.units[0].views,f.base.views);
 assert.equal(verifiedReadingUnit(result.units[0],f.unit,f.scope),true);
}));
test('a_retained_partial_without_a_renderer_does_not_trigger_a_hidden_full_retry',async()=>temporary(async()=>{
 const f=await fixture(),ex=execution(f),result=await readVisualSource(f.manifest,f.scope,ex.api,{retainedUnits:[f.base]});assert.equal(ex.calls.full,0);assert.equal(result.units[0].complete,false);assert.deepEqual(result.units[0].views,f.base.views);
}));
test('a_fifth_target_resumes_from_four_confirmed_regions',async()=>temporary(async()=>{
 const f=await fixture({disputes:5}),first=execution(f),a=await readVisualSource(f.manifest,f.scope,first.api,{retainedUnits:[f.base],renderFragment:render(f)});
 assert.equal(a.units[0].complete,false);assert.equal(a.units[0].composition.proofs.length,4);assert.equal(a.units[0].composition.pending.length,1);assert.equal(first.calls.full,0);assert.equal(first.calls.fragment,8);
 const second=execution(f,{jobId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),b=await readVisualSource(f.manifest,f.scope,second.api,{renderFragment:render(f)});
 assert.equal(b.units[0].complete,true);assert.equal(second.calls.full,0);assert.equal(second.calls.locator,1);assert.equal(second.calls.fragment,2);assert.deepEqual(b.units[0].composition.proofs.slice(0,4),a.units[0].composition.proofs);
}));
test('bounded_resume_keeps_first_proof',async()=>temporary(async root=>{
 const f=await fixture({disputes:5}),cache=createVisualReadingCache(root),first=execution(f);let cancelled=false;
 first.api.checkActive=async()=>{if(cancelled)throw new DOMException('Stopped after checkpoint','AbortError');};
 await assert.rejects(readTargetedFragments({unit:f.unit,saved:f.base,scope:f.scope,execution:first.api,render:render(f),onCheckpoint:async value=>{await cacheCall(cache,'writeProgress',f.scope,f.unit,value);cancelled=true;}}),{name:'AbortError'});
 const saved=await cacheCall(cache,'readProgress',f.scope,f.unit);assert.equal(saved.composition.proofs.length,1);assert.equal(saved.complete,false);
 const second=execution(f,{jobId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),next=await readVisualSource(f.manifest,f.scope,second.api,{retainedUnits:[f.base],renderFragment:render(f)});
 assert.equal(next.units[0].complete,true);assert.equal(second.calls.full,0);assert.equal(second.calls.fragment,8);assert.deepEqual(next.units[0].composition.proofs[0],saved.composition.proofs[0]);
}));
test('an_unchanged_complete_composition_is_reopened_without_ai',async()=>temporary(async()=>{
 const f=await fixture(),first=execution(f);await readVisualSource(f.manifest,f.scope,first.api,{retainedUnits:[f.base],renderFragment:render(f)});
 const second=execution(f,{jobId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),result=await readVisualSource(f.manifest,f.scope,second.api,{renderFragment:render(f)});
 assert.equal(result.units[0].complete,true);assert.deepEqual(second.calls,{full:0,locator:0,fragment:0});
}));
test('a_complete_legacy_unit_is_kept_byte_exact_next_to_a_repaired_unit',async()=>temporary(async root=>{
 const f=await fixture(),other=structuredClone(f.unit);other.id='image:second';other.locations=[{part:'image',anchor:'image#frame2',mediaName:'source-image',frame:2}];
 const complete=structuredClone(f.base);complete.unitId=other.id;complete.inputHash=readingUnitInputHash(other);complete.complete=true;complete.uncertainties=[];
 for(const p of complete.views){p.reading.unitId=other.id;p.confirmation=structuredClone(p.reading);p.textHash=digest(unitReadingLiteral(p.reading));p.confirmationHash=p.textHash;}
 await createVisualReadingCache(root).write(f.scope,other,complete);
 const manifest={...f.manifest,units:[f.unit,other],assembly:[{kind:'unit',unitId:f.unit.id},{kind:'unit',unitId:other.id}]},ex=execution(f),result=await readVisualSource(manifest,f.scope,ex.api,{retainedUnits:[f.base],renderFragment:createSourceFragmentRenderer(f.bytes,'source.png',manifest)});
 assert.equal(ex.calls.full,0);assert.equal(result.units[0].complete,true);assert.deepEqual(result.units[1],complete);
}));
test('changed_source_cannot_reuse_fragment',async()=>temporary(async root=>{
 const f=await fixture(),{unit}=await composed(f),cache=createVisualReadingCache(root);assert.equal(verifiedReadingUnit(unit,f.unit,f.scope),true);
 const foreign=structuredClone(unit);foreign.composition.proofs[0].scope.documentId='ffffffff-ffff-4fff-8fff-ffffffffffff';assert.equal(verifiedReadingUnit(foreign,f.unit,f.scope),false);
 const damaged=structuredClone(unit);damaged.composition.proofs[0].raw[0]='{}';assert.equal(verifiedReadingUnit(damaged,f.unit,f.scope),false);
 await cacheCall(cache,'writeProgress',f.scope,f.unit,unit);assert.equal(await cacheCall(cache,'readProgress',{...f.scope,sourceHash:'9'.repeat(64)},f.unit),null);
}));
test('composed_reading_preserves_history_and_manual_fields',async()=>temporary(async()=>{
 const f=await fixture(),before=document(f),old=structuredClone(before),{unit}=await composed(f,execution(f,{value:'כ572'})),assembled=assembleDocumentReading(f.manifest,[unit],f.scope);
 assembled.verification.createdBy={jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',rulesVersion:'visual-reading-rules-v2',profileRevision:1};
 const next={...before,...createReadingPatch(before,assembled)},version=resolveReadingVersion(next,{textHash:before.extracted_text_hash,quote:before.extracted_text});
 assert.equal(assembled.verification.complete,true);assert.ok(version);assert.equal(version.text,old.extracted_text);assert.deepEqual(version.units,[old.parsed_json.source_reading_units[0]]);
 assert.equal(next.ai_status,'VALIDATED');assert.equal(next.category,'EXECUTION');for(const key of ['owner_note','summary','financial_data'])assert.deepEqual(next.parsed_json[key],old.parsed_json[key]);
 assert.deepEqual(unit.views,f.base.views);assert.notEqual(next.extracted_text_hash,old.extracted_text_hash);
}));
test('a_partial_new_version_keeps_its_own_raw_units',async()=>temporary(async()=>{
 const f=await fixture({disputes:5}),row=document(f),ex=execution(f,{value:'כ572'}),result=await readVisualSource(f.manifest,f.scope,ex.api,{retainedUnits:[f.base],renderFragment:render(f)}),assembled=assembleDocumentReading(f.manifest,result.units,f.scope);
 assembled.verification.createdBy={jobId:ex.api.jobId,rulesVersion:'visual-reading-rules-v2',profileRevision:1};const next={...row,...createReadingPatch(row,assembled)},version=resolveReadingVersion(next,{textHash:assembled.textHash});
 assert.equal(next.extracted_text,row.extracted_text);assert.ok(version);assert.equal(version.units[0].composition.proofs.length,4);
}));
test('damaged_composition_cannot_take_complete_fast_path',async()=>temporary(async()=>{
 const f=await fixture(),{unit}=await composed(f),assembled=assembleDocumentReading(f.manifest,[unit],f.scope),row=document(f);
 assembled.verification.createdBy={jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',rulesVersion:'visual-reading-rules-v2',profileRevision:1};Object.assign(row,createReadingPatch(row,assembled));
 row.parsed_json.source_reading_units[0].composition.proofs[0].raw[0]='{}';globalThis.__fragmentManifest=f.manifest;
 const db=database(row),ex=execution(f,{unclearFull:true}),result=await stageDocumentReading({client:db,document:structuredClone(row),file:f.bytes,execution:ex.api});
 assert.equal(result.cached,false);assert.equal(result.reading.verification.complete,false);assert.equal(row.ai_status,'VALIDATED');assert.equal(row.parsed_json.owner_note,'Owner note');
}));
test('a_late_transport_failure_keeps_the_document_and_first_checkpoint',async()=>temporary(async root=>{
 const f=await fixture({disputes:5}),row=document(f),db=database(row),before=structuredClone(row),ex=execution(f,{failFragmentAt:3});globalThis.__fragmentManifest=f.manifest;
 await assert.rejects(stageDocumentReading({client:db,document:row,file:f.bytes,execution:ex.api}),/Synthetic transport interruption/u);
 assert.deepEqual(row,before);assert.equal(db.updates.length,0);const checkpoint=await cacheCall(createVisualReadingCache(root),'readProgress',f.scope,f.unit);assert.equal(checkpoint.composition.proofs.length,1);
}));
test('different_line_wrapping_does_not_block_an_identical_ordered_body_and_table',async()=>{
 const f=await fixture(),p=f.base.views[0];p.reading.text='A complete heading\nStable ordered body';p.confirmation.text='A complete\nheading\nStable ordered body';
 const plan=planFragmentTargets(f.unit,f.base);assert.equal(plan.targets.length,1);assert.deepEqual(plan.issues,[]);assert.deepEqual(plan.targets[0].address,{kind:'table-row',table:0,row:2});
});

test('a_damaged_fragment_summary_cannot_certify_a_reading',async()=>{
 const f=await fixture(),{unit}=await composed(f),reading=assembleDocumentReading(f.manifest,[unit],f.scope),row=document(f);
 reading.verification.createdBy=unit.createdBy;const source={...row,extracted_text:reading.text,extracted_text_hash:reading.textHash};
 assert.equal(assessVisualReading(reading.verification,source).complete,true);
 for(const damage of [c=>{c.scope.documentId='ffffffff-ffff-4fff-8fff-ffffffffffff';},c=>{c.evidenceHash='broken';},c=>{c.accepted.push(c.accepted[0]);},c=>{c.pending=[unit.composition.proofs[0].target];}]){const broken=structuredClone(reading.verification);damage(broken.expectedUnits[0].composition);assert.equal(assessVisualReading(broken,source).complete,false);}
});

test('owner_edits_during_fragment_reading_are_merged_into_the_saved_result',async()=>temporary(async()=>{
 const f=await fixture(),row=document(f),initial=structuredClone(row),db=database(row),ex=execution(f);globalThis.__fragmentManifest=f.manifest;
 const generate=ex.api.generate;ex.api.generate=async input=>{const raw=await generate(input);row.parsed_json.owner_note='New owner note';row.parsed_json.financial_data={total_amount:456};row.ai_status='APPROVED';row.xmin=String(Number(row.xmin)+1);return raw;};
 const result=await stageDocumentReading({client:db,document:initial,file:f.bytes,execution:ex.api});assert.equal(row.parsed_json.owner_note,'New owner note');assert.deepEqual(row.parsed_json.financial_data,{total_amount:456});assert.equal(result.document.ai_status,'APPROVED');
}));

test('a_write_race_does_not_overwrite_an_owner_edit_or_report_success',async()=>temporary(async()=>{
 const f=await fixture(),row=document(f),db=database(row),ex=execution(f);globalThis.__fragmentManifest=f.manifest;const initial=structuredClone(row);
 db.hooks.beforeUpdate=()=>{row.parsed_json.owner_note='Owner changed before commit';row.xmin=String(Number(row.xmin)+1);};
 await assert.rejects(stageDocumentReading({client:db,document:initial,file:f.bytes,execution:ex.api}),e=>e.code==='AI_SOURCE_CHANGED');assert.equal(row.parsed_json.owner_note,'Owner changed before commit');assert.equal(db.updates.length,0);
}));
test('a_short_table_uses_its_own_unique_header_and_a_unique_text_anchor',async()=>{
 const f=await fixture(),p=f.base.views[0];p.reading.text='Unique meeting heading\nA stable footer';p.confirmation.text=p.reading.text;
 p.reading.tables=[[['Task','Owner'],['First instruction','Alice'],['Second instruction','Bob']]];p.confirmation.tables=[[['Task','Owner'],['Other instruction','Alice'],['Changed instruction','Bob']]];
 const plan=planFragmentTargets(f.unit,f.base);assert.equal(plan.targets.length,2);assert.deepEqual(plan.issues,[]);
 for(const target of plan.targets){assert.equal(target.anchors.length,2);assert.ok(target.anchors.some(a=>a.address.kind==='line'));assert.ok(target.anchors.some(a=>a.address.kind==='table-row'&&a.address.table===0));}
});
test('mixed_context_blocks_require_matching_physical_order_and_correct_value_types',async()=>{
 const f=await fixture(),p=f.base.views[0];p.reading.text='Unique meeting heading';p.confirmation.text=p.reading.text;
 p.reading.tables=[[['Task','Owner'],['First instruction','Alice'],['Second instruction','Bob']]];p.confirmation.tables=[[['Task','Owner'],['Other instruction','Alice'],['Changed instruction','Bob']]];
 f.base.tables=structuredClone(p.reading.tables);f.base.text=unitReadingLiteral(p.reading);f.base.textHash=digest(f.base.text);p.textHash=f.base.textHash;p.confirmationHash=digest(unitReadingLiteral(p.confirmation));
 const target=planFragmentTargets(f.unit,f.base).targets[0];assert.ok(target,'Need a bounded target with mixed source context');const image=await render(f)(f.unit,{x:0.02,y:0.1,width:0.96,height:0.7});
 const line=target.anchors.find(a=>a.address.kind==='line'),row=target.anchors.find(a=>a.address.kind==='table-row'),value=f.base.tables[0][target.address.row],response={targetId:target.id,blocks:[{id:line.id,value:line.value},{id:row.id,value:row.value},{id:target.id,value}],uncertainties:[]};
 const physical={id:image.id,sha256:image.sha256,width:image.width,height:image.height,rect:image.rect},proof={version:'visual-fragment-proof-v1',scope:f.scope,unitId:f.unit.id,inputHash:f.base.inputHash,baseEvidenceHash:fragmentBaseHash(f.base),target,rect:image.rect,image:physical,raw:[JSON.stringify(response),JSON.stringify(response)],readings:[response,structuredClone(response)],value,createdBy:{jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',profileRevision:1}};
 assert.ok(verifyFragmentProof(proof,f.scope,f.unit,f.base,target,image));
 const bad=structuredClone(proof);bad.readings[1].blocks=[bad.readings[1].blocks[1],bad.readings[1].blocks[2],bad.readings[1].blocks[0]];bad.raw[1]=JSON.stringify(bad.readings[1]);assert.equal(verifyFragmentProof(bad,f.scope,f.unit,f.base,target,image),null);
});
