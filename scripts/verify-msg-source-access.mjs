import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import sharp from 'sharp';
import {msgFixture,nativeMsgFixture} from './fixtures/msg-fixtures.mjs';
import {digest,readingUnit,sourceDocument} from './codex-runtime/visual-reading-fixtures.mjs';
import {createMsgSourceExtractor} from '../src/server/documents/msg-source.server.ts';
import {readMsgContainer} from '../src/server/documents/msg-container.server.ts';
import {buildMsgSourceManifest} from '../src/utils/msg-source-manifest.ts';
import {buildVisualSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {assembleDocumentReading,resolveReadingVersion} from '../src/utils/document-reading-history.ts';
import {getDocumentContentType,getDocumentPreviewKind} from '../src/utils/document-storage.ts';
import {visualSourceLocationLabel} from '../src/utils/visual-source-location.ts';

const hook=registerHooks({resolve(specifier,context,next){
 if(specifier==='@/utils/supabase/server')return {url:'data:text/javascript,export const createClient=async()=>globalThis.__msgAccessDb;',shortCircuit:true};
 return next(specifier,context);
}});
const readingRoute=await import('../src/app/api/documents/reading/route.ts');
const attachmentRoute=await import('../src/app/api/documents/attachment/route.ts').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
hook.deregister();
const sourceView=await import('../src/components/documents/DocumentSourceView.tsx');
const msgView=await import('../src/components/documents/MsgSourceDetails.tsx').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const actions=await import('../src/components/documents/documentAiApi.ts');
const quote='Shared quotation: 12 m.';
const body='<script>window.bad=true</script>\nBody original.';
const pdf=Buffer.from('%PDF-1.7\nSynthetic attachment bytes\n%%EOF');
const png=await sharp({create:{width:12,height:12,channels:3,background:'blue'}}).png().toBuffer();
const file=msgFixture({body,attachments:[
 {name:'same.txt',mimeType:'text/plain',data:Buffer.from(quote)},
 {name:'same.txt',mimeType:'text/plain',data:Buffer.from(quote)},
 {name:'two.pdf',mimeType:'application/pdf',data:pdf},
 {name:'photo.png',mimeType:'image/png',data:png},
 {name:'active.html',mimeType:'text/html',data:Buffer.from('<script>alert(1)</script>')},
 {name:'nested.msg',embedded:{body:'Nested body'}}
]});
const extract=createMsgSourceExtractor({container:readMsgContainer,native:async()=>nativeMsgFixture({body,subject:'<img src=x onerror=bad()>'})});
const manifest=await buildMsgSourceManifest(file,'source.msg',{extract,buildPart:async(bytes,title)=>{
 if(title!=='two.pdf')return buildVisualSourceManifest(bytes,title);
 // The PDF reader boundary supplies two independently located pages; the attachment endpoint uses the actual container bytes.
 const units=[1,2].map(page=>readingUnit({id:'pdf:'+page,locations:[{page}]}));
 return {sourceHash:digest(bytes),manifestHash:'2'.repeat(64),format:'PDF',nativeText:'',nativeVerification:{},units,issues:[],assembly:units.map(u=>({kind:'unit',unitId:u.id}))};
}});
const verified=manifest.units.filter(u=>!u.locations.some(l=>l.page===2)).map(unit=>({unitId:unit.id,inputHash:'3'.repeat(64),text:'Page 1 literal',textHash:digest('Page 1 literal'),tables:[],visualDescription:'A blue source image.',uncertainties:[],complete:true,
 views:unit.views.map(view=>({viewId:view.id,imageHash:view.sha256,textHash:digest('Page 1 literal'),method:'native-match',confirmationHash:digest('Page 1 literal')}))}));
const assembled=assembleDocumentReading(manifest,verified);
assembled.verification.createdBy={jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rulesVersion:'visual-reading-rules-v2',profileRevision:1};
const doc=sourceDocument({title:'source.msg',storage_bucket:'documents',storage_path:'owned/source.msg',content_hash:digest(file),extracted_text:assembled.text,extracted_text_hash:assembled.textHash,
 parsed_json:{source_reading:assembled.verification,source_reading_units:assembled.units,source_reading_visual_descriptions:assembled.visualDescriptions}});
assembled.verification.msg.scope={ownerId:'fixture-owner',projectId:doc.project_id,documentId:doc.id,sourceHash:doc.content_hash};
const proof=assembled.verification.msg,part=(name,index=0)=>proof.parts.filter(p=>p.name===name)[index];

function database(document=doc,{signedIn=true,project=true,bytes=file}={}){
 return {auth:{getUser:async()=>({data:{user:signedIn?{id:'fixture-owner'}:null},error:null})},from(table){
  const filters={},q={select(){return q;},eq(k,v){filters[k]=v;return q;},async maybeSingle(){return {data:table==='projects'?project?{id:filters.id}:null:document.id===filters.id?structuredClone(document):null,error:null};}};return q;
 },storage:{from(bucket){assert.equal(bucket,'documents');return {async download(path){assert.equal(path,'owned/source.msg');return {data:new Blob([bytes]),error:null};}};}}};
}
function readingRequest(extra={}){return new Request('http://localhost/api/documents/reading',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:doc.project_id,documentId:doc.id,...extra})});}
function attachmentRequest(extra={}){return new Request('http://localhost/api/documents/attachment?'+new URLSearchParams({projectId:doc.project_id,documentId:doc.id,sourceHash:doc.content_hash,partId:part('two.pdf').id,...extra}));}
function requireAttachment(){assert.equal(typeof attachmentRoute.GET,'function','A protected MSG attachment endpoint is required');}

