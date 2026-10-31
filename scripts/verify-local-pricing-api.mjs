import test from 'node:test';import assert from 'node:assert/strict';
const {evaluateAiPricing}=await import('../src/components/pricing/ai-estimator/api/aiEstimatorApi.ts');
const input={projectId:'30000000-0000-4000-8000-000000000003',contradictionId:'40000000-0000-4000-8000-000000000004',expertMode:false};
test('a failed or malformed local evaluation never becomes usable pricing even with HTTP200',async()=>{
 const original=globalThis.fetch;
 try{for(const value of [{success:false,error:'not ready'},null,{},[]]){globalThis.fetch=async()=>Response.json(value);await assert.rejects(evaluateAiPricing(input));}}
 finally{globalThis.fetch=original;}
});
test('the same explicit successful local response remains readable and an HTTP failure is rejected',async()=>{
 const original=globalThis.fetch,value={success:true,suggested_unit_price_excl_vat:null,total_excl_vat:null};
 try{globalThis.fetch=async()=>Response.json(value);assert.deepEqual(await evaluateAiPricing(input),value);globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503});await assert.rejects(evaluateAiPricing(input),/unavailable/);}
 finally{globalThis.fetch=original;}
});
test('the retained work-change view reaches the local review route and validates its completed result',async()=>{
 const {requestWorkChangeReview}=await import('../src/components/pricing/workChangeReviewApi.ts');const previous=globalThis.fetch,calls=[];
 const review={version:'work-change-v1',facts:[],sources:[]};globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body),signal:options.signal});return Response.json({success:true,review,cached:true,updatedDocumentIds:[]});};
 const controller=new AbortController();try{assert.deepEqual((await requestWorkChangeReview('project','finding',controller.signal)).review,review);assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/pricing/evaluate-ai');assert.deepEqual(calls[0].body,{projectId:'project',contradictionId:'finding',reviewCaseOnly:true});assert.equal(calls[0].signal,controller.signal);}finally{globalThis.fetch=previous;}
});
