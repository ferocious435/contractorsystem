import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {buildVisualSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {assembleDocumentReading,createReadingPatch} from '../src/utils/document-reading-history.ts';
import {readingUnitInputHash,verifiedReadingUnit,createVisualReadingCache} from '../src/server/ai/visual-reading-cache.server.ts';
import {stageDocumentReading} from '../src/server/ai/handlers/document-reading.ts';
import {extractImageTextLocally,getRenderedEmptyPageProof} from '../src/utils/local-document-ocr.ts';
import {pricingRows,pricingIds} from './codex-runtime/pricing-fixtures.mjs';
import {pricingDatabase} from './fixtures/pricing-scope-database.mjs';
import {ownerId} from './codex-runtime/fixtures.mjs';import {projectId,savedProfile} from './codex-runtime/queue-fixtures.mjs';
import {digest} from './codex-runtime/visual-reading-fixtures.mjs';
const oldJob='dddddddd-dddd-4ddd-8ddd-dddddddddddd',newJob='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
async function run({corrupt='',extraPixel=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'contractorsystem-reading-repair-')),previous=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=directory;
 try{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),first=pdf.addPage([400,600]);first.drawText('2',{x:196,y:20,size:24,font});
  if(extraPixel)first.drawRectangle({x:30,y:300,width:1,height:1,color:rgb(254/255,254/255,254/255)});
  pdf.addPage([400,600]).drawText('A saved instruction 12.',{x:40,y:500,size:18,font});
  const file=Buffer.from(await pdf.save()),manifest=await buildVisualSourceManifest(file,'repair.pdf');
  const units=manifest.units.map((unit,index)=>{
   const text=unit.localText.trim(),uncertainties=index?['Unclear saved note']:[];
   const views=unit.views.map(view=>{const reading={unitId:unit.id,viewId:view.id,text,tables:[],visualDescription:'',uncertainties};return {viewId:view.id,imageHash:view.sha256,textHash:digest(text),method:'visual-double-pass',confirmationHash:digest(text),reading,confirmation:structuredClone(reading)};});
   return {unitId:unit.id,inputHash:readingUnitInputHash(unit),text,textHash:digest(text),tables:[],visualDescription:'',uncertainties:index?['Unclear saved note']:['Source content is not verified'],views,complete:false,createdBy:{jobId:oldJob,rulesVersion:'visual-reading-rules-v2',profileRevision:1}};
  });
  const reading=assembleDocumentReading(manifest,units);reading.verification.createdBy={jobId:oldJob,rulesVersion:'visual-reading-rules-v2',profileRevision:1};
  const rows=pricingRows(),document=rows.documents.find(row=>row.id===pricingIds.work);
  Object.assign(document,{title:'repair.pdf',content_hash:digest(file),extracted_text:'Previous full source text.',extracted_text_hash:digest('Previous full source text.'),ai_status:'VALIDATED',parsed_json:{owner_note:'Keep manual note',financial_data:{total_amount:123}}});
  Object.assign(document,createReadingPatch(document,reading));const savedOther=structuredClone(document.parsed_json.source_reading_units[1]);
  if(corrupt==='manifest')document.parsed_json.source_reading.manifestHash='0'.repeat(64);
  if(corrupt==='input')document.parsed_json.source_reading_units[1].inputHash='0'.repeat(64);
  if(corrupt==='image')document.parsed_json.source_reading_units[1].views[0].imageHash='0'.repeat(64);
  if(corrupt==='text')document.parsed_json.source_reading_units[1].textHash='0'.repeat(64);
  if(corrupt==='initial')document.parsed_json.source_reading_units[1].views[0].initialReading=false;
  const database=pricingDatabase(rows,{allowWrites:true}),before=structuredClone(database.tables);let calls=0;
  const result=await stageDocumentReading({client:database,document,file,execution:{jobId:newJob,ownerId,projectId,profile:savedProfile,signal:new AbortController().signal,checkActive:async()=>{},reportProgress:async()=>{},generate:async input=>{
   calls++;const region=JSON.parse(input.text.split('SOURCE REGION: ')[1].split('\n')[0]),unit=manifest.units.find(row=>row.id===region.unitId);
   return JSON.stringify({unitId:unit.id,viewId:region.viewId,text:unit.localText.trim(),tables:[],visualDescription:'',uncertainties:unit.id==='pdf:2'?['Unclear saved note']:[]});
  }}});
  return {result,rows:database.tables,before,calls,manifest,savedOther,cache:await createVisualReadingCache(path.join(directory,'ContractorSystem/ai-runtime')).read({ownerId,projectId,documentId:document.id,sourceHash:digest(file)},manifest.units[0])};
 }finally{if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});}
}
test('a_physical_folio_repair_preserves_other_partial_units_without_repeating_the_model',async()=>{
 const value=await run(),[folio,other]=value.result.reading.units;
 if(value.calls){const views=[];for(const view of value.manifest.units[0].views){const local=await extractImageTextLocally(Buffer.from(view.bytes)),proof=await getRenderedEmptyPageProof(Buffer.from(view.bytes),1,local);views.push({id:view.id,hash:view.sha256,width:view.width,height:view.height,text:local.text,confidence:local.confidence,words:local.words,physicalProof:proof??null});}assert.equal(value.calls,0,JSON.stringify({initialManifestHash:value.manifest.manifestHash,finalManifestHash:value.result.reading.verification.manifestHash,initialInputs:value.manifest.units.map(readingUnitInputHash),finalInputs:value.result.reading.units.map(unit=>unit.inputHash),finalFolio:folio,views}));}
 assert.equal(value.calls,0);assert.equal(folio.complete,true);assert.ok(folio.views.every(view=>view.method==='physical-empty'));
 assert.ok(verifiedReadingUnit(folio,value.manifest.units[0]));assert.deepEqual(other,value.savedOther);assert.equal(other.complete,false);
 assert.equal(value.result.document.extracted_text,'Previous full source text.');assert.equal(value.result.document.ai_status,'VALIDATED');
 assert.equal(value.result.document.parsed_json.owner_note,'Keep manual note');assert.deepEqual(value.result.document.parsed_json.financial_data,{total_amount:123});
 assert.equal(value.result.reading.verification.complete,false);assert.ok(value.cache);
 assert.deepEqual(value.rows.pricing_ledger,value.before.pricing_ledger);assert.deepEqual(value.rows.contradictions,value.before.contradictions);
});
for(const corrupt of ['manifest','input','image','text','initial'])test('an_unbound_saved_'+corrupt+'_cannot_skip_an_existing_partial_unit',async()=>{
 const value=await run({corrupt});assert.ok(value.calls>0);assert.equal(value.result.reading.verification.complete,false);
});
test('a_folio_repair_cannot_conceal_unrecognized_ink_elsewhere_on_the_page',async()=>{
 const value=await run({extraPixel:true});assert.ok(value.calls>0);assert.equal(value.result.reading.units[0].complete,false);assert.equal(value.result.reading.verification.complete,false);
});