test('attachment_requires_owned_matching_source',async()=>{
 requireAttachment();globalThis.__msgAccessDb=database(doc,{project:false});assert.equal((await attachmentRoute.GET(attachmentRequest())).status,403);
 globalThis.__msgAccessDb=database({...doc,project_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});assert.equal((await attachmentRoute.GET(attachmentRequest())).status,403);
 globalThis.__msgAccessDb=database(doc,{signedIn:false});assert.equal((await attachmentRoute.GET(attachmentRequest())).status,401);
 globalThis.__msgAccessDb=database();assert.equal((await attachmentRoute.GET(attachmentRequest({sourceHash:'9'.repeat(64)}))).status,409);
 assert.equal((await attachmentRoute.GET(attachmentRequest({partId:'9'.repeat(64)}))).status,404);
 globalThis.__msgAccessDb=database(doc,{bytes:msgFixture({body:'Changed'})});assert.equal((await attachmentRoute.GET(attachmentRequest())).status,409);
});

test('attachment_returns_exact_payload_and_safe_actual_media_type',async()=>{
 requireAttachment();globalThis.__msgAccessDb=database();
 for(const [name,bytes,mime]of [['two.pdf',pdf,'application/pdf'],['photo.png',png,'image/png']]){
  const response=await attachmentRoute.GET(attachmentRequest({partId:part(name).id}));assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('content-type'),mime);
  assert.match(response.headers.get('content-disposition'),/^inline;/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 const active=await attachmentRoute.GET(attachmentRequest({partId:part('active.html').id}));assert.equal(active.status,200);
 assert.equal(active.headers.get('content-type'),'application/octet-stream');assert.match(active.headers.get('content-disposition'),/^attachment;/);
 assert.equal(await active.text(),'<script>alert(1)</script>');
 assert.equal((await attachmentRoute.GET(attachmentRequest({partId:part('nested.msg').id}))).status,422);
 for(const extra of [{path:'../../private'},{url:'https://example.invalid/'},{fileName:'forged.pdf'},{partId:'../../private'}])assert.equal((await attachmentRoute.GET(attachmentRequest(extra))).status,400);
});

test('ambiguous_part_quote_is_not_guessed',async()=>{
 assert.equal(resolveReadingVersion(doc,{textHash:doc.extracted_text_hash,quote}),null);
 const id=part('same.txt',1).id;assert.ok(resolveReadingVersion(doc,{partId:id,quote,textHash:doc.extracted_text_hash}));
 globalThis.__msgAccessDb=database();assert.equal((await readingRoute.POST(readingRequest({quote,textHash:doc.extracted_text_hash}))).status,404);
 const response=await readingRoute.POST(readingRequest({partId:id,quote,textHash:doc.extracted_text_hash})),detail=await response.json();
 assert.equal(response.status,200);assert.equal(detail.part.id,id);assert.ok(detail.part.text.includes(quote));assert.equal(detail.textHash,doc.extracted_text_hash);
 assert.equal((await readingRoute.POST(readingRequest({partId:part('two.pdf').id,page:2}))).status,200);
 assert.equal((await readingRoute.POST(readingRequest({partId:id,page:2}))).status,404);
});

test('historical_part_uses_its_own_text_and_proof',async()=>{
 const oldText=assembled.text.replace('Body original.','Body previous.'),oldReading=structuredClone(assembled.verification);oldReading.currentTextHash=digest(oldText);oldReading.msg.parts[0].headers.subject='Previous subject';
 const document=structuredClone(doc);document.parsed_json.source_reading_history=[{sourceHash:doc.content_hash,textHash:digest(oldText),text:oldText,reading:oldReading,visualDescriptions:[]}];
 globalThis.__msgAccessDb=database(document);
 const response=await readingRoute.POST(readingRequest({textHash:digest(oldText),partId:proof.rootPartId,quote:'Body previous.'})),detail=await response.json();
 assert.equal(response.status,200);assert.equal(detail.current,false);assert.match(detail.part.text,/Body previous\./);assert.equal(detail.part.text.includes('Shared quotation'),false);
 assert.equal(detail.reading.msg.parts[0].headers.subject,'Previous subject');assert.equal(detail.textHash,digest(oldText));
});

test('source_panel_shows_msg_parts_and_gaps_as_escaped_data',()=>{
 const html=renderToStaticMarkup(React.createElement(sourceView.DocumentSourceView,{document:doc,fullText:assembled.text,onSelectMsgPart:()=>{}}));
 assert.match(html,/data-msg-part=/);assert.match(html,/sender@example.invalid/);assert.match(html,/2024-10-01/);
 assert.match(html,/two\.pdf/);assert.match(html,/nested\.msg/);assert.match(html,/REQUIRES_REVIEW/);
 assert.match(html,/&lt;script&gt;/);assert.equal(html.includes('<script>'),false);assert.equal(html.includes('<img src=x onerror=bad()>'),false);
 assert.ok(html.indexOf(part('same.txt').id)<html.indexOf(part('two.pdf').id));
 assert.match(html,/\/api\/documents\/file\?/);assert.match(html,/\/api\/documents\/attachment\?/);
 assert.match(html,/הקריאה לא הושלמה/);
});

test('part_selection_passes_opaque_id_without_another_reading_job',()=>{
 assert.equal(typeof msgView.MsgSourceDetails,'function');let selected=null;
 const tree=msgView.MsgSourceDetails({projectId:doc.project_id,documentId:doc.id,sourceHash:doc.content_hash,proof,onSelectPart:id=>{selected=id;}});
 function find(node){if(!node||typeof node!=='object')return null;if(node.props?.['data-msg-select']===part('two.pdf').id)return node;return React.Children.toArray(node.props?.children).map(find).find(Boolean);}
 const button=find(tree);assert.ok(button);button.props.onClick();assert.equal(selected,part('two.pdf').id);
});

test('part_context_survives_client_access_and_parent_hash_stays_whole',async()=>{
 const previousFetch=globalThis.fetch;globalThis.__msgAccessDb=database();
 globalThis.fetch=async(url,options)=>readingRoute.POST(new Request(new URL(url,'http://localhost'),options));
 try{const detail=await actions.fetchDocumentReading(doc.project_id,doc.id,{partId:part('same.txt',1).id,quote});
  assert.equal(detail.part.id,part('same.txt',1).id);assert.equal(detail.text,assembled.text);assert.equal(detail.textHash,doc.extracted_text_hash);
 }finally{globalThis.fetch=previousFetch;}
});

test('msg_original_is_not_a_binary_text_preview_and_locations_name_the_attachment',()=>{
 assert.equal(getDocumentContentType(doc,file),'application/vnd.ms-outlook');assert.equal(getDocumentPreviewKind(doc,'text/plain'),'unsupported');
 assert.equal(visualSourceLocationLabel({msgPartName:'two.pdf',page:2}),'two.pdf · עמוד 2');
});

test('damaged_part_locations_do_not_crash_the_source_panel',()=>{
 const document=structuredClone(doc),missing=document.parsed_json.source_reading.expectedUnits.find(unit=>unit.locations.some(location=>location.page===2));delete missing.locations;
 let html;assert.doesNotThrow(()=>{html=renderToStaticMarkup(React.createElement(sourceView.DocumentSourceView,{document,fullText:assembled.text}));});
 assert.match(html,/הקריאה לא הושלמה/);
});

test('unsynchronized_body_is_described_as_a_version_gap_not_an_embedded_object',()=>{
 const document=structuredClone(doc);document.parsed_json.source_reading.msg.issues=['MSG_RTF_TEXT_SYNC_UNCONFIRMED'];document.parsed_json.source_reading.msg.parts[0].issues=['MSG_RTF_TEXT_SYNC_UNCONFIRMED'];
 const html=renderToStaticMarkup(React.createElement(sourceView.DocumentSourceView,{document,fullText:assembled.text}));
 assert.match(html,/גרסאות/);assert.doesNotMatch(html,/אובייקט מוטמע/);
});
