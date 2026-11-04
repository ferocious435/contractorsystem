import assert from 'node:assert/strict';
import test from 'node:test';
import {readingUnit,unitResponse,visualRegistry,sourceDocument,literal,digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {assessDocumentSourceReadiness,hasDocumentBodyText} from '../src/utils/document-source-readiness.ts';
const load=async file=>import(file).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith(file.slice(2)))return {};throw error;});
const contracts=await load('../src/utils/visual-source-reading.ts');
const response=await load('../src/utils/visual-source-response.ts');
function api(module,name){assert.equal(typeof module[name],'function',`Missing visual reading contract: ${name}`);return module[name];}

test('branding_coverage_requires_the_same_complete_image_in_both_recognition_witnesses',()=>{
 const registry=visualRegistry({format:'DOCX'}),entry=registry.expectedUnits[0];Object.assign(entry,{kind:'DOCX_IMAGE',contentRole:'BRANDING_ONLY',locations:[{part:'word/header1.xml',anchor:'word/header1.xml#rId1:1',mediaName:'word/media/logo.png'}],literalHasBody:false,visualHasContent:true,textHash:digest('')});
 entry.verifiedViews[0]={...entry.verifiedViews[0],method:'branding-recognition',recognitionVersion:'branding-recognition-v1',textHash:digest(''),confirmationHash:digest(''),readingImage:{sha256:entry.views[0].sha256,width:100,height:100,rect:entry.views[0].rect},confirmationImage:{sha256:entry.views[0].sha256,width:100,height:100,rect:entry.views[0].rect}};
 const source=sourceDocument({title:'letter.docx',parsed_json:{source_reading:registry}});assert.equal(assessDocumentSourceReadiness(source).canCompare,true);
 for(const mutate of [value=>{delete value.verifiedViews[0].confirmationImage;},value=>{value.verifiedViews[0].confirmationImage.sha256='4'.repeat(64);},value=>{value.textHash=digest('Payment 9000');}]){
  const invalid=structuredClone(registry);mutate(invalid.expectedUnits[0]);assert.equal(assessDocumentSourceReadiness({...source,parsed_json:{source_reading:invalid}}).canCompare,false);
 }
});

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
test('spacing_around_a_label_colon_is_not_a_different_number_or_label',()=>{
 const compare=api(response,'compareNumericReadings'),first=unitResponse(undefined,{text:'תאריך: 20/07/2025\nמחיר: 1,234.50 ₪'});
 assert.equal(compare(first,{...first,text:'תאריך : 20/07/2025\nמחיר : 1,234.50 ₪'}).matched,true);
 assert.equal(compare(first,{...first,text:'תאריך : 20/07/2025\nכמות : 1,234.50 ₪'}).matched,false);
 assert.equal(compare(first,{...first,text:'תאריך : 20/07/2025\nמחיר : 1.234,50 ₪'}).matched,false);
});
test('spacing_in_a_letter_number_identifier_does_not_reject_the_same_table_values',()=>{
 const compare=api(response,'compareNumericReadings'),first=unitResponse(undefined,{text:'',tables:[[['סוג','שטח','לוח'],['חץ בודד','1.00','ישן ד- 13']]]}),second={...first,tables:[[['סוג','שטח','לוח'],['חץ בודד','1.00','ישן ד-13']]]};
 const original=structuredClone(first);assert.equal(compare(first,second).matched,true);assert.deepEqual(first,original,'Comparison must preserve the original transcript');
});
test('equivalent_quote_glyphs_do_not_change_table_units_or_standard_identifiers',()=>{
 const compare=api(response,'compareNumericReadings'),first=unitResponse(undefined,{text:'ת״י ISO 9001:2015',tables:[[['שטח (מ״ר)'],['2.52']]]}),second={...first,text:'ת"י ISO 9001:2015',tables:[[['שטח (מ"ר)'],['2.52']]]};
 assert.equal(compare(first,second).matched,true);
});
test('formatting_tolerance_cannot_change_signs_units_currency_identifiers_or_ranges',()=>{
 const compare=api(response,'compareNumericReadings');
 for(const [first,second]of [['יתרה: -12 ₪','יתרה: 12 ₪'],['שטח: 12 מ״ר','שטח: 12 מ״ק'],['מחיר: 12 ₪','מחיר: 12 $'],['קוד א-13','קוד א-31'],['מקטע 17-21','מקטע 21-17'],['פריט A1 23','פריט A123']]){
  assert.equal(compare(unitResponse(undefined,{text:first}),unitResponse(undefined,{text:second})).matched,false,first+' / '+second);
 }
});

test('a_quote_style_note_is_resolved_by_a_second_identical_literal_reading_without_erasing_the_note',()=>{
 const unresolved=api(response,'unresolvedReadingUncertainties'),first=unitResponse(undefined,{text:'מערכת ת״י ISO 9001:2015',uncertainties:['Точный тип кавычек в ת״י неразличим.']}),second={...first,text:'מערכת ת"י ISO 9001:2015',uncertainties:['Точное начертание кавычек неразличимо.']},original=structuredClone(first);
 assert.deepEqual(unresolved(first,second),[]);assert.deepEqual(unresolved(second,first),[]);assert.deepEqual(first,original);
});
test('matching_guesses_do_not_resolve_uncertain_words_signatures_or_quantities',()=>{
 const unresolved=api(response,'unresolvedReadingUncertainties');
 for(const note of ['Рукописная подпись неразборчива.','Неуверенно читается число 12.','Мелкие буквы и кавычки неразличимы.']){
  const first=unitResponse(undefined,{text:'ת"י ISO 9001:2015',uncertainties:[note]});assert.deepEqual(unresolved(first,{...first,uncertainties:[]}),[note]);
 }
});
test('a_quote_style_note_stays_unresolved_without_matching_full_content_and_a_second_witness',()=>{
 const unresolved=api(response,'unresolvedReadingUncertainties'),note='Точный тип кавычек неразличим.',first=unitResponse(undefined,{text:'ת"י ISO 9001:2015',uncertainties:[note]});
 assert.deepEqual(unresolved(first,null),[note]);assert.deepEqual(unresolved(first,{...first,text:'ת"י ISO 9001:2018',uncertainties:[]}),[note]);assert.deepEqual(unresolved(first,{...first,text:'א"י ISO 9001:2015',uncertainties:[]}),[note]);
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
test('compact_source_evidence_rejects_conflicting_physical_folios_on_the_same_page',()=>{
 const registry=visualRegistry(),unit=registry.expectedUnits[0],first=unit.views[0],second={...first,id:'page:1:enlarged',sha256:'6'.repeat(64),width:200,height:200};
 const proof=(view,text)=>({viewId:view.id,imageHash:view.sha256,textHash:digest(text),method:'physical-empty',confirmationHash:digest(text),
  emptyPageProof:{version:'rendered-empty-v1',kind:'PAGE_NUMBER_ONLY',page:1,imageSha256:view.sha256,width:view.width,height:view.height,numberText:text,numberConfidence:96,
   numberBounds:[{x0:45,y0:view.height-8,x1:55,y1:view.height-2}]}});
 Object.assign(unit,{literalHasBody:false,visualHasContent:false,textHash:digest('3'),views:[first,second],verifiedViews:[proof(first,'3'),proof(second,'3')]});
 assert.equal(contracts.assessVisualReading(registry,sourceDocument()).complete,true);
 unit.verifiedViews[1]=proof(second,'6');unit.textHash=digest('6');
 assert.equal(contracts.assessVisualReading(registry,sourceDocument()).complete,false);
});
