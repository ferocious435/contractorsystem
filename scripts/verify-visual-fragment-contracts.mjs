import assert from 'node:assert/strict';
import test from 'node:test';
import {readingUnit,unitResponse,digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {readingUnitInputHash,unitReadingLiteral} from '../src/server/ai/visual-reading-cache.server.ts';
const load=async file=>import(file).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith(file.slice(2)))return {};throw error;});
const contracts=await load('../src/utils/visual-fragment-contracts.ts'),proofs=await load('../src/server/ai/visual-fragment-proof.server.ts');
const call=(api,name,...args)=>{assert.equal(typeof api[name],'function','Missing addressed-fragment contract: '+name);return api[name](...args);};
const scope={ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',projectId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',documentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',sourceHash:'1'.repeat(64)};
const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,sort(v[key])])):v;})(value));
function fixture(first='כ570',second='570'){
 const unit=readingUnit({localText:''}),rows=[['סוג','כמות','יחידה','הערה'],['הכנה','10','יום',''],['חפירה','20','מטר',''],['מקטע',first,'מטר',''],['כיסוי','30','מטר',''],['סיום','40','יום','']];
 const a=unitResponse(unit,{text:'הוראות ביצוע',tables:[rows]}),b=structuredClone(a);b.tables[0][3][1]=second;
 const view=unit.views[0],image={sha256:view.sha256,width:view.width,height:view.height,rect:view.rect};
 const base={unitId:unit.id,inputHash:readingUnitInputHash(unit),text:unitReadingLiteral(a),textHash:digest(unitReadingLiteral(a)),tables:structuredClone(a.tables),visualDescription:'',uncertainties:['Numeric or source verification failed: '+view.id],complete:false,
  views:[{viewId:view.id,imageHash:view.sha256,textHash:digest(unitReadingLiteral(a)),confirmationHash:digest(unitReadingLiteral(b)),method:'visual-double-pass',reading:a,confirmation:b,readingImage:image,confirmationImage:image}],createdBy:{jobId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',rulesVersion:'visual-reading-rules-v2',profileRevision:1}};
 return {unit,base};
}
function exampleProof(unit,base,target,value=['מקטע','כ570','מטר','']){
 const bytes=Buffer.from('original enlarged row with its physical context'),rect={x:0,y:0.2,width:1,height:0.5},image={id:'fragment:test',sha256:digest(bytes),width:600,height:300,rect,bytes};
 const blocks=[{id:target.anchors[0].id,value:target.anchors[0].value},{id:target.id,value},{id:target.anchors[1].id,value:target.anchors[1].value}];
 const response={targetId:target.id,blocks,uncertainties:[]},raw=JSON.stringify(response);
 return {image,proof:{version:'visual-fragment-proof-v1',scope,unitId:unit.id,inputHash:base.inputHash,baseEvidenceHash:digest(canonical(base.views)),target,rect,image:{...image,bytes:undefined},raw:[raw,raw],readings:[response,structuredClone(response)],value,createdBy:{jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',profileRevision:1}}};
}

// Break caught: a numeric comparison that drops row labels, approximation, negation or range direction.
test('localized_row_keeps_approximation_and_labels',()=>{
 for(const [a,b] of [['כ570','570'],['לא מאושר','מאושר'],['10.07.2026','12.07.2026'],['W74–W116','W116–W74'],['מטר','מ״ר']]){
  const {unit,base}=fixture(a,b),plan=call(contracts,'planFragmentTargets',unit,base);
  assert.deepEqual(plan.targets.map(t=>t.address),[{kind:'table-row',table:0,row:3}]);assert.deepEqual(plan.issues,[]);
 }
});
test('duplicate_anchor_stays_partial',()=>{
 const {unit,base}=fixture();for(const p of [base.views[0].reading,base.views[0].confirmation])for(const row of [1,2,4,5])p.tables[0][row]=['זהה','10','מטר',''];
 const plan=call(contracts,'planFragmentTargets',unit,base);assert.equal(plan.targets.length,0);assert.ok(plan.issues.length);
});
test('matching_context_in_another_table_cannot_confirm_the_requested_table',()=>{
 const {unit,base}=fixture();
 for(const r of [base.views[0].reading,base.views[0].confirmation])r.tables.push(structuredClone(base.views[0].reading.tables[0]));
 const plan=call(contracts,'planFragmentTargets',unit,base);assert.equal(plan.targets.length,0);assert.ok(plan.issues.length);
});
test('shape_changes_and_unbound_uncertainties_stay_partial',()=>{
 for(const mutate of [b=>b.views[0].confirmation.tables[0][3].pop(),b=>b.views[0].confirmation.tables[0].splice(2,1),b=>b.views[0].reading.uncertainties.push('An unidentified diagram annotation is unclear')]){
  const {unit,base}=fixture();mutate(base);const plan=call(contracts,'planFragmentTargets',unit,base);assert.ok(plan.issues.length);
 }
});
test('literal_composition_keeps_raw_base',()=>{
 const {unit,base}=fixture(),target=call(contracts,'planFragmentTargets',unit,base).targets[0],{image,proof}=exampleProof(unit,base,target);
 assert.ok(call(proofs,'verifyFragmentProof',proof,scope,unit,base,target,image));
 const original=structuredClone(base),result=call(proofs,'composeFragmentReading',unit,base,[proof],scope);
 assert.equal(result.complete,true);assert.deepEqual(result.views,base.views);assert.deepEqual(base,original);
 assert.deepEqual(result.tables[0][3],['מקטע','כ570','מטר','']);assert.deepEqual(result.tables[0][2],['חפירה','20','מטר','']);
 assert.equal(result.composition.version,'visual-fragment-assembly-v1');assert.equal(result.composition.pending.length,0);assert.equal(result.textHash,digest(result.text));
 assert.equal(call(proofs,'composeFragmentReading',unit,base,[],scope).complete,false);
});
// Break caught: trusting a proof's result without binding its raw pair, original, address and scope.
test('fragment_proof_rejects_changed_binding',()=>{
 const {unit,base}=fixture(),target=call(contracts,'planFragmentTargets',unit,base).targets[0],{image,proof}=exampleProof(unit,base,target);
 const mutations=[p=>p.scope.ownerId='ffffffff-ffff-4fff-8fff-ffffffffffff',p=>p.scope.sourceHash='2'.repeat(64),p=>p.inputHash='2'.repeat(64),p=>p.baseEvidenceHash='2'.repeat(64),p=>p.target.address.row=2,p=>p.rect.y=0.3,p=>p.image.sha256='2'.repeat(64),p=>p.raw[1]='{}',p=>p.value[1]='999',p=>p.createdBy.profileRevision=0,p=>p.readings[1].uncertainties.push('unreadable')];
 for(const change of mutations){const bad=structuredClone(proof);change(bad);assert.equal(call(proofs,'verifyFragmentProof',bad,scope,unit,base,target,image),null);}
 const foreignImage={...image,bytes:Buffer.from('a different row')};assert.equal(call(proofs,'verifyFragmentProof',proof,scope,unit,base,target,foreignImage),null);
});
test('two_agreeing_reads_of_a_neighbor_row_do_not_confirm_the_target',()=>{
 const {unit,base}=fixture(),target=call(contracts,'planFragmentTargets',unit,base).targets[0],{image,proof}=exampleProof(unit,base,target);
 for(const response of proof.readings)response.blocks[0].value=['אחר','20','מטר',''];
 proof.raw=proof.readings.map(value=>JSON.stringify(value));assert.equal(call(proofs,'verifyFragmentProof',proof,scope,unit,base,target,image),null);
});
test('typography_is_accepted_without_rewriting_raw_and_empty_cells_are_preserved',()=>{
 const {unit,base}=fixture('ע״י','ע"י'),plan=call(contracts,'planFragmentTargets',unit,base);assert.deepEqual(plan.targets,[]);
 const result=call(proofs,'composeFragmentReading',unit,base,[],scope);assert.equal(result.complete,true);assert.deepEqual(result.views,base.views);assert.equal(result.tables[0][3][3],'');
});
test('json_object_key_order_does_not_invalidate_an_unchanged_proof',()=>{
 const {unit,base}=fixture(),target=call(contracts,'planFragmentTargets',unit,base).targets[0],{image,proof}=exampleProof(unit,base,target);
 const reordered=JSON.parse(canonical(base));assert.ok(call(proofs,'verifyFragmentProof',proof,scope,unit,reordered,target,image));
});
test('fragment_preserves_agreed_cells_and_column_positions',()=>{
 for(const value of [['מקטע','כ570','',''],['כ570','מקטע','מטר',''],['מקטע','כ570','סמ','']]){
  const {unit,base}=fixture(),target=call(contracts,'planFragmentTargets',unit,base).targets[0],{image,proof}=exampleProof(unit,base,target,value);
  assert.equal(call(proofs,'verifyFragmentProof',proof,scope,unit,base,target,image),null);
 }
});
test('a_fragment_cannot_drop_one_endpoint_of_a_disputed_range',()=>{
 const {unit,base}=fixture('W74–W116','W116–W74'),target=call(contracts,'planFragmentTargets',unit,base).targets[0],{image,proof}=exampleProof(unit,base,target,['מקטע','W74','מטר','']);
 assert.equal(call(proofs,'verifyFragmentProof',proof,scope,unit,base,target,image),null);
});
test('reflowed_page_locates_disputed_line_between_unique_anchors',()=>{
 const {unit,base}=fixture();const a=base.views[0].reading,b=base.views[0].confirmation;
 a.tables=[];b.tables=[];a.text='First unique heading\nContract amount 120 meters\nFinal unique approval';b.text='First unique\nheading\nContract amount 130 meters\nFinal unique approval';
 const plan=call(contracts,'planFragmentTargets',unit,base);assert.deepEqual(plan.targets.map(t=>t.address),[{kind:'line',line:1}]);
});
test('reflow_does_not_guess_between_duplicate_anchors_or_drop_insertions',()=>{
 const {unit,base}=fixture();const a=base.views[0].reading,b=base.views[0].confirmation;
 a.tables=[];b.tables=[];a.text='Repeated heading\nContract amount 120 meters\nRepeated heading';b.text='Repeated\nheading\nContract amount 130 meters\nRepeated heading\nextra obligation';
 const plan=call(contracts,'planFragmentTargets',unit,base);assert.equal(plan.targets.length,0);assert.ok(plan.issues.length);
});
test('reflowed_fragment_must_preserve_agreed_words_and_numbers',()=>{
 const {unit,base}=fixture();const a=base.views[0].reading,b=base.views[0].confirmation;a.tables=[];b.tables=[];
 a.text='First unique heading\nWork on road 7 is 120 meters\nFinal unique approval';b.text='First unique\nheading\nWork on road 7 is 130 meters\nFinal unique approval';
 const target=contracts.planFragmentTargets(unit,base).targets[0];assert.ok(target);
 assert.equal(proofs.preservesAgreedContent('Work on road 8 is 120 meters',base,target,unit),false);
 assert.equal(proofs.preservesAgreedContent('Work on road 7 is 120 meters',base,target,unit),true);
});
test('reflowed_disagreement_cannot_erase_agreed_words_when_lengths_differ',()=>{
 const {unit,base}=fixture();const a=base.views[0].reading,b=base.views[0].confirmation;a.tables=[];b.tables=[];
 a.text='First unique heading\nWork on road 7 totals 120 meters\nFinal unique approval';b.text='First unique\nheading\nWork on road 7 is totals 130 meters\nFinal unique approval';
 const target=contracts.planFragmentTargets(unit,base).targets[0];assert.ok(target);
 assert.equal(proofs.preservesAgreedContent('road 7 120 meters',base,target,unit),false);
});
test('reflowed_line_witness_is_bound_to_original_and_cannot_change_agreed_road',()=>{
 const {unit,base}=fixture();const a=base.views[0].reading,b=base.views[0].confirmation;a.tables=[];b.tables=[];
 a.text='First unique heading\nWork on road 7 is 120 meters\nFinal unique approval';b.text='First unique\nheading\nWork on road 7 is 130 meters\nFinal unique approval';
 base.text=unitReadingLiteral(a);base.textHash=digest(base.text);base.tables=[];base.views[0].textHash=digest(unitReadingLiteral(a));base.views[0].confirmationHash=digest(unitReadingLiteral(b));
 const target=contracts.planFragmentTargets(unit,base).targets[0],{image,proof}=exampleProof(unit,base,target,'Work on road 7 is 120 meters');
 assert.ok(proofs.verifyFragmentProof(proof,scope,unit,base,target,image));
 for(const r of proof.readings)r.blocks.find(v=>v.id===target.id).value='Work on road 8 is 120 meters';proof.value='Work on road 8 is 120 meters';proof.raw=proof.readings.map(JSON.stringify);
 assert.equal(proofs.verifyFragmentProof(proof,scope,unit,base,target,image),null);
});
test('reflow_with_extra_text_at_page_edge_stays_partial',()=>{
 const {unit,base}=fixture();const a=base.views[0].reading,b=base.views[0].confirmation;a.tables=[];b.tables=[];
 a.text='First unique heading\nContract amount 120 meters\nFinal unique approval';b.text='Unmatched extra obligation\nFirst unique\nheading\nContract amount 130 meters\nFinal unique approval';
 const plan=contracts.planFragmentTargets(unit,base);assert.ok(plan.issues.includes('Fragment text or table structure differs'));
});
