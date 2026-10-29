import './redesign/load-ui.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
import {jsPDF} from 'jspdf';import {HEBREW_FONT_BASE64} from '../src/lib/fonts.ts';
const readiness=await import('../src/hooks/useAiReadiness.ts');
const writing=await import('../src/utils/local-writing-request.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ready={available:true,provider:'Local AI · qwen3:4b',reason:null};
test('readiness distinguishes stopped, missing, bad status and never invents a different provider',async()=>{
 assert.equal(typeof readiness.fetchAiReadiness,'function');
 for(const reason of ['AI_UNAVAILABLE','AI_MODEL_MISSING'])assert.deepEqual(await readiness.fetchAiReadiness(async()=>Response.json({...ready,available:false,reason})),{...ready,available:false,reason});
 for(const fetcher of [async()=>{throw Error('offline');},async()=>new Response('broken',{status:503}),async()=>Response.json({available:true,provider:'Gemini',reason:null})]){
  const status=await readiness.fetchAiReadiness(fetcher);assert.equal(status.available,false);assert.equal(status.reason,'STATUS_UNAVAILABLE');assert.doesNotMatch(status.provider,/Gemini/i);
 }
});
test('load, focus and explicit failure refresh readiness without a timer or stale replacement',async()=>{
 assert.equal(typeof readiness.observeAiReadiness,'function');const target=new EventTarget(),statuses=[],pending=[];
 const stop=readiness.observeAiReadiness(value=>statuses.push(value),{target,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});assert.equal(pending.length,1);
 target.dispatchEvent(new Event('focus'));assert.equal(pending.length,2);pending[1](Response.json(ready));await tick();pending[0](Response.json({...ready,available:false,reason:'AI_UNAVAILABLE'}));await tick();assert.equal(statuses.at(-1).available,true);
 readiness.refreshAiReadiness(target);assert.equal(pending.length,3);pending[2](Response.json({...ready,available:false,reason:'AI_MODEL_MISSING'}));await tick();assert.equal(statuses.at(-1).reason,'AI_MODEL_MISSING');
 await tick();assert.equal(pending.length,3);stop();target.dispatchEvent(new Event('focus'));assert.equal(pending.length,3);
});
test('request identity rejects a late result for a replaced project, draft, edited text or newer request',async()=>{
 assert.equal(typeof writing.LocalWritingRequest,'function');const session=new writing.LocalWritingRequest();const old=session.begin('projectA/draftA/original');
 assert.equal(session.accepts(old,'projectA/draftA/original'),true);assert.equal(session.accepts(old,'projectA/draftA/edited'),false);assert.equal(session.accepts(old,'projectB/draftA/original'),false);
 const current=session.begin('projectA/draftB/original');assert.equal(session.accepts(old,old.context),false);assert.equal(session.finish(old),false);assert.equal(session.accepts(current,current.context),true);
 session.cancel();assert.equal(session.accepts(current,current.context),false);
});
test('a failed or late request leaves the previous editor text intact',async()=>{
 assert.equal(typeof writing.LocalWritingRequest,'function');const session=new writing.LocalWritingRequest();let text='ручной текст';let resolve;
 const ticket=session.begin('projectA/draftA/'+text),response=new Promise(r=>resolve=r).then(value=>{if(session.accepts(ticket,'projectA/draftA/'+text))text=value;});
 session.cancel();resolve('старый ответ');await response;assert.equal(text,'ручной текст');
 const failed=session.begin('projectA/draftA/'+text);try{await Promise.reject(new Error('timeout'));}catch{session.finish(failed);}assert.equal(text,'ручной текст');
});
test('invalid JSON and request timeout have actionable local feedback instead of parser internals',()=>{
 assert.equal(typeof writing.localWritingRequestMessage,'function');
 assert.doesNotMatch(writing.localWritingRequestMessage(new SyntaxError('Expected property name in JSON'),'שגיאה מקומית'),/JSON|Expected/u);
 for(const cause of [new DOMException('Timeout internals','TimeoutError'),new TypeError('Failed to fetch')])assert.equal(writing.localWritingRequestMessage(cause,'הבקשה לא הושלמה. אפשר לנסות שוב.'),'הבקשה לא הושלמה. אפשר לנסות שוב.');
 assert.equal(writing.localWritingRequestMessage(new Error('השרת המקומי אינו זמין.'),'fallback'),'השרת המקומי אינו זמין.');
});
const owner='10000000-0000-4000-8000-000000000001',project='20000000-0000-4000-8000-000000000001',docId='40000000-0000-4000-8000-000000000001';
function memoryClient({userId=owner,role='contractor',owned=true,ownedDocument=true}={}){
 const calls=[],writes=[];return {calls,writes,auth:{getUser:async()=>({data:{user:userId?{id:userId}:null},error:null})},
 storage:{from(){return {upload:async(path,file)=>{writes.push({kind:'storage',path,size:file.size});return {error:null};},download:async()=>{calls.push({download:true});throw Error('Unexpected document download');}};}},
 from(table){const filters=[];let insert=null,single=false,remove=false;const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},
 insert(value){insert=value;writes.push({kind:table,value});return q;},delete(){remove=true;writes.push({kind:'delete-'+table});return q;},
 then(resolve,reject){calls.push({table,filters});let data;
  if(insert!==null)data=table==='pricelists'?{id:'synthetic-memory-pricelist'}:null;
  else if(remove)data=null;
  else {const rows=table==='profiles'?[{id:owner,role}]:table==='projects'&&owned?[{id:project,contractor_id:owner}]:table==='documents'&&ownedDocument?[{id:docId,title:'synthetic.pdf',project_id:project}]:[];const matches=rows.filter(r=>filters.every(([k,v])=>r[k]===v));data=single?matches[0]??null:matches;}
  return Promise.resolve({data,error:null}).then(resolve,reject);}};return q;}};
}
registerHooks({load(url,context,next){if(url.endsWith('/src/utils/supabase/server.ts'))return {format:'module',shortCircuit:true,source:'export async function createClient(){return globalThis.__workflowClient;}'};return next(url,context);}});
const parse=await import('../src/app/api/parse/route.ts'),upload=await import('../src/app/api/pricing/upload-universal/route.ts');
const parseRequest=()=>new Request('http://localhost/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:docId,mimeType:'application/pdf'})});
function uploadRequest(file,{isGlobal=false,projectId=project}={}){const form=new FormData();form.set('file',file);if(projectId)form.set('projectId',projectId);form.set('isGlobal',String(isGlobal));return new Request('http://localhost/api/pricing/upload-universal',{method:'POST',body:form});}
async function noNetwork(run){const previous=globalThis.fetch;const calls=[];globalThis.fetch=async(...args)=>{calls.push(String(args[0]));throw Error('EXTERNAL_OR_MODEL_FETCH_FORBIDDEN');};try{await run(calls);}finally{globalThis.fetch=previous;}}
test('legacy parse checks access then refuses unsupported local parsing without downloading or calling a model',async()=>noNetwork(async(network)=>{
 for(const [options,status] of [[{},422],[{userId:null},401],[{ownedDocument:false},403]]){
  const client=memoryClient(options);globalThis.__workflowClient=client;const response=await parse.POST(parseRequest());assert.equal(response.status,status);
  if(status===422)assert.equal((await response.json()).code,'LOCAL_FORMAT_UNSUPPORTED');assert.equal(client.writes.length,0);assert.ok(!client.calls.some(c=>c.download));
 }assert.deepEqual(network,[]);
}));
test('unsupported universal files fail before storage, inserts, scans or any model request',async()=>noNetwork(async(network)=>{
 const client=memoryClient();globalThis.__workflowClient=client;const response=await upload.POST(uploadRequest(new File(['synthetic'],'image.png',{type:'image/png'})));
 assert.equal(response.status,422);assert.equal((await response.json()).code,'LOCAL_FORMAT_UNSUPPORTED');assert.deepEqual(client.writes,[]);assert.deepEqual(network,[]);
}));
test('universal upload retains owner and global-role checks before unsupported format handling',async()=>noNetwork(async(network)=>{
 for(const [options,form,status] of [[{userId:null},{},401],[{owned:false},{},403],[{}, {isGlobal:true},403]]){
  const client=memoryClient(options);globalThis.__workflowClient=client;assert.equal((await upload.POST(uploadRequest(new File(['synthetic'],'image.png',{type:'image/png'}),form))).status,status);assert.equal(client.writes.length,0);
 }assert.deepEqual(network,[]);
}));
function syntheticPdf(){const pdf=new jsPDF({compress:false});pdf.addFileToVFS('fixture.ttf',HEBREW_FONT_BASE64);pdf.addFont('fixture.ttf','Fixture','normal');pdf.setFont('Fixture');pdf.setFontSize(9);pdf.setR2L(true);pdf.text('מחירון משרד הבינוי והשיכון',20,15);pdf.setR2L(false);
 for(let i=1;i<=20;i++)pdf.text(String(i).padStart(4,'0')+' 001 01 Synthetic pipe m 12.34',20,25+i*8);return new File([pdf.output('arraybuffer')],'synthetic-housing.pdf',{type:'application/pdf'});}
test('a real supported synthetic PDF goes through the unchanged deterministic parser and retains exact imported values',async()=>noNetwork(async(network)=>{
 const client=memoryClient();globalThis.__workflowClient=client;const response=await upload.POST(uploadRequest(syntheticPdf()));assert.equal(response.status,200);const body=await response.json();assert.equal(body.itemCount,20);
 const header=client.writes.find(w=>w.kind==='pricelists').value;assert.equal(header.source_type,'HOUSING_MINISTRY');assert.equal(header.project_id,project);assert.equal(header.contractor_id,owner);assert.equal(header.parser_version,'ministry-housing-pdf-v2');
 const rows=client.writes.find(w=>w.kind==='pricelist_items').value;assert.equal(rows.length,20);assert.equal(rows[0].item_code,'01.001.0001');assert.equal(rows[0].rate,12.34);assert.equal(client.writes.filter(w=>w.kind==='storage').length,1);assert.equal(client.writes.filter(w=>w.kind==='documents').length,1);assert.deepEqual(network,[]);
}));
test('a PDF outside the recognized local parser cannot fall back to an external processor',async()=>noNetwork(async(network)=>{
 const pdf=new jsPDF();pdf.text('Synthetic unsupported document',20,20);const file=new File([pdf.output('arraybuffer')],'synthetic-other.pdf',{type:'application/pdf'});
 const client=memoryClient();globalThis.__workflowClient=client;const response=await upload.POST(uploadRequest(file));assert.equal(response.status,422);assert.equal((await response.json()).code,'LOCAL_FORMAT_UNSUPPORTED');assert.deepEqual(client.writes,[]);assert.deepEqual(network,[]);
}));
