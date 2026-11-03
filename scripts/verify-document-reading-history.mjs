import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {digest,literal,sourceHash,sourceDocument,readingAssembly,readingUnit,unitResponse} from './codex-runtime/visual-reading-fixtures.mjs';
const load=async file=>import(file).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith(file.slice(2)))return {};throw error;});
const history=await load('../src/utils/document-reading-history.ts');
const call=(name,...args)=>{assert.equal(typeof history[name],'function','Missing reading history contract: '+name);return history[name](...args);};
const oldText='המעבר יישאר פתוח. גרסה עם תווי גופן שגויים.';
const saved=()=>sourceDocument({extracted_text:oldText,extracted_text_hash:digest(oldText),ai_status:'VALIDATED',category:'EXECUTION',parsed_json:{owner_note:'keep',financial_data:{total_amount:123},summary:'manual',full_markdown:oldText}});

test('old_literal_quote_resolves_after_glyph_correction',()=>{
 const before=saved(),patch=call('createReadingPatch',before,readingAssembly(literal));
 const after={...before,...patch},old=call('resolveReadingVersion',after,{textHash:digest(oldText),quote:oldText});
 assert.equal(old.text,oldText);assert.equal(old.sourceHash,sourceHash);
 assert.equal(after.extracted_text,literal);assert.equal(after.ai_status,'VALIDATED');assert.equal(after.category,'EXECUTION');
 assert.equal(after.parsed_json.owner_note,'keep');assert.deepEqual(after.parsed_json.financial_data,{total_amount:123});assert.equal(after.parsed_json.summary,'manual');
 assert.equal(after.parsed_json.analysis_stale,true);assert.equal(Object.hasOwn(patch,'ai_status'),false);
 assert.equal(Object.hasOwn(after.parsed_json.source_reading_history[0],'source_reading_history'),false);
});
test('first_hash_of_an_existing_stored_file_keeps_its_previous_literal_reading_available',()=>{
 const before={...saved(),content_hash:null},patch=call('createReadingPatch',before,readingAssembly(literal));
 const after={...before,...patch,content_hash:sourceHash};
 const previous=call('resolveReadingVersion',after,{textHash:digest(oldText),quote:oldText});
 assert.equal(previous?.text,oldText,'Adding the verified file hash must not hide its previous transcript');
 assert.equal(previous.sourceHash,sourceHash);assert.equal(after.parsed_json.owner_note,'keep');
 assert.deepEqual(after.parsed_json.financial_data,{total_amount:123});
});
test('a_missing_row_hash_cannot_rebind_a_previous_reading_from_different_verified_bytes',()=>{
 const before={...saved(),content_hash:null};
 before.parsed_json.source_reading={version:'docx-image-coverage-v1',sourceHash:'9'.repeat(64),complete:false};
 assert.throws(()=>call('createReadingPatch',before,readingAssembly(literal)),/source/i);
});
test('model_description_is_not_literal_quote',()=>{
 const doc=sourceDocument({extracted_text:'',extracted_text_hash:digest(''),parsed_json:{source_reading:readingAssembly('').verification,source_reading_visual_descriptions:[{unitId:'pdf:1',location:{page:1},text:'The drawing shows an access route.'}]}});
 assert.equal(call('resolveReadingVersion',doc,{quote:'The drawing shows an access route.'}),null);
});
test('catalog_omits_history_and_raw_unit_transcripts',()=>{
 const before=saved(),after={...before,...call('createReadingPatch',before,readingAssembly())};
 after.parsed_json.source_reading_units=[{text:'raw full transcript'}];after.parsed_json.raw_response='raw model response';
 const catalog=call('projectDocumentForCatalog',after);
 for(const key of ['source_reading_history','source_reading_units','raw_response'])assert.equal(Object.hasOwn(catalog.parsed_json,key),false);
 assert.equal(catalog.extracted_text,literal);assert.equal(after.parsed_json.source_reading_units[0].text,'raw full transcript');
});
test('foreign_reading_version_is_denied',()=>{
 const doc=sourceDocument();doc.parsed_json.source_reading_history=[{sourceHash:'9'.repeat(64),textHash:digest(oldText),text:oldText,reading:null}];
 assert.equal(call('resolveReadingVersion',doc,{textHash:digest(oldText)}),null);
 assert.throws(()=>call('createReadingPatch',doc,readingAssembly(literal,{verification:{...readingAssembly().verification,sourceHash:'9'.repeat(64)}})));
});
test('identical_reading_does_not_append_history',()=>{
 const doc=sourceDocument(),patch=call('createReadingPatch',doc,readingAssembly(literal));
 assert.equal(patch.parsed_json.source_reading_history.length,0);
 const again=call('createReadingPatch',{...doc,...patch},readingAssembly(literal));assert.equal(again.parsed_json.source_reading_history.length,0);
});
test('complete_long_text_is_saved_without_summarizing_the_original',()=>{
 const full='Exact original paragraph.\n'.repeat(9000)+'END OF SOURCE';
 assert.equal(call('createReadingPatch',saved(),readingAssembly(full)).extracted_text,full);
});
test('an_incomplete_attempt_preserves_the_previous_good_text',()=>{
 const before=saved(),reading=readingAssembly('Partial new line');reading.verification.complete=false;reading.verification.issues=['Unclear digit'];
 const patch=call('createReadingPatch',before,reading);
 assert.equal(patch.extracted_text,oldText);assert.equal(patch.ocr_status,'REQUIRES_REVIEW');assert.equal(patch.parsed_json.source_reading.complete,false);
});
test('partial Excel image reading keeps the complete new grid as a separate version without replacing the old text',()=>{
 const before=saved(),grid='# Sheet: Quantities\n'+('Gate\t\t25\n'.repeat(30000))+'LAST_CELL_VALUE',reading=readingAssembly(grid);reading.verification.format='XLSX';reading.verification.complete=false;reading.verification.issues=['Missing embedded image'];
 const patch=call('createReadingPatch',before,reading),after={...before,...patch};assert.equal(after.extracted_text,oldText);assert.equal(after.ocr_status,'REQUIRES_REVIEW');
 const attempt=call('resolveReadingVersion',after,{textHash:digest(grid)});assert.equal(attempt?.text,grid,'A partial picture must not discard the complete native cell grid');assert.equal(attempt.reading.complete,false);
 const repeated=call('createReadingPatch',after,reading);assert.equal(repeated.parsed_json.source_reading_history.length,1);assert.equal(repeated.parsed_json.owner_note,'keep');
});
test('assembly_retains_native_order_and_excludes_descriptions_from_quotable_text',()=>{
 const unit=readingUnit(),reply=unitResponse(unit),manifest={sourceHash,manifestHash:'2'.repeat(64),format:'DOCX',nativeText:'Before\nAfter',nativeVerification:null,units:[unit],issues:[],assembly:[{kind:'native',text:'Before\n'},{kind:'unit',unitId:unit.id},{kind:'native',text:'\nAfter'}]};
 const verified={unitId:unit.id,inputHash:'3'.repeat(64),textHash:digest(literal),text:literal,tables:[],visualDescription:'A source diagram.',uncertainties:[],complete:true,
  views:[{viewId:unit.views[0].id,imageHash:unit.views[0].sha256,textHash:digest(literal),method:'native-match',confirmationHash:digest(literal),reading:reply,confirmation:reply}]};
 const result=call('assembleDocumentReading',manifest,[verified]);
 assert.equal(result.text,'Before\n'+literal+'\nAfter');assert.equal(result.text.includes('A source diagram.'),false);assert.equal(result.visualDescriptions[0].text,'A source diagram.');
 assert.equal(call('assembleDocumentReading',manifest,[]).verification.complete,false);
});

