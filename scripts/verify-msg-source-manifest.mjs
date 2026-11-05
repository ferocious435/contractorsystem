import assert from 'node:assert/strict';import test from 'node:test';import sharp from 'sharp';
import {msgFixture,nativeMsgFixture,uncompressedRtf} from './fixtures/msg-fixtures.mjs';
import {docx,image,paragraph} from './fixtures/docx-image-fixtures.mjs';
import {digest,readingUnit,sourceDocument} from './codex-runtime/visual-reading-fixtures.mjs';
import {createMsgSourceExtractor} from '../src/server/documents/msg-source.server.ts';import {readMsgContainer} from '../src/server/documents/msg-container.server.ts';
import {buildVisualSourceManifest} from '../src/utils/visual-source-manifest.ts';import {assembleDocumentReading} from '../src/utils/document-reading-history.ts';import {assessVisualReading} from '../src/utils/visual-source-reading.ts';
const extract=createMsgSourceExtractor({container:readMsgContainer,native:async()=>nativeMsgFixture()});
const manifestModule=()=>import('../src/utils/msg-source-manifest.ts');
const verified=(unit,text='Read source page')=>({unitId:unit.id,inputHash:'3'.repeat(64),text,textHash:digest(text),tables:[],visualDescription:'',uncertainties:[],complete:true,
 views:unit.views.map(view=>({viewId:view.id,imageHash:view.sha256,textHash:digest(text),method:'native-match',confirmationHash:digest(text)}))});
function completed(manifest,units=manifest.units.map(u=>verified(u))){const reading=assembleDocumentReading(manifest,units);reading.verification.createdBy={jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rulesVersion:'visual-reading-rules-v2',profileRevision:1};const document=sourceDocument({title:'source.msg',content_hash:manifest.sourceHash,extracted_text:reading.text,extracted_text_hash:reading.textHash,parsed_json:{source_reading:reading.verification}});reading.verification.msg.scope={ownerId:'fixture-owner',projectId:document.project_id,documentId:document.id,sourceHash:manifest.sourceHash};return {reading,document};}
const pdfBytes=Buffer.from('%PDF-1.7 synthetic boundary fixture');
async function part(bytes,title){
 if(title==='two.pdf'){
  assert.deepEqual(bytes,pdfBytes);const units=[1,2].map(page=>readingUnit({id:'pdf:'+page,locations:[{page}]}));
  return {sourceHash:digest(bytes),manifestHash:'2'.repeat(64),format:'PDF',nativeText:'',nativeVerification:{},units,issues:[],assembly:units.map(u=>({kind:'unit',unitId:u.id}))};
 }
 if(title==='sheet.xlsx'){
  const unit=readingUnit({id:'xlsx:image',kind:'XLSX_IMAGE',locations:[{part:'xl/worksheets/sheet1.xml',anchor:'xl/worksheets/sheet1.xml#image1',sheet:'Plan',mediaName:'xl/media/photo.png',frame:1,cellRange:'A1:B2'}]});
  return {sourceHash:digest(bytes),manifestHash:'2'.repeat(64),format:'XLSX',nativeText:'Grid row',nativeVerification:{},units:[unit],issues:[],assembly:[{kind:'native',text:'Grid row'},{kind:'unit',unitId:unit.id}]};
 }
 return buildVisualSourceManifest(bytes,title);
}
async function build(file){const {buildMsgSourceManifest}=await manifestModule();return buildMsgSourceManifest(file,'source.msg',{extract,buildPart:part});}

