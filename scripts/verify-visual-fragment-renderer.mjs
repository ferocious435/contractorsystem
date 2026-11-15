import assert from 'node:assert/strict';
import test from 'node:test';
import {PDFDocument,rgb,degrees} from 'pdf-lib';
import sharp from 'sharp';
import {fragmentReadingFixture,digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {renderPdfView} from '../src/utils/visual-pdf-renderer.ts';
const api=await import('../src/server/documents/visual-fragment-renderer.server.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const renderer=(...args)=>{assert.equal(typeof api.createSourceFragmentRenderer,'function','Missing original fragment renderer');return api.createSourceFragmentRenderer(...args);};

// Break caught: cropping in unrotated page coordinates or losing CropBox origin.
test('rotated_fragment_keeps_context',async()=>{
 for(const [angle,center] of [[0,[0.2,0.25]],[90,[0.75,0.2]],[180,[0.8,0.75]],[270,[0.25,0.8]]]){
  const pdf=await PDFDocument.create(),page=pdf.addPage([600,400]);page.setCropBox(50,50,500,300);page.setRotation(degrees(angle));
  page.drawRectangle({x:50,y:50,width:500,height:300,color:rgb(1,1,1)});page.drawRectangle({x:100,y:250,width:100,height:50,color:rgb(1,0,0)});
  page.drawText('BEFORE',{x:100,y:315,size:8});page.drawText('AFTER',{x:100,y:230,size:8});
  const width=angle%180?0.44:0.28,height=angle%180?0.28:0.44;
  const bytes=Buffer.from(await pdf.save()),before=digest(bytes),rect={x:center[0]-width/2,y:center[1]-height/2,width,height};
  const image=await renderPdfView(bytes,1,rect,{detail:'fragment'}),normal=await renderPdfView(bytes,1,rect);
  assert.ok(image.width>=normal.width*1.9,'Fragment detail must add physical pixels');assert.notEqual(image.id,normal.id);
  const {data,info}=await sharp(image.bytes).removeAlpha().raw().toBuffer({resolveWithObject:true}),offset=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels;
  assert.ok(data[offset]>240&&data[offset+1]<20&&data[offset+2]<20,'The enlarged center must be the original red target');
  const ink=[0,0];for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const at=(y*info.width+x)*info.channels,axis=angle%180?x/info.width:y/info.height;if(data[at]<80&&data[at+1]<80&&data[at+2]<80){if(axis<1/3)ink[0]++;if(axis>2/3)ink[1]++;}}
  assert.ok(ink[0]>5&&ink[1]>5,'Both physical context labels must remain visible');
  assert.ok(image.width*image.height<=16_000_000);assert.deepEqual(image.rect,rect);assert.equal(digest(bytes),before);
 }
});
test('raster_fragment_is_derived_from_the_owned_original_and_not_an_arbitrary_unit',async()=>{
 const f=await fragmentReadingFixture({kind:'IMAGE_FRAME'}),draw=renderer(f.bytes,'source.png',f.manifest),rect={x:0.1,y:0.2,width:0.6,height:0.3};
 const image=await draw(f.unit,rect);assert.ok(image);assert.deepEqual(image.rect,rect);assert.equal(image.sha256,digest(image.bytes));
 assert.ok(image.width>540);assert.ok(image.width*image.height<=16_000_000);
 assert.equal(await draw({...f.unit,id:'other'},rect),null);
 assert.equal(await draw(f.unit,{x:-0.1,y:0,width:1,height:0.2}),null);
 assert.equal(await draw(f.unit,{x:0,y:0,width:0,height:0.2}),null);
 assert.equal(await draw(f.unit,{x:NaN,y:0,width:0.5,height:0.2}),null);
 assert.equal(await draw({...f.unit,views:[{...f.unit.views[0],bytes:Buffer.from('different original')}]},rect),null);
});
test('changed_original_or_missing_pdf_attachment_does_not_yield_a_fragment',async()=>{
 const f=await fragmentReadingFixture(),draw=renderer(Buffer.from('changed original'),'source.pdf',f.manifest);
 assert.equal(await draw(f.unit,{x:0,y:0,width:1,height:0.2}),null);
 const msg={...f.manifest,sourceHash:digest(f.bytes),format:'MSG',units:[{...f.unit,locations:[{page:1,msgPartId:'3'.repeat(64)}]}]};
 assert.equal(await renderer(f.bytes,'source.msg',msg)(msg.units[0],{x:0,y:0,width:1,height:0.2}),null);
});
test('reopening_a_quantized_raster_region_keeps_the_exact_pixels_and_hash',async()=>{
 const f=await fragmentReadingFixture({kind:'IMAGE_FRAME'}),draw=renderer(f.bytes,'source.png',f.manifest),first=await draw(f.unit,{x:0.12345,y:0.23456,width:0.333333,height:0.45678});
 assert.ok(first);const second=await draw(f.unit,first.rect);assert.ok(second);assert.equal(second.sha256,first.sha256);assert.deepEqual(second.rect,first.rect);assert.deepEqual(second.bytes,first.bytes);
});
test('the_pdf_factory_renders_its_own_page_and_rejects_another_source',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([300,300]);page.drawRectangle({x:100,y:100,width:100,height:100,color:rgb(1,0,0)});
 const bytes=Buffer.from(await pdf.save()),f=await fragmentReadingFixture(),manifest={...f.manifest,sourceHash:digest(bytes)},draw=renderer(bytes,'source.pdf',manifest);
 const image=await draw(f.unit,{x:0.4,y:0.4,width:0.2,height:0.2});assert.ok(image);const {data}=await sharp(image.bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.ok(data[0]>240&&data[1]<20&&data[2]<20);
 assert.equal(await draw({...f.unit,locations:[{page:2}]},{x:0.4,y:0.4,width:0.2,height:0.2}),null);
});
