import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { docx, paragraph, image } from './fixtures/docx-image-fixtures.mjs';

const require=createRequire(import.meta.url);
const nextUrl=pathToFileURL(require.resolve('next/server')).href;
const clientUrl='data:text/javascript,'+encodeURIComponent('let client; export const setClient=x=>{client=x}; export const createClient=async()=>client;');
const syncUrl='data:text/javascript,'+encodeURIComponent('export const syncProjectContractBase=async(_client,projectId)=>{if(projectId!=="p")throw Error("wrong project")};');
const {setClient}=await import(clientUrl);
const hook=registerHooks({resolve(s,c,n){
 if(s==='@/utils/supabase/server')return {url:clientUrl,shortCircuit:true};
 if(s==='@/utils/project-contract-base-server')return {url:syncUrl,shortCircuit:true};
 if(s==='next/server')return n(nextUrl,c);
 return n(s.startsWith('@/')?new URL(`../src/${s.slice(2)}.ts`,import.meta.url).href:s,c);
}});
const {POST}=await import('../src/app/api/documents/extract-text/route.ts');
const {prepareDocumentAnalysisInput}=await import('../src/utils/document-text-extraction.ts');
hook.deregister();
const {NextRequest}=require('next/server');
function database(bytes,patch={}){
 const row={id:'d',project_id:'p',title:'fixture.docx',storage_bucket:'documents',storage_path:'p/fixture.docx',
  extracted_text:'Legacy native text only.',ocr_status:'COMPLETED',parsed_json:{owner_note:'keep'},...patch};
 const calls={downloads:0,updates:0};
 const db={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},storage:{from(bucket){assert.equal(bucket,'documents');return {download:async name=>{assert.equal(name,'p/fixture.docx');calls.downloads++;return {data:new Blob([bytes]),error:null};}};}},from(table){
  assert.ok(['projects','documents'].includes(table));let update;
  const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:table==='projects'?{id:'p'}:structuredClone(row),error:null};},
   update(value){assert.equal(table,'documents');update=value;return q;},then(resolve,reject){assert.ok(update);calls.updates++;Object.assign(row,update);return Promise.resolve({error:null}).then(resolve,reject);}};return q;
 }};
 return {db,row,calls};
}
const request=()=>new NextRequest('http://localhost/api/documents/extract-text',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:'p',documentId:'d'})});

test('the real extraction route replaces an unverified legacy DOCX read with source coverage',async()=>{
 const state=database(docx({body:paragraph('Complete native instruction.'),media:{},rels:[]}));setClient(state.db);
 const response=await POST(request());assert.equal(response.status,200);assert.equal((await response.json()).alreadyExtracted,undefined);
 assert.equal(state.calls.downloads,1);assert.equal(state.calls.updates,1);
 assert.equal(state.row.parsed_json.owner_note,'keep');assert.equal(state.row.parsed_json.source_reading.expectedImageReferences,0);
 assert.equal(state.row.extracted_text,'Complete native instruction.');assert.equal(state.row.ocr_status,'COMPLETED');
});
test('the real route reuses complete unchanged DOCX coverage without downloading or OCR',async()=>{
 const bytes=docx({media:{},rels:[]});const prepared=await prepareDocumentAnalysisInput(bytes,'fixture.docx');
 const state=database(bytes,{extracted_text:prepared.extractedText,content_hash:createHash('sha256').update(bytes).digest('hex'),parsed_json:{source_reading:prepared.readingVerification}});setClient(state.db);
 const response=await POST(request());assert.equal((await response.json()).alreadyExtracted,true);
 assert.deepEqual(state.calls,{downloads:0,updates:0});
});
test('the real route preserves image text and numeric review metadata in the saved document',async()=>{
 const {default:sharp}=await import('sharp');
 const png=await sharp(Buffer.from('<svg width="1500" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="80" y="200" font-family="Arial" font-size="120">TOTAL 1234.50 ILS</text></svg>')).png().toBuffer();
 const state=database(docx({body:paragraph('Native terms')+image(),media:{'image1.png':png}}));setClient(state.db);
 const response=await POST(request());assert.equal(response.status,200);
 assert.match(state.row.extracted_text,/1234/);assert.equal(state.row.ocr_status,'REQUIRES_REVIEW');
 assert.equal(state.row.parsed_json.source_reading.images[0].numericReviewRequired,true);
 assert.equal(state.row.parsed_json.source_reading.complete,false);assert.equal(state.row.parsed_json.owner_note,'keep');
});
