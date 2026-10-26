import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { workChangeDatabase } from './fixtures/work-change-fixtures.mjs';
const boundaryUrl='data:text/javascript,'+encodeURIComponent(`
 let database,fail=false;export const calls={legacy:0,review:0};
 export function reset(db,shouldFail=false){database=db;fail=shouldFail;calls.legacy=0;calls.review=0;}
 export async function createClient(){return database;}
 export class PricingEvaluationHttpError extends Error{}
 export class WorkChangeReviewHttpError extends Error{constructor(status,message){super(message);this.status=status;}}
 export class AiEstimatorService{async evaluate(){calls.legacy++;return{success:true,legacy:true};}}
 export async function reviewWorkChangeCase(){calls.review++;if(fail)throw new WorkChangeReviewHttpError(503,'Local unavailable');return{review:{version:'work-change-v1',facts:[],sources:[]},cached:false,updatedDocumentIds:[]};}
`);
const boundary=await import(boundaryUrl);
const hook=registerHooks({resolve(specifier,context,next){
 if(specifier==='next/server')return next('next/server.js',context);
 if(['@/utils/supabase/server','@/utils/work-change-review-server','./ai-estimator-service'].includes(specifier))return{url:boundaryUrl,shortCircuit:true};
 if(specifier==='./evaluation-access')return next(new URL('../src/app/api/pricing/evaluate-ai/evaluation-access.ts',import.meta.url).href,context);
 if(specifier.startsWith('@/'))return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
 return next(specifier,context);
}});
const file=process.env.WORK_CHANGE_ROUTE_FILE?pathToFileURL(path.resolve(process.env.WORK_CHANGE_ROUTE_FILE)).href:new URL('../src/app/api/pricing/evaluate-ai/route.ts',import.meta.url).href;
const {POST}=await import(file);hook.deregister();
const request=extra=>new Request('http://localhost/api/pricing/evaluate-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:'project',contradictionId:'change',reviewCaseOnly:true,...extra})});
test('the actual API dispatches source review without running ordinary pricing',async()=>{
 boundary.reset(workChangeDatabase());const response=await POST(request());const payload=await response.json();
 assert.equal(response.status,200);assert.equal(payload.review?.version,'work-change-v1');assert.equal(boundary.calls.legacy,0);
});
test('the actual new mode retains authentication',async()=>{
 const db=workChangeDatabase();db.auth.getUser=async()=>({data:{user:null},error:null});boundary.reset(db);
 assert.equal((await POST(request())).status,401);assert.equal(boundary.calls.review,0);assert.equal(boundary.calls.legacy,0);
});
test('the actual new mode retains project ownership',async()=>{
 boundary.reset(workChangeDatabase({projects:[]}));assert.equal((await POST(request())).status,403);assert.equal(boundary.calls.review,0);
});
test('a local-review failure stays an explicit unavailable response',async()=>{
 boundary.reset(workChangeDatabase(),true);assert.equal((await POST(request())).status,503);assert.equal(boundary.calls.legacy,0);
});
test('ordinary pricing still uses its original API path',async()=>{
 boundary.reset(workChangeDatabase());const response=await POST(request({reviewCaseOnly:false}));
 assert.equal((await response.json()).legacy,true);assert.equal(boundary.calls.review,0);
});
