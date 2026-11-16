import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const m=()=>import('../src/server/documents/cad-source.server.ts');
const inv=(extra={})=>({layouts:['Layout1','Model'],layoutBlocks:[{name:'*Model_Space',count:1,handle:'1'},{name:'*Paper_Space',count:0,handle:'2'}],types:{Line:1},xrefs:[],geometry:[{block:'*Model_Space',handle:'A',layer:'0',kind:'Line',start:[1000000,2000000,0],end:[1000100,2000000,0]}],fileRequestsDenied:[],entityCount:1,status:'INVENTORIED',...extra});
test('same named sheets from different files have distinct addresses',async()=>{
 const {buildCadResult}=await m(),a=await buildCadResult(hash('a'),inv()),b=await buildCadResult(hash('b'),inv());
 assert.notEqual(a.sheets[0].id,b.sheets[0].id);
});
test('far line renders without cropping and empty sheet stays unverified',async()=>{
 const {buildCadResult}=await m(),r=await buildCadResult(hash('a'),inv());
 assert.ok(r.sheets.find(s=>s.name==='Model').image?.length>0);
 assert.equal(r.sheets.find(s=>s.name==='Layout1').image,null);
 assert.ok(r.sheets.find(s=>s.name==='Layout1').issues.includes('CAD_SHEET_VISIBILITY_UNCONFIRMED'));
});
test('unresolved external reference remains a blocking issue',async()=>{
 const {buildCadResult}=await m(),r=await buildCadResult(hash('a'),inv({xrefs:[{name:'missing',path:'missing.dwg',overlay:false}]}));
 assert.equal(r.status,'REQUIRES_REVIEW');assert.ok(r.issues.some(x=>x.includes('CAD_XREF_UNRESOLVED:missing')));
});
test('unsupported objects cannot become complete',async()=>{
 const {buildCadResult}=await m(),r=await buildCadResult(hash('a'),inv({types:{Line:1,ProxyEntity:1}}));
 assert.ok(r.issues.includes('CAD_UNSUPPORTED_ENTITY:ProxyEntity'));assert.equal(r.status,'REQUIRES_REVIEW');
});
test('generated_model_preview_never_replaces_sheet_completeness_or_issues',async()=>{
 const {buildCadResult,attachCadModelPreview}=await m(),r=await buildCadResult(hash('a'),inv());
 const next=attachCadModelPreview(r,Buffer.from('preview'),['CAD_TEXT_STYLE_UNCONFIRMED']);
 assert.equal(next.status,'REQUIRES_REVIEW');assert.equal(next.sheets.find(s=>s.name==='Layout1').image,null);
 assert.ok(next.sheets.find(s=>s.name==='Model').issues.includes('CAD_TEXT_STYLE_UNCONFIRMED'));assert.ok(next.issues.includes('CAD_TEXT_STYLE_UNCONFIRMED'));
});
