import assert from 'node:assert/strict';
import test from 'node:test';
import {PDFDocument} from 'pdf-lib';
import {docx,paragraph,image,alternate,png} from './fixtures/docx-image-fixtures.mjs';
import {extractDocxWithImages} from '../src/utils/docx-image-extraction.ts';
import {buildWordSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {visualRegistry,digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {assessVisualReading} from '../src/utils/visual-source-reading.ts';
import {bindWordShapePages} from '../src/server/documents/word-layout.server.ts';
const shape=(name='diagram')=>`<w:p><w:r><w:pict><v:rect id="${name}" style="width:80pt;height:40pt"/></w:pict></w:r></w:p>`;
const read=(file,options={})=>extractDocxWithImages(file,{recognizeImage:async()=>({text:'Visible instruction',confidence:95}),...options});
const anchor={part:'word/document.xml',paragraph:2,name:'diagram',issue:'word/document.xml:UNSUPPORTED_PICT'};

test('a body drawing needs a unique name and confirmed contained placement',()=>{
 for(const locations of [[],[{name:'diagram',page:1}],[{name:'diagram',page:1,placementVerified:false}],[{name:'diagram',page:0,placementVerified:true}],[{name:'diagram',page:1,placementVerified:true},{name:'diagram',page:1,placementVerified:true}]]){
  const r=bindWordShapePages([anchor],locations,2);assert.equal(r.pages.length,0);assert.equal(r.unplaced.length,1);
 }
 const r=bindWordShapePages([anchor],[{name:'diagram',page:2,placementVerified:true}],2);assert.equal(r.pages[0].page,2);
 assert.equal(bindWordShapePages([anchor,{...anchor,paragraph:3}],[{name:'diagram',page:1,placementVerified:true}],2).pages.length,0);
 assert.equal(bindWordShapePages([{...anchor,part:'word/header1.xml'}],[{name:'diagram',page:1,placementVerified:true}],2).pages.length,0);
});

test('a separate passive Word page enters the ordinary visual source manifest',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([200,200]);const bytes=Buffer.from(await pdf.save());
 const file=docx({body:paragraph('Visible instruction')+shape(),media:{},rels:[]}),before=Buffer.from(file);
 const result=await buildWordSourceManifest(file,{renderLayout:async(passive,shapes)=>{
  assert.ok(passive.length);assert.equal(shapes[0].paragraph,2);return {file:bytes,pages:[{page:1,anchors:shapes}],unplaced:[]};
 }});
 assert.deepEqual(file,before);assert.deepEqual(result.issues,[]);assert.equal(result.units.length,1);
 assert.equal(result.units[0].id,'docx-layout:1');assert.equal(result.units[0].locations[0].anchor,'word/document.xml#diagram');
 assert.ok(result.units[0].views.length>0);assert.ok(result.assembly.some(p=>p.kind==='unit'&&p.unitId==='docx-layout:1'));
 assert.ok(!result.nativeText.includes('[DOCX_ISSUE word/document.xml:UNSUPPORTED_PICT]'));
 const literal='Visible shape instruction',textHash=digest(literal);
 const registry=visualRegistry({format:'DOCX',sourceHash:result.sourceHash,currentTextHash:textHash,manifestHash:result.manifestHash,
  expectedUnits:result.units.map(u=>({id:u.id,kind:u.kind,locations:u.locations,views:u.views.map(({bytes,...v})=>v),status:'READ',inputHash:readingUnitInputHash(u),textHash,literalHasBody:true,visualHasContent:false,
   verifiedViews:u.views.map(v=>({viewId:v.id,imageHash:v.sha256,textHash,method:'no-numbers',confirmationHash:textHash})),uncertainties:[]}))});
 assert.deepEqual(assessVisualReading(registry,{content_hash:result.sourceHash,extracted_text_hash:textHash,extracted_text:literal}).issues,[]);
});

test('unplaced Word shapes and conversion failures remain explicit source gaps',async()=>{
 const file=docx({body:paragraph('Context')+shape(),media:{},rels:[]});
 const result=await buildWordSourceManifest(file,{renderLayout:async(_,shapes)=>({file:Buffer.alloc(0),pages:[],unplaced:shapes})});
 assert.ok(result.issues.includes('word/document.xml:UNSUPPORTED_PICT'));assert.ok(result.issues.some(i=>i.endsWith('WORD_SHAPE_LOCATION_UNVERIFIED')));
 const failed=await buildWordSourceManifest(file,{renderLayout:async()=>{throw Error('offline converter unavailable');}});
 assert.ok(failed.issues.includes('WORD_LAYOUT_UNAVAILABLE'));
});

test('external images macros and active fields never reach the Word layout process',async()=>{
 for(const extra of [
  {rels:[['rId1','https://example.invalid/photo.png',true]]},
  {parts:{'word/vbaProject.bin':'macro bytes'}},
  {body:paragraph('Context')+shape()+'<w:p><w:r><w:instrText> INCLUDETEXT "https://example.invalid/remote" </w:instrText></w:r></w:p>'}
 ]){
  let calls=0;await read(docx({body:paragraph('Context')+shape(),media:{},rels:[],...extra}),{onLayout:()=>calls++});assert.equal(calls,0);
 }
 let pageCalls=0;await read(docx({body:shape()+'<w:p><w:r><w:instrText> PAGE </w:instrText></w:r></w:p>',media:{},rels:[]}),{onLayout:()=>pageCalls++});assert.equal(pageCalls,1);
});

test('equal fallback bytes at different package paths keep both relationships and one reading',async()=>{
 let calls=0;const body=alternate().replace('<v:imagedata r:id="rId1"','<v:imagedata r:id="alt"');
 const result=await read(docx({body,media:{'image1.png':png,'copy.png':png},rels:[['rId1','media/image1.png'],['alt','media/copy.png']]}),{recognizeImage:async()=>{calls++;return {text:'Visible instruction',confidence:95};}});
 assert.equal(calls,1);assert.deepEqual(result.readingVerification.images[0].alternateRelationships,['alt']);
});

test('a comment reference before its range end cannot certify its position',async()=>{
 const comment='<w:comment w:id="3">'+paragraph('Check this position')+'</w:comment>';
 const body='<w:p><w:commentRangeStart w:id="3"/><w:r><w:t>Body</w:t><w:commentReference w:id="3"/></w:r><w:commentRangeEnd w:id="3"/></w:p>';
 const result=await read(docx({body,media:{},rels:[],parts:{'word/comments.xml':comment}}));assert.ok(result.readingVerification.issues.includes('word/comments.xml:COMMENT_ANCHOR_UNVERIFIED:3'));
});


test('a photo and an adjacent arrow are both content rather than decoration',async()=>{
 const body='<w:p><w:r><w:pict><v:shape id="photo"><v:imagedata r:id="rId1"/></v:shape><v:line id="direction" style="width:30pt;height:20pt"/></w:pict></w:r></w:p>';
 let layout;const result=await read(docx({body}),{onLayout:(_,shapes)=>layout=shapes});
 assert.equal(result.readingVerification.images.length,1);assert.ok(result.readingVerification.issues.includes('word/document.xml:UNSUPPORTED_PICT'));
 assert.ok(layout.some(s=>s.name==='direction'));
});
import {verifyWordShapeDifference} from '../src/server/documents/word-layout.server.ts';

test('Word page proof compares actual pixels and rejects reflow or an ambiguous body repetition',async()=>{
 const make=async(pages,wide=false)=>{const d=await PDFDocument.create();for(let n=1;n<=2;n++){const p=d.addPage([200,200]);if(pages.includes(n))p.drawRectangle({x:20,y:40,width:wide?150:20,height:20});}return Buffer.from(await d.save());};
 const blank=await make([]),single=await make([2]);
 assert.deepEqual(await verifyWordShapeDifference(single,blank,{widthMm100:800,heightMm100:800}),[2]);
 assert.deepEqual(await verifyWordShapeDifference(single,single,{widthMm100:800,heightMm100:800}),[]);
 assert.deepEqual(await verifyWordShapeDifference(await make([2],true),blank,{widthMm100:800,heightMm100:800}),[]);
 const repeated=await make([1,2]);
 assert.deepEqual(await verifyWordShapeDifference(repeated,blank,{widthMm100:800,heightMm100:800}),[]);
 assert.deepEqual(await verifyWordShapeDifference(repeated,blank,{widthMm100:800,heightMm100:800},true),[1,2]);
 const one=await PDFDocument.create();one.addPage([200,200]);assert.deepEqual(await verifyWordShapeDifference(single,Buffer.from(await one.save()),{widthMm100:800,heightMm100:800}),[]);
});
import {readingUnitInputHash} from '../src/server/ai/visual-reading-cache.server.ts';

test('a previously verified labelled picture retains the exact HEAD cache identity',async()=>{
 const body=paragraph('Before')+'<w:p><w:r><w:pict><v:shape><v:imagedata r:id="rId1"/><v:textbox><w:txbxContent>'+paragraph('Label')+'</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>'+paragraph('After');
 const m=await buildWordSourceManifest(docx({body}));
 // Captured from the approved base 52411ee8, before adding native paragraph/relationship metadata.
 assert.equal(readingUnitInputHash(m.units[0]),'abf590cf367464be3a0546aaf91683d41cc5659b1a3cd119149eb1d146e5b9f5');
 assert.deepEqual(m.issues,[]);
});

test('different native text in Word alternative branches cannot silently become one verified source',async()=>{
 const body=alternate().replace('<mc:Choice Requires="wps">','<mc:Choice Requires="wps">'+paragraph('Primary condition')).replace('<mc:Fallback>','<mc:Fallback>'+paragraph('Different fallback condition'));
 const result=await read(docx({body}));assert.ok(result.readingVerification.issues.includes('word/document.xml:ALTERNATE_TEXT_CONTENT_UNVERIFIED'));
});
