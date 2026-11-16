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

// R05: alternatives and ZIP leaves must be independently reproducible from their original bytes.
import {archiveFixture} from './fixtures/archive-fixtures.mjs';
test('html_and_plain_keep_independent_bytes_and_table_structure',async()=>{
 const body='Base instruction',html='<p>Base instruction</p><table><tr><td>Extra row</td><td>17 mm</td></tr></table>';
 const file=msgFixture({body,html}),manifest=await build(file),container=await readMsgContainer(file),representations=container.parts.filter(p=>p.representation);
 assert.equal(representations.length,2);for(const p of representations){const payload=container.payloads.get(p.id);assert.equal(digest(payload),p.payloadHash);assert.equal(payload.length,p.byteLength);assert.equal(p.parentId,container.rootPartId);}
 assert.equal(container.payloads.get(representations.find(p=>p.representation==='HTML').id).toString(),html);
 assert.equal(container.payloads.get(representations.find(p=>p.representation==='PLAIN').id).toString('utf16le'),body+'\0');
 assert.ok(manifest.nativeText.includes('Extra row\t17 mm'));const comparison=manifest.msg.parts.find(p=>p.representation==='HTML').bodyComparison;assert.equal(comparison.textEquivalent,false);assert.equal(comparison.hasTableStructure,true);const full=completed(manifest);assert.equal(assessVisualReading(full.reading.verification,full.document).complete,true);
 const again=await readMsgContainer(file);assert.deepEqual(again.parts.map(p=>p.id),container.parts.map(p=>p.id));
});
test('zip_same_names_and_corrupt_sibling_keep_parent_partial',async()=>{
 const zip=archiveFixture([{name:'same.txt',bytes:'First instruction'},{name:'same.txt',bytes:'Second instruction'},{name:'broken.txt',bytes:'bad',corrupt:true}]),file=msgFixture({attachments:[{name:'files.zip',data:zip}]}),manifest=await build(file),{reading,document}=completed(manifest),parts=reading.verification.msg.parts;
 const duplicates=parts.filter(p=>p.name==='same.txt');assert.equal(duplicates.length,2);assert.notEqual(duplicates[0].id,duplicates[1].id);assert.notEqual(duplicates[0].payloadHash,duplicates[1].payloadHash);assert.ok(reading.text.includes('First instruction'));assert.ok(reading.text.includes('Second instruction'));
 assert.equal(parts.find(p=>p.name==='broken.txt').status,'REQUIRES_REVIEW');assert.ok(parts.find(p=>p.name==='broken.txt').issues.includes('ARCHIVE_CHECKSUM_INVALID'));assert.equal(parts.find(p=>p.name==='files.zip').status,'REQUIRES_REVIEW');assert.equal(parts[0].status,'REQUIRES_REVIEW');assert.equal(assessVisualReading(reading.verification,document).complete,false);
 const reopened=await readMsgContainer(file);for(const p of duplicates)assert.equal(digest(reopened.payloads.get(p.id)),p.payloadHash);
});
test('valid_archive_hierarchy_is_complete_but_forged_parent_is_rejected',async()=>{
 const file=msgFixture({attachments:[{name:'files.zip',data:archiveFixture([{name:'one.txt',bytes:'One'},{name:'two.txt',bytes:'Two'}])}]}),manifest=await build(file),{reading,document}=completed(manifest);assert.equal(assessVisualReading(reading.verification,document).complete,true);
 const changed=structuredClone(reading.verification);changed.msg.parts[2].parentId=changed.msg.rootPartId;changed.msg.inventory[2].parentId=changed.msg.rootPartId;assert.equal(assessVisualReading(changed,document).complete,false);
});
test('html_cid_requires_one_physical_target_and_keeps_plain_when_partial',async()=>{
 const png=await sharp({create:{width:12,height:12,channels:3,background:'blue'}}).png().toBuffer();
 for(const count of [0,1,2]){const manifest=await build(msgFixture({body:'Retained body',html:'<p>Other instruction</p><img src="cid:known">',attachments:Array.from({length:count},()=>({name:'same.png',data:png,contentId:'known'}))})),{reading,document}=completed(manifest);assert.ok(reading.text.includes('Retained body'));assert.ok(reading.text.includes('Other instruction'));assert.equal(assessVisualReading(reading.verification,document).complete,count===1);}
});
test('archive_limits_bound_entries_bytes_and_nested_depth',async()=>{
 const {readArchiveParts}=await import('../src/server/documents/archive-parts.server.ts');const zip=archiveFixture([{name:'one.txt',bytes:'12345'},{name:'two.txt',bytes:'67890'}]);
 assert.ok((await readArchiveParts(zip,{maxEntries:1})).some(p=>p.issues.includes('ARCHIVE_ENTRY_LIMIT')));assert.ok((await readArchiveParts(zip,{maxTotalBytes:4})).every(p=>!p.bytes));
 assert.ok((await readArchiveParts(archiveFixture([{name:'../escape.txt',bytes:'bad'}])))[0].issues.includes('ARCHIVE_UNSAFE_NAME'));
 const file=msgFixture({attachments:[{name:'files.zip',data:archiveFixture([{name:'nested.zip',bytes:zip}])}]}),result=await readMsgContainer(file,{limits:{maxDepth:1}});assert.ok(result.parts.find(p=>p.name==='nested.zip').issues.includes('ARCHIVE_DEPTH_LIMIT'));assert.equal(result.parts.length,3);
});

 test('independent_rtf_read_supersedes_missing_sync_but_failure_preserves_plain',async()=>{
 const file=msgFixture({body:'Old instruction',rtf:uncompressedRtf('{\\rtf1 New instruction}'),rtfInSync:false});
 for(const fail of [false,true]){const extractor=createMsgSourceExtractor({container:readMsgContainer,native:async()=>nativeMsgFixture(),rtf:async bytes=>{assert.equal(bytes.toString(),'{\\rtf1 New instruction}');if(fail)throw Error('damaged RTF');return 'New instruction';}}),{buildMsgSourceManifest}=await manifestModule(),manifest=await buildMsgSourceManifest(file,'source.msg',{extract:extractor,buildPart:part}),{reading,document}=completed(manifest);
  assert.ok(reading.text.includes('Old instruction'));assert.equal(assessVisualReading(reading.verification,document).complete,!fail);
  const alternative=manifest.msg.parts.find(p=>p.representation==='RTF');assert.ok(alternative.sourceStreamHash);assert.ok(alternative.sourceStreamByteLength>0);if(!fail)assert.ok(reading.text.includes('New instruction'));else assert.ok(alternative.issues.includes('MSG_RTF_READING_UNCONFIRMED'));
 }
 });
 test('ctb_is_an_addressed_auxiliary_resource_and_not_a_text_instruction',async()=>{
 const bytes=Buffer.from('PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec synthetic'),file=msgFixture({attachments:[{name:'files.zip',data:archiveFixture([{name:'style.ctb',bytes},{name:'drawing.dwg',bytes:'AC1027 synthetic'}])}]}),manifest=await build(file),{reading}=completed(manifest),resource=reading.verification.msg.parts.find(p=>p.name==='style.ctb');assert.equal(resource.auxiliaryRole,'CAD_PLOT_STYLE');assert.equal(resource.payloadHash,digest(bytes));assert.equal(resource.status,'READ');assert.equal(reading.verification.msg.parts[0].status,'REQUIRES_REVIEW');assert.ok(!reading.text.includes('pmzlibcodec'));
 });

 test('partial_cad_sheets_keep_dwg_origin_and_safe_fragment_access',async()=>{
 const {createSourceFragmentRenderer}=await import('../src/server/documents/visual-fragment-renderer.server.ts');
 const bytes=Buffer.from('AC1027 original drawing'),png=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer(),file=msgFixture({attachments:[{name:'same.dwg',data:bytes},{name:'same.dwg',data:bytes}]}),{buildMsgSourceManifest}=await manifestModule();
 const manifest=await buildMsgSourceManifest(file,'source.msg',{extract,buildPart:part,renderCadSheets:async(input,siblings)=>{assert.deepEqual(input,bytes);assert.equal(siblings.length,2);assert.ok(siblings.every(s=>s.bytes&&s.sha256===digest(s.bytes)));return {sourceHash:digest(input),status:'REQUIRES_REVIEW',issues:['CAD_RENDER_PARTIAL'],sheets:[{id:'cad:'+digest(input)+':0:Model',name:'Model',sourceHash:digest(input),image:png,issues:['CAD_UNSUPPORTED_ENTITY:Text']},{id:'cad:'+digest(input)+':1:Layout',name:'Layout',sourceHash:digest(input),image:null,issues:['CAD_LAYOUT_VIEWPORT_UNSUPPORTED']}]};}});
 assert.equal(manifest.units.length,2);assert.notEqual(manifest.units[0].id,manifest.units[1].id);const {reading,document}=completed(manifest);assert.equal(assessVisualReading(reading.verification,document).complete,false);
 const drawings=manifest.msg.parts.filter(p=>p.name==='same.dwg');assert.ok(drawings.every(p=>p.nativeComplete===false&&p.cadSheets.length===2));assert.ok(drawings.every(p=>p.issues.some(i=>i.includes('CAD_LAYOUT_VIEWPORT_UNSUPPORTED'))));
 for(const unit of manifest.units){const l=unit.locations[0];assert.equal(l.cadSourceHash,digest(bytes));assert.equal(l.cadImageHash,digest(png));assert.equal(l.sheet,'Model');assert.ok(drawings.some(p=>p.id===l.msgPartId&&p.unitIds.includes(unit.id)));assert.ok(manifest.assembly.some(b=>b.kind==='unit'&&b.unitId===unit.id&&b.msgPartId===l.msgPartId));}
 const rect={x:0,y:0,width:0.5,height:0.5},renderer=createSourceFragmentRenderer(file,'source.msg',manifest);assert.ok(await renderer(manifest.units[0],rect));
 const forged=structuredClone(manifest.units[0]);forged.locations[0].msgPartId=manifest.units[1].locations[0].msgPartId;assert.equal(await renderer(forged,rect),null);
 const stale=Buffer.from(file);stale[stale.length-1]^=1;assert.equal(await createSourceFragmentRenderer(stale,'source.msg',manifest)(manifest.units[0],rect),null);
 const declared=structuredClone(manifest);declared.msg.parts.find(p=>p.id===manifest.units[0].locations[0].msgPartId).payloadHash='9'.repeat(64);assert.equal(await createSourceFragmentRenderer(file,'source.msg',declared)(declared.units[0],rect),null);
 });

 test('cad_failure_keeps_other_sheet_and_message_text',async()=>{
 const png=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).png().toBuffer(),file=msgFixture({body:'Retained original instruction',attachments:[{name:'first.dwg',data:Buffer.from('AC1027 first')},{name:'second.dwg',data:Buffer.from('AC1027 second')}]}),{buildMsgSourceManifest}=await manifestModule();let n=0;
 const manifest=await buildMsgSourceManifest(file,'source.msg',{extract,buildPart:part,renderCadSheets:async bytes=>{if(n++)throw Error('unreadable second drawing');return {sourceHash:digest(bytes),status:'REQUIRES_REVIEW',issues:['CAD_RENDER_PARTIAL'],sheets:[{id:'Model',name:'Model',sourceHash:digest(bytes),image:png,issues:[]}]};}}),{reading}=completed(manifest);
 assert.ok(reading.text.includes('Retained original instruction'));assert.equal(manifest.units.length,1);assert.ok(manifest.msg.parts.find(p=>p.name==='second.dwg').issues.includes('CAD_READING_FAILED'));assert.equal(reading.verification.msg.parts[0].status,'REQUIRES_REVIEW');assert.ok(manifest.assembly.some(b=>b.kind==='unit'&&b.unitId===manifest.units[0].id));
 });

 test('saved_addressable_rtf_repeat_is_cached_without_model_or_writes',async t=>{
 if(!process.env.LOCAL_OCR_MCP_PATH){t.skip('Requires the pinned installed native reader');return;}
 const {stageDocumentReading}=await import('../src/server/ai/handlers/document-reading.ts'),file=msgFixture({body:'Old instruction',rtf:uncompressedRtf('{\\rtf1 New instruction}'),rtfInSync:false}),manifest=await buildVisualSourceManifest(file,'source.msg'),{reading,document}=completed(manifest);assert.equal(assessVisualReading(reading.verification,document).complete,true);assert.ok(reading.verification.msg.parts.some(p=>p.representation==='RTF'));
 let checks=0;const result=await stageDocumentReading({file,document,client:{from(){throw Error('Cached reading must not write');}},execution:{ownerId:'fixture-owner',projectId:document.project_id,jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',profile:{revision:1},checkActive:async()=>{checks++;},reportProgress:async()=>{},ask:async()=>{throw Error('Cached reading must not use a model');}}});
 assert.equal(result.cached,true);assert.equal(result.reading.text,reading.text);assert.ok(checks>=2);
 });
