import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBoqBrowserFixture} from './codex-runtime/boq-browser-fixture.mjs';
import {renderPdfView} from '../src/utils/visual-pdf-renderer.ts';
import {readBoqPdf,boqSourceUrl} from '../src/components/features/consultant/boqSources.ts';

test('guarded source page uses the original PDF renderer for the selected A/B page and keeps raw PDF available',async()=>{
 const fixture=await createBoqBrowserFixture(),url=path=>new URL(path,'http://fixture');
 const get=path=>fixture(url(path),new Request(url(path)));
 const rows=(await (await get('/api/ai/jobs?kind=consultant&projectId=20000000-0000-4000-8000-000000000001')).json()).jobs[0].result.boqRows;
 const seen=new Set();
 for(const row of rows){
  const rawUrl=boqSourceUrl('20000000-0000-4000-8000-000000000001',row),raw=await get(rawUrl),bytes=Buffer.from(await raw.arrayBuffer());assert.equal(raw.headers.get('content-type'),'application/pdf');
  const response=await get(rawUrl+'&renderPage='+row.page);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  const image=Buffer.from(await response.arrayBuffer()),expected=await renderPdfView(bytes,row.page,undefined);
  assert.deepEqual(image,Buffer.from(expected.bytes));assert.ok(expected.width>1000);assert.ok(expected.height>1500);seen.add(createHash('sha256').update(image).digest('hex'));
 }
 assert.equal(seen.size,4,'A3/A4/B3/B4 must be four distinct rendered original pages');
 const source=boqSourceUrl('20000000-0000-4000-8000-000000000001',rows[0]);
 for(const page of ['0','-1','1.5','abc','3&renderPage=4'])assert.equal((await get(source+'&renderPage='+page)).status,400);
 assert.equal((await get(source+'&renderPage=99')).status,422);
 await fixture(url('/fixture/boq-config'),new Request(url('/fixture/boq-config'),{method:'POST',body:JSON.stringify({tamperedOld:true})}));
 assert.equal((await get(source+'&renderPage=3')).status,409);
});

test('page API returns a PNG to the client, validates errors for quote fallback and passes cancellation',async()=>{
 const before=globalThis.fetch,controller=new AbortController();
 const row={documentId:'original',sourceHash:'a'.repeat(64),page:3};
 try{
  globalThis.fetch=async(url,options)=>{assert.ok(url.includes('renderPage=3'));assert.equal(options.signal,controller.signal);return new Response('png',{headers:{'Content-Type':'image/png'}});};
  assert.equal((await readBoqPdf('p',row,controller.signal)).type,'image/png');
  for(const response of [new Response('bad',{status:409}),new Response('bad',{status:422}),new Response('not image',{headers:{'Content-Type':'application/pdf'}})]){
   globalThis.fetch=async()=>response;await assert.rejects(readBoqPdf('p',row,controller.signal));
  }
  globalThis.fetch=async(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  const pending=readBoqPdf('p',row,controller.signal);controller.abort();await assert.rejects(pending,{name:'AbortError'});
 }finally{globalThis.fetch=before;}
});

test('the page renderer fails closed before rendering when bytes differ or the context was cancelled',async()=>{
 const {documentPdfPageResponse}=await import('../src/utils/document-pdf-page.server.ts');
 const notPdf=Buffer.from('replacement bytes'),sourceHash=createHash('sha256').update('original').digest('hex');
 assert.equal((await documentPdfPageResponse(notPdf,sourceHash,3)).status,409,'invalid PDF bytes must not reach rendering before hash failure');
 const controller=new AbortController();controller.abort();
 await assert.rejects(documentPdfPageResponse(notPdf,createHash('sha256').update(notPdf).digest('hex'),3,controller.signal),{name:'AbortError'});
});

test('source image is readable in the dialog without a PDF plugin and exposes zoom and scroll controls',async()=>{
 const {ConsultantSourcePage}=await import('../src/components/features/consultant/ConsultantBoqRows.tsx');const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const html=renderToStaticMarkup(createElement(ConsultantSourcePage,{url:'blob:verified-page',title:'Original A — page 3',onError:()=>{}}));
 assert.ok(html.includes('<img'));assert.ok(!html.includes('<iframe'));assert.ok(html.includes('blob:verified-page'));assert.ok(html.includes('Original A'));assert.ok(html.includes('הגדלה'));assert.ok(html.includes('התאמה לרוחב'));assert.ok(html.includes('overflow: auto')||html.includes('overflow:auto'));
});