const hook=registerHooks({resolve(s,c,n){if(s==='@/utils/supabase/server')return {url:'data:text/javascript,export const createClient=async()=>globalThis.__readingHistoryDb;',shortCircuit:true};return n(s,c);}});
const route=await load('../src/app/api/documents/reading/route.ts');hook.deregister();
function database(doc=sourceDocument(),signedIn=true){
 return {auth:{getUser:async()=>({data:{user:signedIn?{id:'owner'}:null},error:null})},from(table){const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},async maybeSingle(){return {data:table==='projects'?{id:filters.id}:doc.id===filters.id?structuredClone(doc):null,error:null};}};return q;}};
}
function request(extra={}){return new Request('http://localhost/api/documents/reading',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:sourceDocument().project_id,documentId:sourceDocument().id,...extra})});}
test('reading_detail_endpoint_checks_owner_project_and_unknown_parameters',async()=>{
 assert.equal(typeof route.POST,'function','Missing protected source-reading route');
 globalThis.__readingHistoryDb=database();assert.equal((await route.POST(request({model:'forged'}))).status,400);
 globalThis.__readingHistoryDb=database(sourceDocument(),false);assert.equal((await route.POST(request())).status,401);
 globalThis.__readingHistoryDb=database(sourceDocument({project_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}));assert.equal((await route.POST(request())).status,403);
 globalThis.__readingHistoryDb=database();const response=await route.POST(request()),detail=await response.json();
 assert.equal(response.status,200);assert.equal(detail.text,literal);assert.equal(detail.textHash,digest(literal));assert.equal(detail.current,true);
 assert.equal((await route.POST(request({textHash:'9'.repeat(64)}))).status,404);
});
test('full_verification_transcripts_are_available_when_the_source_is_opened',async()=>{
 const doc=sourceDocument();doc.parsed_json.source_reading_units=[{unitId:'pdf:1',views:[{reading:{text:'Quantity 12'},confirmation:{text:'Quantity 12'}}]}];
 globalThis.__readingHistoryDb=database(doc);
 const response=await route.POST(request()),detail=await response.json();assert.equal(response.status,200);
 assert.deepEqual(detail.reading.units,doc.parsed_json.source_reading_units);
});
test('a_quote_matching_two_different_readings_requires_a_version',()=>{
 const doc=sourceDocument();doc.parsed_json.source_reading_history=[{sourceHash,textHash:digest(literal+' Older footer'),text:literal+' Older footer',reading:null}];
 assert.equal(call('resolveReadingVersion',doc,{quote:literal}),null);
 assert.equal(call('resolveReadingVersion',doc,{quote:literal,textHash:digest(literal)}).text,literal);
});
