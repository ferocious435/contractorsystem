import './load-server.mjs';
import {createRequire,registerHooks} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createAiWorker} from '../../src/server/ai/worker.server.ts';
import {createAiJobService,readAiRequest} from '../../src/server/ai/service.server.ts';
import {createPricingHandler,createWorkChangeHandler} from '../../src/server/ai/handlers/pricing.ts';
import {createSupportHandler} from '../../src/server/ai/handlers/support.ts';
import {queueFixture,projectId,savedProfile} from './queue-fixtures.mjs';
import {ownerId} from './fixtures.mjs';
import {pricingRows,pricingReadClient,applyPricingEffects} from './pricing-fixtures.mjs';
const require=createRequire(import.meta.url),root=process.cwd(),out=path.resolve('.superpowers/codex-program-runtime-2026-10-30/pricing-browser');mkdirSync(out,{recursive:true});
const bundle=require('next/dist/compiled/webpack/webpack');bundle.init();
await new Promise((resolve,reject)=>{const compiler=bundle.webpack({mode:'development',devtool:false,plugins:[new bundle.webpack.DefinePlugin({'process.env':'{}'})],entry:path.resolve('scripts/codex-runtime/browser/pricing.tsx'),output:{path:out,filename:'app.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],alias:{'@/utils/supabase/client$':path.resolve('scripts/codex-runtime/browser/radar-client.mjs'),'@':path.resolve('src')}},module:{rules:[{test:/\.tsx?$/,use:path.resolve('scripts/codex-runtime/browser/typescript-loader.cjs')}]},optimization:{minimize:false}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error??Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--build-only'))process.exit(0);
const rows=pricingRows(),database=pricingReadClient(rows),fx=queueFixture({now:()=>Date.now()}),store=fx.store;let cacheValue=null;
const cache={load:async()=>structuredClone(cacheValue),save:async(_project,_finding,value)=>{cacheValue=structuredClone(value);}};
const list=store.listOwned;store.listOwned=async(...args)=>(await list(...args)).reverse();const complete=store.complete;store.complete=async(id,lease,prepared)=>{const accepted=await complete(id,lease,prepared);if(accepted)applyPricingEffects(database.tables,prepared);return accepted;};
const handlers={pricing:createPricingHandler({database:()=>database}),work_change:createWorkChangeHandler({database:()=>database,cache}),support_enrichment:createSupportHandler({database:()=>database})};
let gate=null,pause=true,turns=0,posts=0;
function reply(input){const prompt=input.text;if(prompt.startsWith('PRICING_SCOPE_WORK_PROFILE'))return {operations:[{operation_quote:'אספקה ופיזור'}]};if(prompt.startsWith('PRICING_SCOPE_MATERIAL'))return {verdict:'MATCH'};if(prompt.startsWith('PRICING_SCOPE_PERMISSION'))return {verdict:'MATCH',evidence:[prompt.match(/\[CONTRACT SOURCE[^\n]*\]\n\[(Q\d+)\]/)?.[1]].filter(Boolean)};if(prompt.startsWith('PRICING_SCOPE_PRICE_COVERAGE'))return {material:'MATCH',work:'MATCH',method:'MATCH',unit:'MATCH',conditions:'MATCH',coverage:Object.fromEntries(input.outputSchema.properties.coverage.required.map(id=>[id,'INCLUDED'])),pricing:'MATCH',pricingEvidence:[],coefficients:[]};if(prompt.startsWith('WORK_CHANGE_SOURCE_FACTS'))return {facts:[]};if(prompt.startsWith('WORK_CHANGE_SCOPE_COMPARE'))return {matches:[]};if(prompt.startsWith('WORK_CHANGE_COMPARE'))return {comparisons:[]};if(prompt.startsWith('Explain only'))return {technical_foundation:'הסבר סינתטי לפי המקורות',professional_argument:'נדרש תיעוד מסודר',site_diary_instruction:'לתעד כמות בפועל'};throw Error('Unexpected pricing fixture prompt');}
const worker=createAiWorker({store,startedAt:0,handlerFor:kind=>handlers[kind]??null,client:{async runTurn(input){turns++;if(pause)await new Promise(resolve=>gate=resolve);gate=null;return JSON.stringify(reply(input));}}});
const service=createAiJobService({store,worker,authenticate:async()=>({id:ownerId}),resolveOwner:async()=>ownerId,ownsProject:async(owner,project)=>owner===ownerId&&project===projectId,readProfile:async()=>savedProfile,handlerFor:kind=>handlers[kind]??null});
globalThis.__pricingBrowser={database,service,readAiRequest,ownerId};
registerHooks({resolve(specifier,context,next){if(/\/api\/(?:pricing\/evaluate-ai|scan\/enrich)\/route\.ts$/.test(context.parentURL??'')){
 if(specifier==='@/server/ai/service.server')return {url:'data:text/javascript,export const createOwnedAiJob=(r,k,b)=>globalThis.__pricingBrowser.service.create(r,k,b);export const readAiRequest=r=>globalThis.__pricingBrowser.readAiRequest(r);export const getAiJobService=()=>globalThis.__pricingBrowser.service;export const authenticateRuntimeOwner=async()=>globalThis.__pricingBrowser.ownerId;',shortCircuit:true};
 if(specifier==='@/utils/supabase/server')return {url:'data:text/javascript,export const createClient=async()=>globalThis.__pricingBrowser.database;',shortCircuit:true};}return next(specifier,context);}});
const pricing=await import('../../src/app/api/pricing/evaluate-ai/route.ts'),support=await import('../../src/app/api/scan/enrich/route.ts');
const stats=()=>({syntheticOnly:true,turns,posts,jobs:[...fx.rows.values()].map(job=>({id:job.id,kind:job.kind,state:job.state,result:job.result})),findings:database.tables.contradictions,realDatabaseWrites:database.writes.length});
const html='<!doctype html><html lang="ru"><meta charset="utf-8"><title>Синтетическая проверка расценок</title><style>body{font:16px Arial;margin:0;background:#f5f6f8;color:#17202c}main{padding:20px}button,select,input,textarea{font:inherit;padding:8px;margin:4px}button{cursor:pointer}button:disabled{opacity:.5}.ti-dialog-backdrop{position:relative!important}.ti-dialog{background:white;padding:20px;margin:15px;max-height:none!important}.ti-dialog__header,.ti-actions{display:flex;gap:10px;align-items:center;justify-content:space-between}.ti-estimator-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.ti-panel{background:#f4f6f8;padding:16px;margin:12px 0}.ti-feedback{padding:12px;margin:12px 0;background:#e8eef7}.ti-preserve-lines{white-space:pre-wrap}details{padding:12px}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ccd}nav{display:flex;gap:8px}</style><div id="root"></div><script src="/app.js"></script></html>';
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:3006');if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}if(req.method==='GET'&&url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(readFileSync(path.join(out,'app.js')));return;}
 const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>2_000_000)throw Error('Fixture input too large');parts.push(part);}const raw=Buffer.concat(parts).toString(),request=new Request(url,{method:req.method,headers:{'Content-Type':'application/json'},...(raw?{body:raw}:{})});let response;
 if(url.pathname==='/fixture/release'){pause=false;gate?.();response=Response.json({success:true});}
 else if(url.pathname==='/fixture/stats')response=Response.json(stats());
 else if(url.pathname==='/fixture/read'){const {table,calls}=JSON.parse(raw);if(!['projects','documents','contradictions'].includes(table))throw Error('Fixture scope rejected');let query=database.from(table);for(const {method,args}of calls){if(!['select','eq','in','is','order','range','single','maybeSingle'].includes(method))throw Error('Fixture method rejected');query=query[method](...args);}response=Response.json(await query);}
 else if(url.pathname==='/api/system/ai-status')response=Response.json({available:true,provider:'Codex',reason:null});
 else if(url.pathname==='/api/pricing/evaluate-ai'){if(req.method==='POST'){posts++;pause=true;}response=await pricing[req.method==='GET'?'GET':'POST'](request);}
 else if(url.pathname==='/api/scan/enrich')response=await support.POST(request);
 else if(url.pathname==='/api/ai/jobs')response=await service.list(request);
 else if(/^\/api\/ai\/jobs\/[a-f\d-]+\/cancel$/.test(url.pathname))response=await service.cancelRequest(request,url.pathname.split('/')[4]);
 else if(/^\/api\/ai\/jobs\/[a-f\d-]+$/.test(url.pathname))response=await service.read(request,url.pathname.split('/')[4]);
 else response=Response.json({error:'Synthetic route unavailable'},{status:404});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());writeFileSync(path.join(out,'evidence.json'),JSON.stringify(stats(),null,2));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));console.error(error.message);}});
server.listen(3006,'127.0.0.1',()=>{writeFileSync(path.join(out,'process.json'),JSON.stringify({pid:process.pid,cwd:root,port:3006}));console.log('Synthetic pricing browser http://127.0.0.1:3006; no native inference or real financial writes.');});
