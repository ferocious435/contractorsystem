import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fragmentReadingFixture,sourceDocument,digest} from './codex-runtime/visual-reading-fixtures.mjs';
import {buildVisualSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {readingUnitInputHash} from '../src/server/ai/visual-reading-cache.server.ts';
import {planFragmentTargets} from '../src/utils/visual-fragment-contracts.ts';
import {composeFragmentReading,fragmentBaseHash} from '../src/server/ai/visual-fragment-proof.server.ts';
import {createSourceFragmentRenderer} from '../src/server/documents/visual-fragment-renderer.server.ts';
import {assembleDocumentReading} from '../src/utils/document-reading-history.ts';
const hook=registerHooks({resolve(s,c,n){if(s==='@/utils/supabase/server')return {url:'data:text/javascript,export const createClient=async()=>globalThis.__fragmentAccessDb;',shortCircuit:true};return n(s,c);}});
const fragmentRoute=await import('../src/app/api/documents/reading/fragment/route.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const readingRoute=await import('../src/app/api/documents/reading/route.ts');hook.deregister();
const fragmentView=await import('../src/components/documents/DocumentReadingFragments.tsx').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const {DocumentSourceView}=await import('../src/components/documents/DocumentSourceView.tsx');
const actions=await import('../src/components/documents/documentAiApi.ts');

async function fixture(disputes=1){
 const f=await fragmentReadingFixture({kind:'IMAGE_FRAME',disputes}),manifest=await buildVisualSourceManifest(f.bytes,'source.png'),unit=manifest.units[0],view=unit.views[0],base=f.base;
 Object.assign(base,{unitId:unit.id,inputHash:readingUnitInputHash(unit)});for(const proof of base.views){proof.viewId=view.id;proof.imageHash=view.sha256;for(const reading of [proof.reading,proof.confirmation]){reading.unitId=unit.id;reading.viewId=view.id;}}
 return {...f,manifest,unit,base};
}
async function composed(f,{value='כ570',limit=Infinity}={}){
 const render=createSourceFragmentRenderer(f.bytes,'source.png',f.manifest),targets=planFragmentTargets(f.unit,f.base).targets.slice(0,limit),proofs=[];
 for(const target of targets){const image=await render(f.unit,{x:0.02,y:0.1,width:0.96,height:0.7}),a=target.address,row=structuredClone(f.base.tables[a.table][a.row]);row[1]=value;
  const response={targetId:target.id,blocks:[...target.anchors.map(b=>({id:b.id,address:b.address,value:b.value})),{id:target.id,address:a,value:row}].sort((x,y)=>x.address.row-y.address.row).map(({id,value})=>({id,value})),uncertainties:[]};
  proofs.push({version:'visual-fragment-proof-v1',scope:f.scope,unitId:f.unit.id,inputHash:f.base.inputHash,baseEvidenceHash:fragmentBaseHash(f.base),target,rect:image.rect,image:{id:image.id,sha256:image.sha256,width:image.width,height:image.height,rect:image.rect},raw:[JSON.stringify(response),JSON.stringify(response)],readings:[response,structuredClone(response)],value:row,createdBy:{jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',profileRevision:1}});
 }
 return composeFragmentReading(f.unit,f.base,proofs,f.scope);
}
function document(f,unit){const reading=assembleDocumentReading(f.manifest,[unit],f.scope);reading.verification.createdBy=unit.createdBy;const row=sourceDocument({id:f.scope.documentId,project_id:f.scope.projectId,title:'source.png',content_hash:f.scope.sourceHash,extracted_text:reading.text,extracted_text_hash:reading.textHash,storage_bucket:'documents',storage_path:'owned/source.png',parsed_json:{source_reading:reading.verification,source_reading_units:[unit]}});return row;}
function database(row,f,{project=true,signedIn=true,bytes=f.bytes}={}){const counts={downloads:0,writes:0,model:0};return {counts,auth:{getUser:async()=>({data:{user:signedIn?{id:f.scope.ownerId}:null},error:null})},from(table){const filters={},q={select(){return q;},eq(k,v){filters[k]=v;return q;},async maybeSingle(){return {data:table==='projects'?project?{id:filters.id}:null:row.id===filters.id?structuredClone(row):null,error:null};},update(){counts.writes++;throw Error('Preview must not write');}};return q;},storage:{from(){return {async download(){counts.downloads++;return {data:new Blob([bytes]),error:null};}};}}};}
function request(f,row,extra={}){return new Request('http://localhost/api/documents/reading/fragment?'+new URLSearchParams({projectId:f.scope.projectId,documentId:f.scope.documentId,sourceHash:f.scope.sourceHash,textHash:row.extracted_text_hash,unitId:f.unit.id,targetId:'fragment:table:0:row:2',...extra}));}
const requireRoute=()=>assert.equal(typeof fragmentRoute.GET,'function','Protected source fragment endpoint is required');

test('fragment_route_rejects_foreign_scope_before_rendering',async()=>{
 requireRoute();const f=await fixture(),unit=await composed(f),row=document(f,unit);
 for(const options of [{project:false},{signedIn:false}]){const db=database(row,f,options);globalThis.__fragmentAccessDb=db;assert.equal((await fragmentRoute.GET(request(f,row))).status,options.signedIn===false?401:403);assert.deepEqual(db.counts,{downloads:0,writes:0,model:0});}
 const db=database({...row,project_id:'ffffffff-ffff-4fff-8fff-ffffffffffff'},f);globalThis.__fragmentAccessDb=db;assert.equal((await fragmentRoute.GET(request(f,row))).status,403);assert.equal(db.counts.downloads,0);
});
test('fragment_route_returns_exact_source_pixels_without_writes_or_ai',async()=>{
 requireRoute();const f=await fixture(),unit=await composed(f),row=document(f,unit),db=database(row,f);globalThis.__fragmentAccessDb=db;
 const response=await fragmentRoute.GET(request(f,row));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(digest(Buffer.from(await response.arrayBuffer())),unit.composition.proofs[0].image.sha256);assert.equal(db.counts.writes,0);assert.equal(db.counts.model,0);
});
test('fragment_route_rejects_changed_sources_missing_versions_and_damage',async()=>{
 requireRoute();const f=await fixture(),unit=await composed(f),row=document(f,unit);globalThis.__fragmentAccessDb=database(row,f);
 for(const [extra,status] of [[{sourceHash:'9'.repeat(64)},409],[{textHash:'9'.repeat(64)},404],[{targetId:'fragment:table:0:row:999'},404],[{rect:'0,0,1,1'},400],[{path:'../../private'},400],[{unitId:'../../private'},400]])assert.equal((await fragmentRoute.GET(request(f,row,extra))).status,status);
 const broken=structuredClone(row);broken.parsed_json.source_reading_units[0].composition.proofs[0].raw[0]='{}';globalThis.__fragmentAccessDb=database(broken,f);assert.equal((await fragmentRoute.GET(request(f,row))).status,422);
 const malformed=structuredClone(row);malformed.parsed_json.source_reading_units[0].composition.proofs='Damaged stored array';globalThis.__fragmentAccessDb=database(malformed,f);assert.equal((await fragmentRoute.GET(request(f,row))).status,422);
 globalThis.__fragmentAccessDb=database(row,f,{bytes:Buffer.from('Changed bytes')});assert.equal((await fragmentRoute.GET(request(f,row))).status,409);
});
test('a_known_pending_region_is_explicitly_unconfirmed_and_cannot_be_previewed',async()=>{
 requireRoute();const f=await fixture(5),unit=await composed(f,{limit:4}),row=document(f,unit),db=database(row,f);globalThis.__fragmentAccessDb=db;
 assert.equal((await fragmentRoute.GET(request(f,row,{targetId:'fragment:table:0:row:14'}))).status,422);assert.equal(db.counts.downloads,0);assert.equal(db.counts.writes,0);
});
test('historical_fragment_uses_historical_proof_and_keeps_the_current_reading',async()=>{
 requireRoute();const f=await fixture(),old=await composed(f),current=await composed(f,{value:'כ571'}),row=document(f,current),past=document(f,old),before=structuredClone(row);
 row.parsed_json.source_reading_history=[{sourceHash:past.content_hash,textHash:past.extracted_text_hash,text:past.extracted_text,reading:past.parsed_json.source_reading,units:[old]}];const db=database(row,f);globalThis.__fragmentAccessDb=db;
 const detail=await readingRoute.POST(new Request('http://localhost/api/documents/reading',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:f.scope.projectId,documentId:row.id,textHash:past.extracted_text_hash})}));const body=await detail.json();assert.equal(detail.status,200);assert.equal(body.current,false);assert.deepEqual(body.reading.units,[old]);
 assert.equal((await fragmentRoute.GET(request(f,past))).status,200);assert.deepEqual(row.parsed_json.source_reading_units,before.parsed_json.source_reading_units);assert.equal(db.counts.writes,0);assert.equal(db.counts.model,0);
});
test('fragment_ui_keeps_partial_reading_and_the_ordinary_continuation_visible',async()=>{
 assert.equal(typeof fragmentView.DocumentReadingFragments,'function');const f=await fixture(5),unit=await composed(f,{limit:4}),row=document(f,unit);row.parsed_json.source_reading.units=[unit];
 const html=renderToStaticMarkup(React.createElement(DocumentSourceView,{document:row,fullText:row.extracted_text,onCompleteReading:async()=>{}}));
 assert.match(html,/הקריאה לא הושלמה/u);assert.match(html,/השלמת קריאת המקור/u);assert.match(html,/4\s*\/\s*5/u);assert.match(html,/שורה 15/u);assert.match(html,/שתי הקריאות/u);assert.match(html,/0\s*\/\s*1/u);assert.ok(!html.includes('<script>'));
});
test('a_fragment_link_contains_only_the_saved_identity_and_no_coordinates',async()=>{
 assert.equal(typeof actions.documentFragmentUrl,'function');const f=await fixture(),row=document(f,await composed(f)),url=new URL(actions.documentFragmentUrl({projectId:f.scope.projectId,documentId:row.id,sourceHash:row.content_hash,textHash:row.extracted_text_hash,unitId:f.unit.id,targetId:'fragment:table:0:row:2'}),'http://localhost');
 assert.equal(url.pathname,'/api/documents/reading/fragment');assert.deepEqual([...url.searchParams.keys()].sort(),['documentId','projectId','sourceHash','targetId','textHash','unitId']);
});
