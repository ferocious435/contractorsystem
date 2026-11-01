import assert from 'node:assert/strict';
import test from 'node:test';
import {readingUnit,unitResponse,visualRegistry,sourceDocument,literal} from './codex-runtime/visual-reading-fixtures.mjs';
import {assessDocumentSourceReadiness,hasDocumentBodyText} from '../src/utils/document-source-readiness.ts';
const load=async file=>import(file).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith(file.slice(2)))return {};throw error;});
const contracts=await load('../src/utils/visual-source-reading.ts');
const response=await load('../src/utils/visual-source-response.ts');
function api(module,name){assert.equal(typeof module[name],'function',`Missing visual reading contract: ${name}`);return module[name];}

test('missing_view_is_incomplete',()=>{
 const assess=api(contracts,'assessVisualReading'),registry=visualRegistry();
 assert.equal(assess(registry,sourceDocument()).complete,true);
 registry.expectedUnits[0].verifiedViews=[];
 assert.equal(assess(registry,sourceDocument()).complete,false);
});
test('swapped_numeric_columns_rejected',()=>{
 const compare=api(response,'compareNumericReadings');
 const expected=unitResponse(undefined,{text:'',tables:[[['עבודה','כמות','מחיר'],['צינור','12','34']]]});
 const swapped={...expected,tables:[[['עבודה','כמות','מחיר'],['צינור','34','12']]]};
 assert.equal(compare(expected,swapped).matched,false);
 assert.equal(compare(expected,structuredClone(expected)).matched,true);
});
test('numeric_labels_and_decimal_separators_are_not_discarded',()=>{
 const compare=api(response,'compareNumericReadings'),validate=api(response,'validateUnitReading');
 const unit=readingUnit(),raw=unitResponse(unit,{text:'',tables:[[['מחיר א','1,234.50'],['מחיר ב','1.234,50']]]});
 const parsed=validate(JSON.stringify(raw),unit,unit.views[0].id);
 assert.deepEqual(parsed.tables,[[['מחיר א','1,234.50'],['מחיר ב','1.234,50']]]);
 assert.equal(compare(raw,{...raw,tables:[[['מחיר ב','1,234.50'],['מחיר א','1.234,50']]]}).matched,false);
 assert.equal(compare(raw,{...raw,tables:[[['מחיר א','1.234,50'],['מחיר ב','1,234.50']]]}).matched,false);
});
test('a_layout_description_of_already_transcribed_item_numbers_does_not_invalidate_equal_source_numbers',()=>{
 const compare=api(response,'compareNumericReadings'),first=unitResponse(undefined,{text:'1. Work description\n2. Quantity 12\n3. Payment terms',visualDescription:'The headings are underlined.'});
 assert.equal(compare(first,{...first,visualDescription:'Items 1–3 have underlined headings.'}).matched,true);
 assert.equal(compare({...first,visualDescription:'There are 8 separate work areas.'},{...first,visualDescription:'There are 9 separate work areas.'}).matched,false);
});
test('counter_only_is_not_document_body',()=>{
 api(contracts,'assessVisualReading');
 for(const text of ['1','[PAGE 1]\n1','-- 1 of 3 --','report.pdf 01.11.2026','QA.19.01.05C 28.11.23'])assert.equal(hasDocumentBodyText(text),false);
 const registry=visualRegistry();registry.expectedUnits[0].literalHasBody=false;
 assert.equal(contracts.assessVisualReading(registry,sourceDocument({extracted_text:'1'})).complete,false);
});
test('legacy_proof_is_not_visual_proof',()=>{
 const assess=api(contracts,'assessVisualReading');
 assert.equal(assess({version:'page-coverage-v1',complete:true,totalPages:1,readPages:[1],unreadablePages:[]},sourceDocument()).complete,false);
});
test('unknown_or_duplicate_units_views_and_unresolved_readings_are_rejected',()=>{
 const assess=api(contracts,'assessVisualReading');
 const cases=[];
 let r=visualRegistry();r.expectedUnits.push(structuredClone(r.expectedUnits[0]));cases.push(r);
 r=visualRegistry();r.expectedUnits[0].verifiedViews[0].viewId='other';cases.push(r);
 r=visualRegistry();r.expectedUnits[0].verifiedViews[0].imageHash='4'.repeat(64);cases.push(r);
 r=visualRegistry();r.expectedUnits[0].uncertainties=['Unreadable signature'];cases.push(r);
 r=visualRegistry();r.sourceHash='5'.repeat(64);cases.push(r);
 for(const value of cases)assert.equal(assess(value,sourceDocument()).complete,false);
});
test('pdf_tiles_must_cover_the_physical_page_without_a_gap',()=>{
 const assess=api(contracts,'assessVisualReading'),registry=visualRegistry();
 registry.expectedUnits[0].views[0].rect.width=0.99;
 assert.equal(assess(registry,sourceDocument()).complete,false);
 const rectangles=api(contracts,'planPageViews')(9000,12000,4_000_000,32);
 assert.ok(rectangles.length>1);
 const unit=registry.expectedUnits[0],template=unit.views[0],proof=unit.verifiedViews[0];
 unit.views=rectangles.map((rect,i)=>({...template,id:'tile:'+i,rect}));
 unit.verifiedViews=unit.views.map(v=>({...proof,viewId:v.id}));
 assert.ok(rectangles.every(r=>r.width*9000*r.height*12000<=4_000_001));
 assert.equal(assess(registry,sourceDocument()).complete,true);
 unit.views.splice(2,1);unit.verifiedViews.splice(2,1);
 assert.equal(assess(registry,sourceDocument()).complete,false);
});
test('model_response_cannot_choose_a_different_unit_or_invoke_tools',()=>{
 const validate=api(response,'validateUnitReading'),unit=readingUnit();
 for(const change of [{unitId:'other'},{viewId:'other'},{tools:['shell']},{tables:[[['ok',null]]]},{uncertainties:'none'}]){
  assert.throws(()=>validate(JSON.stringify(unitResponse(unit,change)),unit,unit.views[0].id));
 }
 assert.equal(validate(JSON.stringify(unitResponse(unit)),unit,unit.views[0].id).text,literal);
});
test('verified_visual_proof_is_accepted_by_source_readiness_without_weakening_legacy_checks',()=>{
 assert.equal(assessDocumentSourceReadiness(sourceDocument()).canCompare,true);
 const registry=visualRegistry();registry.expectedUnits[0].verifiedViews=[];
 assert.equal(assessDocumentSourceReadiness(sourceDocument({parsed_json:{source_reading:registry}})).canCompare,false);
});
test('a_blank_model_answer_needs_a_physical_empty_page_proof',()=>{
 const assess=api(contracts,'assessVisualReading'),registry=visualRegistry();
 registry.expectedUnits[0].literalHasBody=false;registry.expectedUnits[0].visualHasContent=false;
 assert.equal(assess(registry,sourceDocument()).complete,false);
});
