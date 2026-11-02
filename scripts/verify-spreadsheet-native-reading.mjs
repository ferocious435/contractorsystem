import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{zipSync,strToU8}=createRequire(require.resolve('officeparser'))('fflate');
const {prepareDocumentAnalysisInput}=await import('../src/utils/document-text-extraction.ts');
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escaped=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const row=(n,cells)=>'<row r="'+n+'">'+cells.map(([ref,value])=>'<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+escaped(value)+'</t></is></c>').join('')+'</row>';
function workbook(sheets,parts={}){const files={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets>'+sheets.map((s,i)=>'<sheet name="'+escaped(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>',
 ...Object.fromEntries(sheets.map((s,i)=>['xl/worksheets/sheet'+(i+1)+'.xml','<worksheet xmlns="'+ns+'"><sheetData>'+s.rows.join('')+'</sheetData></worksheet>'])),...parts
 };return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,typeof value==='string'?strToU8(value):value]))));}
function records(text){const rows=[];let cells=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch==='\t'&&!quoted){cells.push(cell);cell='';}else if(ch==='\n'&&!quoted){cells.push(cell.replace(/\r$/,''));rows.push(cells);cells=[];cell='';}else cell+=ch;}if(cell||cells.length){cells.push(cell);rows.push(cells);}assert.equal(quoted,false);return rows.filter(r=>r.some(v=>v!=='')&&!r[0].startsWith('#'));}
test('native spreadsheet reading preserves empty quantity and price columns',async()=>{
 const bytes=workbook([{name:'Quantities',rows:[row(1,[['A1','Item'],['B1','Quantity'],['C1','Unit price'],['D1','Total']]),row(2,[['A2','Gate'],['C2','1,234.50'],['D2','1.234,50']]),row(3,[['A3','Pipe'],['B3','2'],['D3','50']])]}]),before=Buffer.from(bytes);
 const result=await prepareDocumentAnalysisInput(bytes,'synthetic.xlsx');assert.equal(result.kind,'text');
 assert.deepEqual(records(result.extractedText),[['Item','Quantity','Unit price','Total'],['Gate','','1,234.50','1.234,50'],['Pipe','2','','50']]);assert.ok(!result.requiresReview);assert.deepEqual(bytes,before);
});
test('native spreadsheet reading keeps the names and rows of every worksheet',async()=>{
 const result=await prepareDocumentAnalysisInput(workbook([{name:'Measured quantities',rows:[row(1,[['A1','Gate'],['C1','4']])]},{name:'Agreed prices',rows:[row(1,[['A1','Gate'],['C1','25']])]}]),'synthetic.xlsx');
 assert.match(result.extractedText,/Measured quantities/);assert.match(result.extractedText,/Agreed prices/);assert.deepEqual(records(result.extractedText),[['Gate','','4'],['Gate','','25']]);
});
test('a single worksheet retains its draft qualifier in the saved source text',async()=>{
 const result=await prepareDocumentAnalysisInput(workbook([{name:'DRAFT - review only',rows:[row(1,[['A1','Gate'],['C1','25']])]}]),'synthetic.xlsx');
 assert.match(result.extractedText,/DRAFT - review only/);assert.deepEqual(records(result.extractedText),[['Gate','','25']]);
});
test('the complete spreadsheet remains saved when only the model context is shortened',async()=>{
 const rows=Array.from({length:1800},(_,i)=>row(i+1,[['A'+(i+1),'Line '+i+' '+('source detail '.repeat(12))],['C'+(i+1),i===1799?'FINAL_SOURCE_ROW':'value '+i]]));
 const result=await prepareDocumentAnalysisInput(workbook([{name:'Long source',rows}]),'synthetic.xlsx');
 assert.ok(result.extractedText.includes('FINAL_SOURCE_ROW'));assert.ok(!result.aiText.includes('FINAL_SOURCE_ROW'));assert.equal(result.wasTruncated,true);assert.equal(records(result.extractedText).length,1800);
 assert.equal(records(result.extractedText)[1799][1],'');assert.equal(records(result.extractedText)[1799][2],'FINAL_SOURCE_ROW');
});
test('a spreadsheet with a column outside the file-format bounds stays unverified',async()=>{
 const result=await prepareDocumentAnalysisInput(workbook([{name:'Unverified layout',rows:[row(1,[['XFE1','Unverified far-column value']])]}]),'synthetic.xlsx');
 assert.equal(result.requiresReview,true);assert.ok(result.extractedText.includes('Unverified far-column value'));
});
test('spreadsheet drawings are not certified by a text-only cell export',async()=>{
 const result=await prepareDocumentAnalysisInput(workbook([{name:'Cells and drawing',rows:[row(1,[['A1','See the attached diagram']])]}],{'xl/drawings/drawing1.xml':'<drawing xmlns="urn:synthetic">Unread drawing</drawing>'}),'synthetic.xlsx');
 assert.equal(result.requiresReview,true);assert.ok(result.extractedText.includes('See the attached diagram'));
});
