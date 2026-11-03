import assert from 'node:assert/strict';import test from 'node:test';import sharp from 'sharp';
import {buildVisualSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {xlsxWithImages,xlsxRow} from './fixtures/xlsx-image-fixtures.mjs';
import {digest} from './codex-runtime/visual-reading-fixtures.mjs';
const image=()=>sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="white"/><text x="6" y="45" font-size="25">IMAGE ONLY 72</text></svg>')).png().toBuffer();
const sheet=(name='Measured quantities',picture={name:'source.png'})=>({name,rows:[xlsxRow(1,[['A1','Gate'],['C1','25']])],pictures:[picture]});

test('XLSX image keeps every sheet binding and does not shift an empty cell',async()=>{
 const png=await image(),bytes=xlsxWithImages([sheet(),sheet('Agreed prices',{name:'source.png',from:{col:1,row:4},to:{col:3,row:6}})],{'source.png':png}),before=Buffer.from(bytes),m=await buildVisualSourceManifest(bytes,'source.xlsx');
 assert.equal(m.units.length,1,'The workbook picture must enter actual visual reading');assert.equal(m.format,'XLSX');assert.deepEqual(m.issues,[]);assert.equal(m.units[0].kind,'XLSX_IMAGE');
 assert.match(m.nativeText,/Measured quantities/);assert.match(m.nativeText,/Agreed prices/);assert.match(m.nativeText,/Gate\t\t25/);assert.doesNotMatch(m.nativeText,/IMAGE ONLY 72/);
 assert.deepEqual(m.units[0].locations.map(l=>[l.sheet,l.cellRange]),[['Measured quantities','A2:C4'],['Agreed prices','B5:D7']]);
 assert.equal(m.units[0].views[0].sha256,digest(png));assert.deepEqual(Buffer.from(m.units[0].views[0].bytes),png);assert.match(m.units[0].contextText,/Gate/);assert.doesNotMatch(m.units[0].contextText,/IMAGE ONLY 72/);assert.deepEqual(bytes,before);
});

test('external workbook picture is never fetched or accepted as complete',async()=>{
 const previous=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('No network is allowed for an external drawing');};
 try{const m=await buildVisualSourceManifest(xlsxWithImages([sheet('External',{external:true,target:'https://invalid.test/image.png'})]),'external.xlsx');assert.ok(m.issues.length>0);assert.equal(fetches,0);assert.match(m.nativeText,/Gate/);}finally{globalThis.fetch=previous;}
});

test('missing and corrupt image bytes leave a gap while keeping the worksheet data',async()=>{
 for(const media of [{},{'source.png':Buffer.from('broken image')}]){const m=await buildVisualSourceManifest(xlsxWithImages([sheet()],media),'missing.xlsx');assert.ok(m.issues.length>0);assert.match(m.nativeText,/Gate/);}
});

test('unhandled drawing object cannot be hidden by readable cells',async()=>{
 const m=await buildVisualSourceManifest(xlsxWithImages([{...sheet(),pictures:[],unknownGraphic:true}]),'drawing.xlsx');assert.ok(m.issues.length>0);assert.match(m.nativeText,/Gate/);
});

test('an internal relationship cannot escape its package',async()=>{
 const m=await buildVisualSourceManifest(xlsxWithImages([sheet('Invalid',{target:'../../../../outside.png'})]),'unsafe.xlsx');assert.ok(m.issues.length>0);assert.equal(m.units.length,0);
});

test('worksheet content after a long prefix is fully saved with its image',async()=>{
 const rows=Array.from({length:250},(_,i)=>xlsxRow(i+1,[[`A${i+1}`,'A long existing source row. '.repeat(40)],[`C${i+1}`,i===249?'LATE_CELL_VALUE':'25']]));
 const png=await image(),m=await buildVisualSourceManifest(xlsxWithImages([{...sheet('Long table'),rows}],{'source.png':png}),'long.xlsx');assert.equal(m.units.length,1);assert.match(m.nativeText,/LATE_CELL_VALUE/);assert.ok(m.nativeText.length>250000);
});

test('a cropped picture remains unverified instead of reading hidden pixels as its visible content',async()=>{
 const m=await buildVisualSourceManifest(xlsxWithImages([sheet('Cropped',{name:'source.png',crop:true})],{'source.png':await image()}),'cropped.xlsx');assert.ok(m.issues.length);assert.equal(m.units.length,0);assert.match(m.nativeText,/Gate\t\t25/);
});

test('unbound image and missing drawing relationship cannot produce a complete workbook',async()=>{
 for(const [sheets,extra]of [[[{name:'No binding',rows:[xlsxRow(1,[['A1','Gate']])]}],{}],[[sheet()],{'xl/worksheets/_rels/sheet1.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'}]]){
  const m=await buildVisualSourceManifest(xlsxWithImages(sheets,{'source.png':await image()},extra),'unbound.xlsx');assert.ok(m.issues.length);assert.equal(m.units.length,0);assert.match(m.nativeText,/Gate/);
 }
});

const absolutePicture=geometry=>`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="1000000" cy="1000000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Photo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`;
test('an absolute picture retains its true anchor without inventing a cell',async()=>{
 const m=await buildVisualSourceManifest(xlsxWithImages([sheet()],{'source.png':await image()},{'xl/drawings/drawing1.xml':absolutePicture('rect')}),'absolute.xlsx');assert.deepEqual(m.issues,[]);assert.equal(m.units.length,1);assert.equal(m.units[0].locations[0].cellRange,undefined);assert.equal(m.units[0].locations[0].sheet,'Measured quantities');assert.match(m.units[0].locations[0].anchor,/^xl\/worksheets\/sheet1.xml#/);
});
test('a nonrectangular picture mask is not silently certified as the whole original image',async()=>{
 const m=await buildVisualSourceManifest(xlsxWithImages([sheet()],{'source.png':await image()},{'xl/drawings/drawing1.xml':absolutePicture('ellipse')}),'masked.xlsx');assert.ok(m.issues.length,'Unsupported masks must leave an explicit gap');assert.equal(m.units.length,0);
});
