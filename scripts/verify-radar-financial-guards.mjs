import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), ts=require('typescript'), Module=require('node:module');
const resolve=Module._resolveFilename;
Module._resolveFilename=function(specifier,...args) { return resolve.call(this,
  specifier.startsWith('@/')?path.resolve('src',specifier.slice(2)):specifier,...args); };
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file}).outputText,file);
const { BulkConfidencePreviewService }=require('../src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts');
// The real service runs; its external inference boundary cannot create a client or make a request.
let inferenceCalls=0;
require.cache[require.resolve('../src/lib/gemini.ts')]={exports:{geminiFlashModel:{generateContent(){inferenceCalls++;throw new Error('Inference is forbidden in the guard test');}}}};
const { AiEstimatorService }=require('../src/app/api/pricing/evaluate-ai/ai-estimator-service.ts');
const { saveLedgerItem }=require('../src/app/api/pricing/save-ledger/save-ledger-service.ts');
const excluded={id:'excluded',project_id:'project',status:'OPEN',evidence_data:{review_disposition:{type:'INVALID_AUTOMATIC_FINDING'},pricing_evaluation:{confidence_score:0.99}}};
function database(tables) {
  const state=structuredClone(tables),writes=[];
  return {state,writes,from(table) {
    assert.ok(Object.hasOwn(state,table),`Unexpected side effect: ${table}`);
    const filters=[];let patch,one=false;
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},in(k,vs){filters.push(r=>vs.includes(r[k]));return q;},
      maybeSingle(){one=true;return q;},single(){one=true;return q;},update(p){patch=p;return q;},
      then(resolve,reject){try {const rows=state[table].filter(r=>filters.every(f=>f(r)));
        if(patch)for(const r of rows){writes.push(table);Object.assign(r,structuredClone(patch));}
        return Promise.resolve({data:structuredClone(one?rows[0]||null:rows),error:null}).then(resolve,reject);
      }catch(e){return Promise.reject(e).then(resolve,reject);}}
    };return q;
  }};
}
test('high confidence never stages a technical exclusion for automatic pricing',async()=>{
  const db=database({contradictions:[excluded,{...excluded,id:'valid',evidence_data:{pricing_evaluation:{confidence_score:0.95}}}]});
  const result=await new BulkConfidencePreviewService(db).previewHighConfidenceItems({projectId:'project',requestedIds:['excluded','valid']});
  assert.deepEqual(result.stagedIds,['valid']);assert.deepEqual(result.skippedIds,['excluded']);assert.deepEqual(db.writes,[]);
});
test('automatic estimation rejects an excluded record before synchronizing data or invoking any model',async()=>{
  const db=database({contradictions:[excluded]}),originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=()=>{calls++;throw new Error('No model or network is authorized in this test');};
  try{await assert.rejects(new AiEstimatorService(db).evaluate({projectId:'project',contradictionId:'excluded',contractorId:'owner'}),e=>e.status===409);
    assert.equal(calls,0);assert.equal(inferenceCalls,0);assert.deepEqual(db.writes,[]);
  }finally{globalThis.fetch=originalFetch;}
});
test('a new financial row cannot be created from an excluded record',async()=>{
  const db=database({projects:[{id:'project',contractor_id:'owner'}],contradictions:[excluded],pricing_ledger:[]});
  const result=await saveLedgerItem(db,'owner',{project_id:'project',contradiction_id:'excluded',description:'test calculation',quantity:2,unit_price_excl_vat:50});
  assert.equal(result.status,409);assert.deepEqual(db.writes,[]);assert.deepEqual(db.state.pricing_ledger,[]);
});
test('the existing financial row remains editable without reviving its excluded source',async()=>{
  const db=database({projects:[{id:'project',contractor_id:'owner'}],contradictions:[{...excluded,status:'ARCHIVED'}],
    pricing_ledger:[{id:'old-ledger',project_id:'project',contradiction_id:'excluded',type:'PENDING_VO',source:'CUSTOM_ANALYSIS'}]});
  const before=structuredClone(db.state.contradictions);
  const result=await saveLedgerItem(db,'owner',{project_id:'project',item_id:'old-ledger',description:'manual saved calculation',quantity:2,unit_price_excl_vat:50});
  assert.equal(result.status,200);assert.deepEqual(db.state.contradictions,before);
  assert.equal(db.state.pricing_ledger[0].contradiction_id,'excluded');
});
