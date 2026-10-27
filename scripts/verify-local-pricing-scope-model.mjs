import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import {pricingModelCases} from './fixtures/pricing-scope-model-cases.mjs';
dotenv.config({path:'.env.local',quiet:true});
const dir=path.resolve('.superpowers/sdd/2026-10-26-price-scope-and-source-check/resume-2026-10-27');
fs.mkdirSync(dir,{recursive:true});
const environmentDigest=crypto.createHash('sha256').update(fs.readFileSync('.env.local')).digest('hex');
const realUrl=pathToFileURL(path.resolve('src/lib/comparison-ai.ts')).href;
// Memoise only the existing product adapter's exact synthetic requests: no second model client or judge.
const proxyUrl='data:text/javascript,'+encodeURIComponent(`
import fs from 'node:fs';import crypto from 'node:crypto';
import {generateComparisonText as real,getComparisonAiIdentity} from ${JSON.stringify(realUrl)};
export {getComparisonAiIdentity};
const file=${JSON.stringify(path.join(dir,'local-request-cache.json'))};const cache=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
export const stats={newCalls:0,reusedCalls:0};let currentCase='';export function setCase(value){currentCase=value;}
export async function generateComparisonText(prompt,environment,tuning){
 const identity=getComparisonAiIdentity(environment);if(identity.kind!=='ollama')throw Error('Only the existing local product adapter is allowed');
 const key=crypto.createHash('sha256').update(JSON.stringify({identity,prompt,tuning,environmentDigest:${JSON.stringify(environmentDigest)}})).digest('hex');
 if(cache[key]){stats.reusedCalls++;return cache[key].response;}
 const started=Date.now();const response=await real(prompt,environment,tuning);stats.newCalls++;
 cache[key]={case:currentCase,checkedAt:new Date().toISOString(),prompt,response,elapsedMs:Date.now()-started};fs.writeFileSync(file,JSON.stringify(cache,null,2));
 console.log(JSON.stringify({case:currentCase,request:prompt.split('\\n')[0],elapsedMs:Date.now()-started}));return response;
}
`);
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='@/lib/comparison-ai')return{url:proxyUrl,shortCircuit:true};if(specifier.startsWith('@/'))return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);try{return next(specifier,context)}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[cm]?[jt]sx?$/u.test(specifier))return next(`${specifier}.ts`,context);throw error}}});
const {reviewPricingScope}=await import('../src/utils/pricing-scope-review-server.ts');
const proxy=await import(proxyUrl);hook.deregister();
assert.equal(proxy.getComparisonAiIdentity().kind,'ollama','Current configured local provider is required');
const selected=pricingModelCases.filter(entry=>!process.env.PRICING_CASE||entry.id.includes(process.env.PRICING_CASE));
assert.ok(selected.length,'No matching acceptance case');
const expectations=selected.map(({context,...entry})=>({...entry,inputSha256:crypto.createHash('sha256').update(JSON.stringify(context)).digest('hex')}));
fs.writeFileSync(path.join(dir,'local-acceptance-expectations.json'),JSON.stringify({authoredBeforeRun:true,independentModelJudge:false,oldScoresNotReused:true,cases:expectations},null,2));
const results=[];
for(const entry of selected){proxy.setCase(entry.id);try{const result=await reviewPricingScope(entry.context);
 fs.writeFileSync(path.join(dir,'local-case-'+entry.id+'.json'),JSON.stringify(result,null,2));
 assert.equal(result.status,entry.status);assert.equal(result.totalExclVat,entry.total);
 if(entry.total!==null)assert.equal(result.requiresReview,false);
 if(entry.lines!==undefined)assert.equal(result.lines.length,entry.lines);
 if(entry.actions){for(const action of entry.actions)assert.ok(result.requirements.some(r=>r.description.includes(action)),`Missing action ${action}`);
  assert.ok(result.requirements.every(r=>entry.actions.filter(action=>r.description.includes(action)).length<=1),'A required action was merged with another action');}
 if(entry.uncovered)assert.ok(result.uncoveredRequirementIds.some(id=>result.requirements.find(r=>r.id===id)?.description.includes(entry.uncovered)),'Required excluded action was not retained as uncovered');
 for(const anchor of [...result.requirements.flatMap(r=>r.evidence),...result.positions.flatMap(p=>p.evidence),...result.lines.flatMap(l=>[...l.quantity.evidence,...l.unitPriceExclVat.evidence,...l.coefficients.flatMap(c=>c.evidence)])]){
  const source=entry.context.sources.find(s=>s.id===anchor.documentId);assert.ok(source);assert.equal(source.extracted_text.slice(anchor.start,anchor.end),anchor.quote);}
 results.push({id:entry.id,pass:true});console.log('PASS '+entry.id);
 }catch(error){results.push({id:entry.id,pass:false,error:error.message});console.error('FAIL '+entry.id+': '+error.message);}}
const proof={checkedAt:new Date().toISOString(),cases:results,newCalls:proxy.stats.newCalls,reusedCalls:proxy.stats.reusedCalls,realProjectWrites:0,note:'Synthetic source-backed acceptance properties; not an independent project-wide model accuracy score.'};
fs.writeFileSync(path.join(dir,'local-acceptance-result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
if(results.some(r=>!r.pass))process.exitCode=1;
