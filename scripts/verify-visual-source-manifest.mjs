import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {PDFDocument,StandardFonts,degrees,rgb} from 'pdf-lib';
import {docx,image,alternate,paragraph,relationships} from './fixtures/docx-image-fixtures.mjs';
import {digest,visualRegistry,sourceDocument} from './codex-runtime/visual-reading-fixtures.mjs';
import {assessVisualReading} from '../src/utils/visual-source-reading.ts';
import {assembleDocumentReading} from '../src/utils/document-reading-history.ts';
import {readingUnitInputHash} from '../src/server/ai/visual-reading-cache.server.ts';
const load=async file=>import(file).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith(file.slice(2)))return {};throw error;});
const manifestApi=await load('../src/utils/visual-source-manifest.ts'),renderer=await load('../src/utils/visual-pdf-renderer.ts');
const build=(...args)=>{assert.equal(typeof manifestApi.buildVisualSourceManifest,'function','Missing visual source manifest builder');return manifestApi.buildVisualSourceManifest(...args);};
const png=color=>sharp({create:{width:80,height:40,channels:3,background:color}}).png().toBuffer();
async function pdf({rotated=false}={}){
 const doc=await PDFDocument.create(),page=doc.addPage(rotated?[2000,1200]:[400,600]);
 const font=await doc.embedFont(StandardFonts.Helvetica);
 page.drawText('Native body remains available. '.repeat(12),{x:110,y:600,size:12,font});
 page.drawRectangle({x:300,y:200,width:80,height:50,color:rgb(1,0,0)});
 if(rotated){page.setCropBox(100,50,1800,1000);page.setRotation(degrees(90));}
 return Buffer.from(await doc.save());
}
test('word_header_alternate_repeated_image_has_all_locations',async()=>{
 const a=await png('red'),b=await png('blue');
 const file=docx({body:paragraph('Before')+image()+paragraph('Between')+image()+image('rId2')+paragraph('After'),
  media:{'image1.png':a,'image2.png':b},rels:[['rId1','media/image1.png'],['rId2','media/image2.png']],
  parts:{'word/header1.xml':paragraph('Header')+alternate(),'word/_rels/header1.xml.rels':relationships([['rId1','media/image1.png']])}});
 const before=digest(file),manifest=await build(file,'original.docx');
 assert.equal(manifest.units.length,2);assert.equal(manifest.units[0].locations.length,3);
 assert.ok(manifest.units[0].locations.some(l=>l.part==='word/header1.xml'));
 assert.equal(digest(manifest.units[0].views[0].bytes),digest(a));
 assert.equal(manifest.units[0].views[0].width,80);
 assert.ok(manifest.assembly.some(x=>x.kind==='native'&&x.text.includes('Before')));
 assert.equal(digest(file),before);
});

test('a_Word_table_keeps_its_read_image_in_source_order_when_cell_line_breaks_are_flattened',async()=>{
 const file=docx({body:`<w:tbl><w:tr><w:tc>${paragraph('Before photo')+image()+paragraph('After photo')}</w:tc></w:tr></w:tbl>`,media:{'image1.png':await png('red')}}),before=digest(file),manifest=await build(file,'table-photo.docx'),unit=manifest.units[0];
 assert.equal(manifest.units.length,1);assert.equal(unit.contextText,'','Keep the existing image prompt and cache binding for flattened table cells');assert.equal(manifest.issues.length,0,'A table cell must retain the image placement');
 const text='The source image contains the site access instruction.',reading={unitId:unit.id,inputHash:readingUnitInputHash(unit),text,textHash:digest(text),tables:[],visualDescription:'',uncertainties:[],complete:true,views:[{viewId:unit.views[0].id,imageHash:unit.views[0].sha256}]};
 const assembled=assembleDocumentReading(manifest,[reading]);assert.match(assembled.text,/Before photo[\s\S]*site access instruction[\s\S]*After photo/);assert.ok(!assembled.text.includes('[DOCX_IMAGE '));assert.equal(digest(file),before);
});
test('rotated_pdf_tile_gap_is_detected',async()=>{
 const file=await pdf({rotated:true}),before=digest(file),manifest=await build(file,'rotated.pdf');
 assert.equal(manifest.units.length,1);const unit=manifest.units[0];
 assert.equal(unit.locations[0].page,1);assert.ok(unit.views.length>2);
 assert.ok(unit.views[0].height>unit.views[0].width);
 for(const view of unit.views){const meta=await sharp(view.bytes).metadata();assert.equal(meta.width,view.width);assert.equal(meta.height,view.height);assert.ok(view.width*view.height<=16_000_000);assert.equal(digest(view.bytes),view.sha256);}
 const registry=visualRegistry(),entry=registry.expectedUnits[0];
 entry.views=unit.views.map(v=>({id:v.id,sha256:v.sha256,width:v.width,height:v.height,rect:v.rect}));
 const proof=entry.verifiedViews[0];entry.verifiedViews=unit.views.map(v=>({...proof,viewId:v.id,imageHash:v.sha256}));
 assert.equal(assessVisualReading(registry,sourceDocument()).complete,true);
 entry.verifiedViews.pop();assert.equal(assessVisualReading(registry,sourceDocument()).complete,false);
 assert.equal(digest(file),before);
});
test('native_text_does_not_hide_visual_content',async()=>{
 const manifest=await build(await pdf(),'mixed.pdf');
 assert.match(manifest.nativeText,/Native body remains available/);assert.equal(manifest.units.length,1);
 assert.deepEqual(manifest.units[0].views[0].rect,{x:0,y:0,width:1,height:1});
 assert.ok(manifest.units[0].views.length>=2);
});
test('unsupported_or_external_part_remains_issue',async()=>{
 for(const file of [docx({body:paragraph('Source')+image(),media:{'old.emf':Buffer.from('not a raster')},rels:[['rId1','media/old.emf']]}),docx({body:paragraph('Source')+image(),rels:[['rId1','https://invalid.test/image.png',true]]})]){
  const manifest=await build(file,'unsafe.docx');assert.ok(manifest.issues.length>0);assert.ok(manifest.nativeText.includes('Source'));
 }
});
test('a_crop_has_its_own_image_hash_and_original_page_coordinates',async()=>{
 assert.equal(typeof renderer.renderPdfView,'function','Missing physical PDF renderer');
 const file=await pdf(),before=digest(file),full=await renderer.renderPdfView(file,1,undefined);
 const crop=await renderer.renderPdfView(file,1,{x:0.5,y:0.5,width:0.5,height:0.5});
 assert.notEqual(crop.sha256,full.sha256);assert.deepEqual(crop.rect,{x:0.5,y:0.5,width:0.5,height:0.5});
 assert.equal(digest(file),before);
});

test('converted_repeated_raster_keeps_one_unit_and_all_anchors',async()=>{
 const bytes=await sharp({create:{width:30,height:20,channels:3,background:'red'}}).webp().toBuffer();
 const manifest=await build(docx({body:image()+image(),media:{'image1.webp':bytes},rels:[['rId1','media/image1.webp']]}),'raster.docx');
 assert.equal(manifest.units.length,1);assert.equal(manifest.units[0].locations.length,2);
 assert.equal((await sharp(manifest.units[0].views[0].bytes).metadata()).format,'png');
});
