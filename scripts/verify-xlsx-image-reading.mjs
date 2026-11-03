import assert from 'node:assert/strict';import test from 'node:test';import sharp from 'sharp';
import {buildVisualSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {xlsxWithImages,xlsxRow} from './fixtures/xlsx-image-fixtures.mjs';
import {digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {assembleDocumentReading} from '../src/utils/document-reading-history.ts';
const image=()=>sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="white"/><text x="6" y="45" font-size="25">IMAGE ONLY 72</text></svg>')).png().toBuffer();
const sheet=(name='Measured quantities',picture={name:'source.png'})=>({name,rows:[xlsxRow(1,[['A1','Gate'],['C1','25']])],pictures:[picture]});
const mergedSheet=(rows,refs)=>`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData><mergeCells count="${refs.length}">${refs.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`;

test('valid merged cells retain their range and the physical columns of adjacent values',async()=>{
 const rows=[xlsxRow(1,[['A1','Merged heading'],['C1','25']]),xlsxRow(2,[['C2','72']])],bytes=xlsxWithImages([{name:'Merged grid',rows}],{},{'xl/worksheets/sheet1.xml':mergedSheet(rows,['A1:B2'])}),before=Buffer.from(bytes),m=await buildVisualSourceManifest(bytes,'merged.xlsx');
 assert.deepEqual(m.issues,[]);assert.match(m.nativeText,/# Merged cells:.*A1:B2/);assert.match(m.nativeText,/Merged heading\t\t25/);assert.match(m.nativeText,/(?:^|\n)\t\t72/);assert.deepEqual(bytes,before);
});

test('invalid or overlapping merges and values hidden inside a merge remain explicit gaps',async()=>{
 for(const [refs,cells]of [[['A1:B1','B1:C1'],[['A1','Title']]], [['B1:A1'],[['B1','Title']]], [['A1:B1'],[['A1','Title'],['B1','HIDDEN 99']]], [['A1:XFE1'],[['A1','Title']]]]){
  const rows=[xlsxRow(1,cells)],m=await buildVisualSourceManifest(xlsxWithImages([{name:'Invalid merge',rows}],{},{'xl/worksheets/sheet1.xml':mergedSheet(rows,refs)}),'invalid-merge.xlsx');assert.ok(m.issues.some(issue=>issue.includes('MERGE_UNVERIFIED')),JSON.stringify(refs));
 }
});

test('an empty picture cell coordinate is not silently invented as column A',async()=>{
 const normal=xlsxWithImages([sheet()],{'source.png':await image()}),{createRequire}=await import('node:module'),require=createRequire(import.meta.url),{unzipSync,zipSync,strFromU8,strToU8}=createRequire(require.resolve('officeparser'))('fflate'),files=unzipSync(normal);
 files['xl/drawings/drawing1.xml']=strToU8(strFromU8(files['xl/drawings/drawing1.xml']).replace('<xdr:col>0</xdr:col>','<xdr:col></xdr:col>'));
 const m=await buildVisualSourceManifest(Buffer.from(zipSync(files)),'empty-anchor.xlsx');assert.ok(m.issues.some(issue=>issue.endsWith('IMAGE_CELL_UNVERIFIED')));assert.equal(m.units[0].locations[0].cellRange,undefined);
});

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
const creationMetadata='<a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{00000000-0000-4000-8000-000000000001}"/></a:ext></a:extLst>';
const localDpiMetadata='<a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst>';
const withMetadata=(creation,dpi='')=>absolutePicture('rect').replace('<xdr:cNvPr id="1" name="Photo"/>','<xdr:cNvPr id="1" name="Photo">'+creation+'</xdr:cNvPr>').replace('<a:blip r:embed="rIdImage1"/>','<a:blip r:embed="rIdImage1">'+dpi+'</a:blip>');
test('normal Excel creation identifiers do not block reading the unchanged picture pixels',async()=>{
 const png=await image(),m=await buildVisualSourceManifest(xlsxWithImages([sheet()],{'source.png':png},{'xl/drawings/drawing1.xml':withMetadata(creationMetadata)}),'identifier.xlsx');assert.deepEqual(m.issues,[]);assert.equal(m.units.length,1);assert.equal(m.units[0].views[0].sha256,digest(png));
});
test('local DPI metadata preserves the original pixel reading without a false transform gap',async()=>{
 const png=await image(),m=await buildVisualSourceManifest(xlsxWithImages([sheet()],{'source.png':png},{'xl/drawings/drawing1.xml':withMetadata(creationMetadata,localDpiMetadata)}),'dpi.xlsx');assert.deepEqual(m.issues,[]);assert.equal(m.units.length,1);assert.equal(m.units[0].views[0].sha256,digest(png));
});
test('unknown metadata content cannot borrow the harmless creation-identifier allowance',async()=>{
 const unknown=creationMetadata.replace('a16:creationId','a16:unknownVisualEffect'),m=await buildVisualSourceManifest(xlsxWithImages([sheet()],{'source.png':await image()},{'xl/drawings/drawing1.xml':withMetadata(unknown)}),'unknown.xlsx');assert.ok(m.issues.length);assert.equal(m.units.length,0);
});
test('image text is assembled on a separate line rather than inside the last native cell',async()=>{
 const m=await buildVisualSourceManifest(xlsxWithImages([sheet()],{'source.png':await image()}),'source.xlsx'),unit=m.units[0],text='IMAGE ONLY 72',verified={unitId:unit.id,inputHash:'3'.repeat(64),textHash:digest(text),text,tables:[],visualDescription:'',uncertainties:[],complete:true,views:unit.views.map(view=>({viewId:view.id,imageHash:view.sha256,textHash:digest(text),method:'visual-double-pass',confirmationHash:digest(text)}))};
 const result=assembleDocumentReading(m,[verified]);assert.match(result.text,/Gate\t\t25\r?\n/,'The last native cell was merged with image text');assert.match(result.text,/(?:^|\r?\n)IMAGE ONLY 72(?:\r?\n|$)/);assert.ok(result.text.startsWith(m.nativeText));
});
test('pixel effects, tiling and fill cropping remain unverified instead of silently reading different visible content',async()=>{
 const normal=absolutePicture('rect'),variants=[normal.replace('<a:blip r:embed="rIdImage1"/>','<a:blip r:embed="rIdImage1"><a:lum bright="100000"/></a:blip>'),normal.replace('<a:stretch><a:fillRect/></a:stretch>','<a:tile tx="1000"/>'),normal.replace('<a:fillRect/>','<a:fillRect l="50000"/>')];
 for(const drawing of variants){const m=await buildVisualSourceManifest(xlsxWithImages([sheet()],{'source.png':await image()},{'xl/drawings/drawing1.xml':drawing}),'effect.xlsx');assert.ok(m.issues.length,'Unrendered picture effect must leave a reading gap');assert.equal(m.units.length,0);assert.match(m.nativeText,/Gate\t\t25/);}
});