test('body_does_not_hide_an_unread_attachment',async()=>{
 const manifest=await build(msgFixture({body:'Read body',attachments:[{name:'two.pdf',mimeType:'application/pdf',data:pdfBytes}]}));
 const {reading,document}=completed(manifest,[verified(manifest.units[0])]);assert.equal(assessVisualReading(reading.verification,document).complete,false);
 assert.ok(reading.text.includes('Read body'));assert.equal(reading.verification.msg.parts.find(p=>p.name==='two.pdf').status,'REQUIRES_REVIEW');
 const full=completed(manifest);assert.equal(assessVisualReading(full.reading.verification,full.document).complete,true);assert.equal(full.reading.verification.msg.parts.find(p=>p.name==='two.pdf').status,'READ');
 assert.deepEqual(manifest.units.flatMap(u=>u.locations.map(l=>l.page)),[1,2]);
});
test('all_native_and_visual_parts_are_required',async()=>{
 const png=await sharp({create:{width:20,height:20,channels:3,background:'blue'}}).png().toBuffer();
 const file=msgFixture({body:'Original message',attachments:[{name:'note.txt',mimeType:'text/plain',data:Buffer.from('A complete short note.')},{name:'plan.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',data:docx({body:paragraph('Word before')+image()+paragraph('Word after'),media:{'image1.png':png}})},{name:'sheet.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data:Buffer.from('PK synthetic workbook boundary')},{name:'photo.png',mimeType:'image/png',data:png}]});
 const manifest=await build(file),{reading,document}=completed(manifest);assert.equal(assessVisualReading(reading.verification,document).complete,true);assert.equal(reading.verification.msg.parts.length,5);
 for(const word of ['Original message','A complete short note.','Word before','Word after','Grid row'])assert.ok(reading.text.includes(word),word);
 assert.deepEqual(manifest.units.map(u=>u.kind),['DOCX_IMAGE','XLSX_IMAGE','IMAGE_FRAME']);assert.equal(new Set(manifest.units.map(u=>u.id)).size,3);
 for(const unit of manifest.units)for(const location of unit.locations)assert.ok(reading.verification.msg.parts.some(p=>p.id===location.msgPartId));
 assert.ok(manifest.units.find(u=>u.kind==='DOCX_IMAGE').locations.some(l=>l.part==='word/document.xml'));
});
test('unsupported_archive_and_nested_message_remain_explicit_gaps',async()=>{
 const file=msgFixture({attachments:[{name:'archive.zip',mimeType:'application/zip',data:Buffer.from('PK archive')},{name:'schedule.mpp',mimeType:'application/vnd.ms-project',data:Buffer.from('project')},{name:'nested.msg',embedded:{body:'Nested'}}]});
 const manifest=await build(file),{reading,document}=completed(manifest);assert.equal(assessVisualReading(reading.verification,document).complete,false);
 for(const name of ['archive.zip','schedule.mpp','nested.msg'])assert.equal(reading.verification.msg.parts.find(p=>p.name===name).status,'REQUIRES_REVIEW');
});
test('part_hashes_ids_and_all_units_must_match_the_physical_inventory',async()=>{
 const manifest=await build(msgFixture({attachments:[{name:'two.pdf',mimeType:'application/pdf',data:pdfBytes}]})),{reading,document}=completed(manifest);assert.equal(assessVisualReading(reading.verification,document).complete,true);
 for(const mutate of [r=>r.msg.parts.pop(),r=>{r.msg.parts[1].payloadHash='9'.repeat(64);},r=>{r.msg.parts[1].id='8'.repeat(64);},r=>{r.expectedUnits.pop();},r=>{r.expectedUnits[0].locations[0].msgPartId=r.msg.rootPartId;}]){const copy=structuredClone(reading.verification);mutate(copy);assert.equal(assessVisualReading(copy,document).complete,false);}
});
test('inline_reference_is_not_an_attachment_inventory',async()=>{
 const manifest=await build(msgFixture({body:'See <image001.png>'})),{reading,document}=completed(manifest);assert.equal(reading.verification.msg.parts.length,1);assert.equal(manifest.units.length,0);assert.equal(assessVisualReading(reading.verification,document).complete,true);
 const missing=completed(await build(msgFixture({html:'<img src="cid:unavailable">'})));assert.equal(assessVisualReading(missing.reading.verification,missing.document).complete,false);
});
test('same_named_visual_attachments_keep_distinct_source_locations',async()=>{
 const file=msgFixture({attachments:[{name:'two.pdf',data:pdfBytes},{name:'two.pdf',data:pdfBytes}]}),manifest=await build(file),{reading,document}=completed(manifest);
 assert.equal(manifest.units.length,4);assert.equal(new Set(manifest.units.map(u=>u.id)).size,4);assert.equal(new Set(manifest.units.flatMap(u=>u.locations.map(l=>l.msgPartId))).size,2);assert.equal(assessVisualReading(reading.verification,document).complete,true);
});
for(const [name,mutate]of [['missing_locations',r=>{delete r.expectedUnits[0].locations;}],['missing_message_headers',r=>{delete r.msg.parts[0].headers;}],['missing_body_ranges',r=>{r.msg.parts[0].textRanges=[];}],['changed_container_path',r=>{r.msg.parts[1].containerPath.push('forged');}]])test('corrupt_MSG_proof_'+name,async()=>{
 const {reading,document}=completed(await build(msgFixture({attachments:[{name:'two.pdf',data:pdfBytes}]}))),proof=structuredClone(reading.verification);mutate(proof);let result;
 assert.doesNotThrow(()=>{result=assessVisualReading(proof,document);});assert.equal(result.complete,false);
});

test('unsynchronized_rtf_cannot_be_reported_as_a_complete_message',async()=>{
 for(const rtfInSync of [false,undefined,2]){
  const file=msgFixture({body:'Old instruction',rtf:uncompressedRtf('{\\rtf1 New instruction}'),rtfInSync}),{reading,document}=completed(await build(file));
  assert.equal(assessVisualReading(reading.verification,document).complete,false,'An unconfirmed alternative must remain visible');assert.ok(reading.text.includes('Old instruction'));assert.ok(reading.verification.msg.parts[0].issues.includes('MSG_RTF_TEXT_SYNC_UNCONFIRMED'));
 }
 const {reading,document}=completed(await build(msgFixture({body:'Same instruction',rtf:uncompressedRtf('{\\rtf1 Same instruction}'),rtfInSync:true})));assert.equal(assessVisualReading(reading.verification,document).complete,true);
});

test('rtf_html_cannot_hide_an_unaccounted_visual_object',async()=>{
 for(const markup of ['<img src="cid:missing">','<svg><path d="M0 0 L10 10"/></svg>','<img src="data:image/png;base64,AA==">']){
  const {reading,document}=completed(await build(msgFixture({body:'Visible instruction',rtf:uncompressedRtf('{\\rtf1\\fromhtml1{\\*\\htmltag1 '+markup+'}Visible instruction}'),rtfInSync:true})));
  assert.equal(assessVisualReading(reading.verification,document).complete,false,'Synchronized text does not confirm an inline drawing');
 }
 const png=await sharp({create:{width:12,height:12,channels:3,background:'blue'}}).png().toBuffer();
 const {reading,document}=completed(await build(msgFixture({body:'Visible instruction',rtf:uncompressedRtf('{\\rtf1\\fromhtml1{\\*\\htmltag1 <style>v:behavior{behavior:url(#default#VML)}</style><img src="cid:known">}Visible instruction}'),rtfInSync:true,attachments:[{name:'photo.png',mimeType:'image/png',data:png,contentId:'known'}]})));
 assert.equal(assessVisualReading(reading.verification,document).complete,true,'A verified physical image remains usable');
});
