import test from 'node:test';import assert from 'node:assert/strict';
import {consultantDisplay} from '../src/utils/consultant-result.ts';
import {selectConsultantBoqRows} from '../src/utils/consultant-boq.ts';
import {createHash} from 'node:crypto';
const body='כתב כמויות לביצוע\nסעיף תיאור יחידה כמות מחיר סה"כ\nאספקת צינורות GRP בקוטר 450 מ"מ 57.91.0022\n200 100 2 מטר\n-- 3 of 3 --';
const row=selectConsultantBoqRows([{id:'original',project_id:'p',title:'מקור.pdf',extracted_text:body,ocr_status:'COMPLETED',content_hash:'a'.repeat(64),extracted_text_hash:'b'.repeat(64),parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:3,readPages:[1,2,3],unreadablePages:[]}}}],'אספקת צינורות GRP בקוטר 450 מ"מ',[])[0];
test('saved display carries the exact source rows without merging equal item codes from different originals',()=>{
 const rows=[row,{...row,documentId:'second',sourceHash:'c'.repeat(64)}];
 assert.deepEqual(consultantDisplay({displayVersion:'consultant-v2',response:'תשובה',boqRows:rows}).boqRows,rows);
});
test('BOQ table renders distinct sources with readable Hebrew, LTR prices, dates and page buttons',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {createElement}=await import('react');
 const {ConsultantBoqRows}=await import('../src/components/features/consultant/ConsultantBoqRows.tsx');
 const html=renderToStaticMarkup(createElement(ConsultantBoqRows,{projectId:'p',rows:[row,{...row,documentId:'second'}]}));
 assert.equal((html.match(/data-boq-source=/g)||[]).length,2);assert.ok(html.includes('עמוד 3'));assert.ok(html.includes('תאריך מהדורה'));assert.ok(html.includes('100.00'));assert.ok(html.includes('שיוך למקטע'));assert.ok(html.includes('dir="ltr"'));
});
test('only a proven replacement may render the current row as a new price',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {createElement}=await import('react');const {ConsultantBoqRows}=await import('../src/components/features/consultant/ConsultantBoqRows.tsx');
 const {consultantBoqRowKey}=await import('../src/utils/consultant-result.ts');
 const comparison={status:'UNKNOWN',originalRow:row,currentRow:{...row,documentId:'new',unitPrice:9876},chain:[],editionHistory:[],warnings:[],reason:'החלפה לא הוכחה',description:'מחיר השתנה'};
 for(const status of ['UNKNOWN','CONFLICT','REPLACED']){
  const html=renderToStaticMarkup(createElement(ConsultantBoqRows,{projectId:'p',rows:[row],comparisons:{[consultantBoqRowKey(row)]:{...comparison,status}}}));
  assert.equal(html.includes('9,876.00'),status==='REPLACED');assert.equal(html.includes('מהדורה מחליפה מאומתת'),status==='REPLACED');
 }
});
test('file hash guard checks downloaded bytes and preserves calls without sourceHash',async()=>{
 const {verifyDocumentSourceHash}=await import('../src/utils/document-source-hash.server.ts');
 const bytes=Buffer.from('original PDF bytes'),hash=createHash('sha256').update(bytes).digest('hex');
 assert.equal(verifyDocumentSourceHash(bytes,null),true);assert.equal(verifyDocumentSourceHash(bytes,hash),true);
 assert.equal(verifyDocumentSourceHash(Buffer.from('changed bytes'),hash),false);assert.equal(verifyDocumentSourceHash(bytes,'bad'),false);
});
test('file route rejects changed downloaded bytes despite unchanged metadata and still enforces project ownership',async()=>{
 const {registerHooks}=await import('node:module');
 const mockUrl='data:text/javascript,'+encodeURIComponent(`
  export const state={project:'p',bytes:'original',downloads:0,allow:true};
  export async function createClient(){return {};}
  export async function requireOwnedProject(){return state.allow?{ok:true}:{ok:false,response:Response.json({error:'Forbidden'},{status:403})};}
  export async function requireOwnedDocument(){return {ok:true,document:{id:'doc',project_id:state.project,title:'source.pdf',content_hash:'unchanged-metadata'}};}
  export async function downloadDocumentBuffer(){state.downloads++;return Buffer.from(state.bytes);}
  export function getDocumentContentType(){return 'application/pdf';}export function getDocumentFileName(){return 'source.pdf';}
 `);
 const hook=registerHooks({resolve(specifier,context,next){if(['@/app/api/_utils/auth','@/utils/document-storage','@/utils/supabase/server'].includes(specifier))return {url:mockUrl,shortCircuit:true};return next(specifier,context);}});
 let GET,state;try{({GET}=await import('../src/app/api/documents/file/route.ts'));({state}=await import(mockUrl));}finally{hook.deregister();}
 const hash=createHash('sha256').update('original').digest('hex');const request=(extra='')=>new Request(`http://fixture/api/documents/file?projectId=p&documentId=doc${extra}`);
 let response=await GET(request(`&sourceHash=${hash}`));assert.equal(response.status,200);assert.equal(await response.text(),'original');assert.ok(response.headers.get('cache-control').includes('no-store'));
 state.bytes='replacement';response=await GET(request(`&sourceHash=${hash}`));assert.equal(response.status,409);assert.equal((await response.json()).code,'SOURCE_CHANGED');
 response=await GET(request());assert.equal(response.status,200);assert.equal(await response.text(),'replacement');
 const before=state.downloads;state.project='other';assert.equal((await GET(request())).status,403);assert.equal(state.downloads,before);
 state.project='p';state.allow=false;assert.equal((await GET(request())).status,403);assert.equal(state.downloads,before);
 assert.equal((await GET(request('&sourceHash=bad'))).status,400);assert.equal((await GET(request(`&sourceHash=${hash}&sourceHash=${hash}`))).status,400);
});
test('comparison fetch and PDF read pass cancellation, preserve source hashes and reject mismatched source identities',async()=>{
 const {readBoqComparisons,readBoqPdf,boqSourceUrl}=await import('../src/components/features/consultant/boqSources.ts');
 const {consultantBoqRowKey}=await import('../src/utils/consultant-result.ts');const fetchBefore=globalThis.fetch;
 const controller=new AbortController();const calls=[];
 try{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({success:true,availability:'UNAVAILABLE',jobs:[{jobId:'job',rows:[{rowKey:consultantBoqRowKey(row),originalRow:row,comparison:null}]}]});};
  const result=await readBoqComparisons('p','conversation',controller.signal);assert.equal(result.available,false);assert.deepEqual(result.jobs.job,{[consultantBoqRowKey(row)]:null});assert.equal(calls[0].options.signal,controller.signal);
  globalThis.fetch=async()=>Response.json({success:true,availability:'AVAILABLE',jobs:[{jobId:'job',rows:[{rowKey:consultantBoqRowKey(row),originalRow:row,comparison:{status:'REPLACED',originalRow:{...row,documentId:'wrong'},currentRow:row,description:'bad',reason:null,warnings:[],editionHistory:[]}}]}]});
  assert.equal((await readBoqComparisons('p','conversation',controller.signal)).jobs.job[consultantBoqRowKey(row)],null);
  assert.ok(boqSourceUrl('p',row).includes('sourceHash='+row.sourceHash));assert.equal(boqSourceUrl('p',{...row,sourceHash:null}),null);
  globalThis.fetch=async(url,options)=>{assert.equal(options.signal,controller.signal);return new Response('changed',{status:409});};
  await assert.rejects(readBoqPdf('p',row,controller.signal));
  globalThis.fetch=async(_url,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
  const pending=readBoqComparisons('p','conversation',controller.signal);controller.abort();await assert.rejects(pending,{name:'AbortError'});
 }finally{globalThis.fetch=fetchBefore;}
});
test('restoring a succeeded conversation retains job provenance and optional rows while legacy answers stay readable',async()=>{
 const {savedConversation}=await import('../src/components/features/consultant/savedConversation.ts');
 const job={id:'job',projectId:'p',kind:'consultant',state:'SUCCEEDED',conversationId:'conversation',clientContextId:'conversation',result:{question:'שאלה',response:'תשובה',displayVersion:'consultant-v2',answeredAt:'2026-11-18T10:00:00Z',boqRows:[row]}};
 const shown=savedConversation([job],'p','conversation');assert.equal(shown[1].jobId,'job');assert.deepEqual(shown[1].boqRows,[row]);assert.equal(shown[1].content,'תשובה');
 const legacy=structuredClone(job);delete legacy.result.boqRows;assert.equal(savedConversation([legacy],'p','conversation')[1].content,'תשובה');assert.equal(savedConversation([legacy],'p','conversation')[1].boqRows,undefined);
});
test('browser fixture serves four source rows, two distinct four-page PDFs, missing and changed-byte fallback without SQL',async()=>{
 const {createBoqBrowserFixture}=await import('./codex-runtime/boq-browser-fixture.mjs');const {PDFDocument}=await import('pdf-lib');const fixture=await createBoqBrowserFixture();
 const url=path=>new URL(path,'http://fixture');const get=path=>fixture(url(path),new Request(url(path)));
 const payload=await (await get('/api/ai/jobs?kind=consultant&projectId=20000000-0000-4000-8000-000000000001')).json();
 const rows=payload.jobs[0].result.boqRows;assert.equal(rows.length,4);assert.equal(new Set(rows.map(row=>row.itemCode)).size,2);assert.equal(new Set(rows.map(row=>row.documentId)).size,2);
 const original=rows[0],second=rows[2];const file=row=>`/api/documents/file?projectId=20000000-0000-4000-8000-000000000001&documentId=${row.documentId}&sourceHash=${row.sourceHash}`;
 const pdfA=await (await get(file(original))).arrayBuffer(),pdfB=await (await get(file(second))).arrayBuffer();assert.notDeepEqual(pdfA,pdfB);assert.equal((await PDFDocument.load(pdfA)).getPageCount(),4);assert.equal((await PDFDocument.load(pdfB)).getPageCount(),4);
 const configure=body=>fixture(url('/fixture/boq-config'),new Request(url('/fixture/boq-config'),{method:'POST',body:JSON.stringify(body)}));
 await configure({missingOld:true});assert.equal((await get(file(original))).status,404);
 await configure({tamperedOld:true});assert.equal((await get(file(original))).status,409);assert.equal((await get(file(second))).status,200);
});
if(process.env.CONSULTANT_BOQ_FIXTURES){
 test('real four rows render as two item groups from two originals without mutating split OCR quotes or summing prices',async()=>{
  const {readFile}=await import('node:fs/promises');const {join}=await import('node:path');const {renderToStaticMarkup}=await import('react-dom/server');const {createElement}=await import('react');const {ConsultantBoqRows}=await import('../src/components/features/consultant/ConsultantBoqRows.tsx');
  const documents=JSON.parse(await readFile(join(process.env.CONSULTANT_BOQ_FIXTURES,'project-documents.json'),'utf8')),request=JSON.parse(await readFile(join(process.env.CONSULTANT_BOQ_FIXTURES,'request.json'),'utf8'));
  const rows=selectConsultantBoqRows(documents,request.question,[]),before=structuredClone(rows);assert.equal(rows.length,4);
  const html=renderToStaticMarkup(createElement(ConsultantBoqRows,{projectId:'p',rows}));assert.equal((html.match(/data-boq-source=/g)||[]).length,4);assert.equal((html.match(/מקורות לסעיף/g)||[]).length,2);assert.deepEqual(rows,before);
  for(const row of rows){assert.ok(html.includes(new Intl.NumberFormat('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(row.unitPrice)));assert.equal(documents.find(document=>document.id===row.documentId).extracted_text.slice(row.start,row.end),row.quote);}
 });
}
test('a saved legacy answer opens concisely while every quote, limitation and financial figure remains accessible',()=>{
 const value={sourceIds:['S1'],response:'המצב תועד בעבר; יש לברר את האישור העדכני.\n\nמקורות שמורים:\n[S1] מקור ונתון מדויק\n\nמה לא אומת:\nמסמך אחר — קריאה חסרה\n\nנתונים כספיים שמורים — כלל הפרויקט:\n100.00 ₪\n\nצעדים מוצעים:\nלבקש תשובה בכתב.'},original=structuredClone(value),shown=consultantDisplay(value);
 assert.ok(shown.content.includes('האישור העדכני'));assert.ok(shown.content.includes('לבקש תשובה בכתב'));assert.ok(!shown.content.includes('100.00'));for(const fact of ['מקור ונתון מדויק','קריאה חסרה','100.00 ₪'])assert.ok(shown.details.includes(fact));assert.deepEqual(value,original);
});
test('structured replies and untagged text never interpret a user heading as a removable appendix',()=>{
 for(const value of [{displayVersion:'consultant-v2',response:'שאלה\n\nמקורות שמורים:\nניסוח מכוון',details:'מקור מלא'},{response:'שאלה\n\nמקורות שמורים:\nניסוח מכוון'}])assert.equal(consultantDisplay(value).content,value.response);
});

test('legacy or malformed optional BOQ data does not prevent the saved answer from opening',async()=>{
 const {savedConsultantBoqRows}=await import('../src/utils/consultant-result.ts');
 for(const appendix of [undefined,null,'broken',[null,{}, {documentId:'x',quote:'fake',unitPrice:NaN}]]){
  const value={displayVersion:'consultant-v2',response:'תשובה שמורה מדויקת',details:'מקורות שמורים',boqRows:appendix};
  assert.deepEqual(savedConsultantBoqRows(value),[]);assert.equal(consultantDisplay(value).content,value.response);
 }
});
