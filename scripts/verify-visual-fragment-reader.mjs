import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fragmentReadingFixture,digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {planFragmentTargets} from '../src/utils/visual-fragment-contracts.ts';
const api=await import('../src/server/ai/visual-fragment-reader.server.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const read=async args=>{assert.equal(typeof api.readTargetedFragments,'function','Missing bounded independent fragment reader');return api.readTargetedFragments(args);};
async function temporary(action){const root=await fs.mkdtemp(path.join(os.tmpdir(),'contractor-fragment-')),previous=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=root;try{return await action(root);}finally{if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{force:true,recursive:true});}}
function response(f,target){const a=target.address,value=a.kind==='line'?f.base.views[0].reading.text.split('\n')[a.line]:f.base.tables[a.table][a.row];return {targetId:target.id,blocks:[...target.anchors.map(v=>({id:v.id,address:v.address,value:v.value})),{id:target.id,address:a,value}].sort((x,y)=>(x.address.kind==='line'?x.address.line:x.address.row)-(y.address.kind==='line'?y.address.line:y.address.row)).map(({id,value})=>({id,value})),uncertainties:[]};}
function harness(f,change=()=>{}){
 const targets=planFragmentTargets(f.unit,f.base).targets,inputs=[],checkpoints=[],rect={x:0,y:0.1,width:1,height:0.7};let reads=0;
 const execution={jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',ownerId:f.scope.ownerId,projectId:f.scope.projectId,profile:{id:f.scope.ownerId,accountFingerprint:'synthetic',model:'fixture',effort:null,revision:1},signal:new AbortController().signal,checkActive:async()=>{},reportProgress:async()=>{},generate:async input=>{
  inputs.push(input);const locating=Boolean(input.outputSchema.properties.regions);
  let value;if(locating)value={regions:targets.slice(0,4).map(t=>({targetId:t.id,rect})),unlocated:[]};else{const metadata=JSON.parse(input.text.split('\nFRAGMENT TASK: ')[1]),target=targets.find(t=>t.id===metadata.targetId);value=response(f,target);reads++;}
  change(value,{locating,input,reads});return JSON.stringify(value);
 }};
 const render=async(unit,area)=>({id:'fragment:'+JSON.stringify(area),bytes:f.bytes,sha256:digest(f.bytes),width:900,height:600,rect:area});
 return {args:{unit:f.unit,saved:f.base,scope:f.scope,execution,render,onCheckpoint:async value=>{checkpoints.push(structuredClone(value));}},inputs,checkpoints,targets};
}
test('confirmation_is_blind',async()=>temporary(async()=>{
 const f=await fragmentReadingFixture(),h=harness(f),result=await read(h.args);
 assert.equal(result.complete,true);assert.equal(h.inputs.length,3);assert.equal(h.checkpoints.length,1);assert.deepEqual(result.views,f.base.views);
 for(const input of h.inputs.slice(1)){assert.ok(!input.text.includes('כ570'));assert.ok(!input.text.includes('570'));assert.equal(input.images.length,1);}
 assert.equal(h.inputs[1].text,h.inputs[2].text,'Neither independent read sees the other answer');assert.equal(result.composition.proofs[0].raw.length,2);
 assert.equal(typeof result.composition.proofs[0].locator?.raw,'string','Keep the original coordinate search as provenance, not as a reading');
 assert.deepEqual(result.tables[0][2],['מקטע 0','כ570','מטר','']);
}));
test('both fragment reads specify script direction and literal Hebrew prefixes without supplying target text',async()=>temporary(async()=>{
 const f=await fragmentReadingFixture(),h=harness(f);
 await read(h.args);
 for(const input of h.inputs.slice(1)){
  assert.match(input.text,/Latin.*left to right/i);
  assert.match(input.text,/Hebrew.*right to left/i);
  assert.match(input.text,/prefix/i);
  assert.match(input.text,/plene and defective spelling/i);
  assert.match(input.text,/punctuation.*source/i);
  assert.ok(!input.text.includes('כ570'));
 }
}));
test('clipped_context_stays_partial',async()=>temporary(async()=>{
 for(const change of [v=>v.blocks.pop(),v=>v.blocks.find(b=>b.id.startsWith('fragment:')).value[2]='',v=>v.blocks[0].value[0]='a different neighboring row']){
  const f=await fragmentReadingFixture(),h=harness(f,(v,{locating})=>{if(!locating)change(v);}),result=await read(h.args);
  assert.equal(result.complete,false);assert.equal(result.composition.proofs.length,0);assert.deepEqual(result.views,f.base.views);assert.equal(result.composition.attempts?.[0]?.raw.length,2);
 }
}));
test('locator_is_not_a_reading',async()=>temporary(async()=>{
 const f=await fragmentReadingFixture(),h=harness(f,(v,{locating})=>{if(!locating)v.uncertainties=['The substantive row remains unreadable'];}),result=await read(h.args);
 assert.equal(result.complete,false);assert.equal(result.composition.proofs.length,0);assert.equal(h.checkpoints.length,0);
}));
test('invalid_or_whole_page_coordinates_never_trigger_fragment_reading',async()=>temporary(async()=>{
 for(const rect of [{x:-1,y:0,width:1,height:0.3},{x:0,y:0,width:0,height:0.3},{x:0,y:0,width:1,height:1},{x:null,y:0,width:1,height:0.3}]){
  const f=await fragmentReadingFixture(),h=harness(f,(v,{locating})=>{if(locating)v.regions[0].rect=rect;}),result=await read(h.args);
  assert.equal(result.complete,false);assert.equal(h.inputs.length,1);
 }
}));
test('one_pass_reads_at_most_four_regions_and_preserves_the_fifth',async()=>temporary(async()=>{
 const f=await fragmentReadingFixture({disputes:5}),h=harness(f),result=await read(h.args);
 assert.equal(h.inputs.length,9);assert.equal(h.checkpoints.length,4);assert.equal(result.complete,false);assert.equal(result.composition.pending.length,1);
 assert.deepEqual(result.composition.pending[0].address,{kind:'table-row',table:0,row:14});assert.deepEqual(result.views,f.base.views);
}));
test('different_confirmed_numbers_and_forged_target_ids_stay_partial',async()=>temporary(async()=>{
 for(const change of [(v,n)=>{if(n===2)v.blocks.find(b=>b.id.startsWith('fragment:')).value[1]='999';},v=>{v.targetId='foreign target';}]){
  const f=await fragmentReadingFixture(),h=harness(f,(v,{locating,reads})=>{if(!locating)change(v,reads);}),result=await read(h.args);
  assert.equal(result.complete,false);assert.equal(result.composition.proofs.length,0);
 }
}));
test('malformed_fragment_blocks_leave_the_saved_reading_partial',async()=>temporary(async()=>{
 for(const change of [v=>v.blocks={},v=>v.blocks[0]=null]){
  const f=await fragmentReadingFixture(),h=harness(f,(v,{locating})=>{if(!locating)change(v);});
  const result=await read(h.args);assert.equal(result.complete,false);assert.equal(result.composition.proofs.length,0);assert.deepEqual(result.views,f.base.views);
 }
}));
test('an_unlocated_region_keeps_its_specific_reason_and_original_locator_response',async()=>temporary(async()=>{
 const f=await fragmentReadingFixture(),h=harness(f,(v,{locating})=>{if(locating){v.regions=[];v.unlocated=[{targetId:'fragment:table:0:row:2',reason:'The row cannot be distinguished from its neighbor'}];}}),result=await read(h.args);
 assert.equal(result.complete,false);assert.equal(h.inputs.length,1);assert.ok(result.uncertainties.some(v=>v.includes('The row cannot be distinguished from its neighbor')));assert.equal(typeof result.composition.locator?.raw,'string');
}));
