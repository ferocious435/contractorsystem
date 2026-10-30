import './load-server.mjs';
import {createRequire,registerHooks} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createAiWorker} from '../../src/server/ai/worker.server.ts';
import {createAiJobService,readAiRequest} from '../../src/server/ai/service.server.ts';
import {runRadarScan} from '../../src/server/ai/radar-service.server.ts';
import {runRadarPreview} from '../../src/server/ai/radar-preview.server.ts';
import {radarHandler,scanPreviewHandler} from '../../src/server/ai/handlers/radar.ts';
import {queueFixture,projectId,savedProfile} from './queue-fixtures.mjs';
import {ownerId} from './fixtures.mjs';
import {radarRows,radarIds,radarReadClient} from './radar-fixtures.mjs';
const require=createRequire(import.meta.url),root=process.cwd(),out=path.resolve('.superpowers/codex-program-runtime-2026-10-30/radar-browser');mkdirSync(out,{recursive:true});
const bundle=require('next/dist/compiled/webpack/webpack');bundle.init();
await new Promise((resolve,reject)=>{const compiler=bundle.webpack({mode:'development',devtool:false,plugins:[new bundle.webpack.DefinePlugin({'process.env':'{}'})],entry:path.resolve('scripts/codex-runtime/browser/radar.tsx'),output:{path:out,filename:'app.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],alias:{'@/utils/supabase/client$':path.resolve('scripts/codex-runtime/browser/radar-client.mjs'),'@':path.resolve('src')}},module:{rules:[{test:/\.tsx?$/,use:path.resolve('scripts/codex-runtime/browser/typescript-loader.cjs')}]},optimization:{minimize:false}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error??Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--build-only'))process.exit(0);
const rows=radarRows(),claim={role:'INSTRUCTION',subject:'עטיפת הצינור',attribute:'CEMENT_CONTENT',value:'4%',scope:null,location:null,party:null,condition:null,period:null};
const finding={title:'עטיפת הצינור',category:'סתירה',work_quote:rows.documents[1].extracted_text,contract_quote:rows.documents[0].extracted_text,comparison:{work:claim,baseline:{...claim,role:'CONTRACT_RULE',value:'8%'}}};
Object.assign(rows.contradictions[0],{title:finding.title,category:finding.category,description:'דוגמה סינתטית: הוראות שונות לגבי צמנט.',severity:'HIGH',source_execution_doc_id:radarIds.work,target_contract_doc_id:radarIds.contract,evidence_data:{...finding,user_review:{note:'Synthetic history retained'}}});
const database=radarReadClient(rows),fx=queueFixture({now:()=>Date.now()}),store=fx.store;const list=store.listOwned;store.listOwned=async(...args)=>(await list(...args)).reverse();
const complete=store.complete;store.complete=async(id,lease,prepared)=>{const accepted=await complete(id,lease,prepared);if(accepted)for(const effect of prepared.effects){const table=effect.type==='SCAN_FINDING'?'contradictions':effect.type==='SCAN_STATE'?'document_scan_state':'documents';if(effect.data.delete_automatic){rows[table]=rows[table].filter(row=>row.id!==effect.targetId);continue;}let row=rows[table].find(item=>item.id===effect.targetId);if(!row){row={id:effect.targetId,project_id:projectId,xmin:'1'};rows[table].push(row);}Object.assign(row,structuredClone(effect.data));row.xmin=String(Number(row.xmin||0)+1);}return accepted;};
const handlers={scan:{...radarHandler,execute:(payload,execution)=>runRadarScan(database,payload,execution)},scan_preview:{...scanPreviewHandler,execute:(payload,execution)=>runRadarPreview(database,payload,execution)}};
let gate=null,turns=0;
const worker=createAiWorker({store,startedAt:0,handlerFor:kind=>handlers[kind]??null,client:{async runTurn(input){turns++;await new Promise(resolve=>gate=resolve);gate=null;return JSON.stringify(input.outputSchema.required.includes('result')?{result:[finding]}:{contradiction_confirmed:true,explanation:'בדוגמה הסינתטית נמצאו הוראות שונות לגבי אחוז הצמנט.',missing_evidence:[],confidence:.9});}}});
const service=createAiJobService({store,worker,authenticate:async()=>({id:ownerId}),resolveOwner:async()=>ownerId,ownsProject:async(owner,project)=>owner===ownerId&&project===projectId,readProfile:async()=>savedProfile,handlerFor:kind=>handlers[kind]??null});
globalThis.__radarBrowser={database,service,readAiRequest,ownerId};
registerHooks({resolve(specifier,context,next){if(/\/api\/scan\/(?:preview\/)?route\.ts$/.test(context.parentURL??'')){
 if(specifier==='@/server/ai/service.server')return {url:'data:text/javascript,export const createOwnedAiJob=(r,k,b)=>globalThis.__radarBrowser.service.create(r,k,b);export const readAiRequest=r=>globalThis.__radarBrowser.readAiRequest(r);export const getAiJobService=()=>globalThis.__radarBrowser.service;export const authenticateRuntimeOwner=async()=>globalThis.__radarBrowser.ownerId;',shortCircuit:true};
 if(specifier==='@/utils/supabase/server')return {url:'data:text/javascript,export const createClient=async()=>globalThis.__radarBrowser.database;',shortCircuit:true};}return next(specifier,context);}});
const radar=await import('../../src/app/api/scan/route.ts'),preview=await import('../../src/app/api/scan/preview/route.ts');
const stats=()=>({syntheticOnly:true,turns,jobs:[...fx.rows.values()].map(job=>({id:job.id,kind:job.kind,state:job.state,result:job.result})),findings:rows.contradictions,states:rows.document_scan_state,realDatabaseWrites:database.writes});
const html='<!doctype html><html lang="ru"><meta charset="utf-8"><title>Синтетическая проверка радара</title><style>body{font:16px Arial;margin:0;background:#f5f6f8;color:#17202c}button,select,input{font:inherit;padding:8px;margin:4px}button{cursor:pointer}button:disabled{opacity:.5}.ti-page{padding:24px;max-width:1200px;margin:auto}.ti-panel{background:white;padding:16px;margin:16px 0}.ti-actions{display:flex;gap:8px;flex-wrap:wrap}dl div{display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid #ddd}.ti-feedback{padding:12px;margin:12px 0;background:#e8eef7}.ti-preserve-lines{white-space:pre-wrap}details{padding:12px}nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px}</style><div id="root"></div><script src="/app.js"></script></html>';
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:3006');if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}if(req.method==='GET'&&url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(readFileSync(path.join(out,'app.js')));return;}
 const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>2_000_000)throw Error('Fixture input too large');parts.push(part);}const raw=Buffer.concat(parts).toString(),request=new Request(url,{method:req.method,headers:{'Content-Type':'application/json'},...(raw?{body:raw}:{})});let response;
 if(url.pathname==='/fixture/release'){gate?.();response=Response.json({success:true});}
 else if(url.pathname==='/fixture/stats')response=Response.json(stats());
 else if(url.pathname==='/fixture/read'){const {table,calls}=JSON.parse(raw);if(!['projects','documents','contradictions'].includes(table))throw Error('Fixture read scope rejected');let query=database.from(table);for(const {method,args}of calls){if(!['select','eq','in','is','order','range','single','maybeSingle'].includes(method))throw Error('Fixture read method rejected');query=query[method](...args);}response=Response.json(await query);}
 else if(url.pathname==='/api/system/ai-status')response=Response.json({available:true,provider:'Codex',reason:null});
 else if(url.pathname==='/api/scan/support-sources')response=Response.json({success:true,blueBook:{available:false,title:null,status:null},shelfContract3210:{available:false,title:null,status:null},priceLists:[],standards:[]});
 else if(url.pathname==='/api/scan')response=await radar[req.method==='GET'?'GET':'POST'](request);
 else if(url.pathname==='/api/scan/preview')response=await preview[req.method==='GET'?'GET':'POST'](request);
 else if(url.pathname==='/api/ai/jobs')response=await service.list(request);
 else if(/^\/api\/ai\/jobs\/[a-f\d-]+\/cancel$/.test(url.pathname))response=await service.cancelRequest(request,url.pathname.split('/')[4]);
 else if(/^\/api\/ai\/jobs\/[a-f\d-]+$/.test(url.pathname))response=await service.read(request,url.pathname.split('/')[4]);
 else response=Response.json({error:'Synthetic route unavailable'},{status:404});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());writeFileSync(path.join(out,'evidence.json'),JSON.stringify(stats(),null,2));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));console.error(error.message);}});
server.listen(3006,'127.0.0.1',()=>{writeFileSync(path.join(out,'process.json'),JSON.stringify({pid:process.pid,cwd:root,port:3006}));console.log('Synthetic radar browser http://127.0.0.1:3006; no native inference or real database writes.');});
