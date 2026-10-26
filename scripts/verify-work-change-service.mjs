import test from 'node:test';
import assert from 'node:assert/strict';
import { finding, document, workChangeDatabase, registerWorkChangeModules } from './fixtures/work-change-fixtures.mjs';
const baseline='דחיקת צנרת ברחוב הרימון: 100 מטר. מחיר כולל 200000 ש"ח ללא מע"מ.';
const proposal='קידוח אופקי ברחוב הרימון: 80 מטר. מחיר כולל 240000 ש"ח ללא מע"מ.';
const modelUrl='data:text/javascript,'+encodeURIComponent(`
 let options={};export const calls=[];
 export function reset(value={}){options=value;calls.length=0;}
 export function getComparisonAiIdentity(){return{kind:options.external?'gemini':'ollama',model:'fixture'};}
 export async function generateComparisonText(prompt){
  calls.push(prompt);if(options.unavailable)throw Error('Local offline');if(options.onGenerate)options.onGenerate(prompt);
  const line=prompt.match(/^WORK_CHANGE_INPUT (.+)$/m);if(line){const input=JSON.parse(line[1]);return JSON.stringify({facts:(options.facts?.[input.sourceId]||[]).map(fact=>{
   const {quote,...rest}=fact;return{...rest,quoteIds:options.badQuoteId?['not-provided']:(input.quotes||[]).filter(item=>quote.includes(item.text)||item.text.includes(quote)).map(item=>item.id)};
  })});}
  if(prompt.startsWith('WORK_CHANGE_SCOPE_COMPARE'))return JSON.stringify({matches:options.scopeMatches||[]});
  return JSON.stringify({comparisons:[{baselineId:'F1',proposalId:'F2',composition:'SAME'}]});
 }
`);
const hook=registerWorkChangeModules({'@/lib/comparison-ai':modelUrl});
const {reviewWorkChangeCase}=await import('../src/utils/work-change-review-server.ts');
const model=await import(modelUrl);hook.deregister();
function setup(){
 const item=finding();item.evidence_data.manual_note='owner keeps this';
 const db=workChangeDatabase({contradictions:[item],documents:[
  document('primary','ברחוב הרימון יוחלף קו GRP בשיטת קידוח אופקי.'),
  document('old',baseline,{category:'CONTRACT'}),document('offer',proposal),
 ]});
 let value=null;const cache={async load(){return structuredClone(value);},async save(_project,_finding,next){value=structuredClone(next);}};
 const options={facts:{old:[{kind:'BASELINE_WORK',quote:baseline,quantity:100,unit:'מטר',amountExclVat:200000}],offer:[{kind:'PROPOSED_WORK',quote:proposal,quantity:80,unit:'מטר',amountExclVat:240000}]}};
 return{db,cache,options,run:extra=>reviewWorkChangeCase({supabase:db,projectId:'project',findingId:'change',refreshReading:false,cache,...extra})};
}
test('case review uses related documents and makes no database or financial mutation',async()=>{
 const {db,options,run}=setup();model.reset(options);
 const result=await run();assert.equal(result.review.facts.length,2);assert.ok(result.review.sources.some(source=>source.id==='offer'));
 assert.ok(result.review.comparisons.some(pair=>pair.status==='NOT_COMPARABLE'));
 assert.equal(db.writes.length,0);assert.equal(db.tables.contradictions[0].evidence_data.manual_note,'owner keeps this');
});
test('an unchanged complete review reuses the persistent source cache without another model call',async()=>{
 const {options,run}=setup();model.reset(options);await run();const count=model.calls.length;
 const again=await run();assert.equal(again.cached,true);assert.equal(model.calls.length,count);
});
test('changed source text is analysed while unchanged source jobs are reused',async()=>{
 const {db,options,run}=setup();model.reset(options);await run();const count=model.calls.length;
 db.tables.documents.find(doc=>doc.id==='offer').extracted_text+='\nתנאי חדש להצעה.';
 const result=await run();assert.equal(result.cached,false);
 const newSourceCalls=model.calls.slice(count).filter(prompt=>prompt.includes('WORK_CHANGE_INPUT'));
 assert.equal(newSourceCalls.length,1);assert.match(newSourceCalls[0],/"sourceId":"offer"/);
});
test('a local failure cannot call an external provider or return a made-up review',async()=>{
 const {options,run,db}=setup();model.reset({...options,unavailable:true});
 await assert.rejects(run(),error=>error.status===503);assert.equal(db.writes.length,0);
 model.reset({...options,external:true});await assert.rejects(run(),error=>error.status===503);assert.equal(model.calls.length,0);
});
test('technical exclusions remain blocked before model or reading',async()=>{
 const {db,run}=setup();db.tables.contradictions[0].evidence_data.review_disposition={type:'INVALID_AUTOMATIC_FINDING'};model.reset();
 await assert.rejects(run(),error=>error.status===409);assert.equal(model.calls.length,0);assert.equal(db.writes.length,0);
});
test('a source changed during inference cannot receive a stale completed result',async()=>{
 const {db,options,run}=setup();let changed=false;
 model.reset({...options,onGenerate(){if(!changed){changed=true;db.tables.documents[0].extracted_text+='\nמסמך השתנה.';}}});
 await assert.rejects(run(),error=>error.status===409);assert.equal(db.writes.length,0);
});
test('comparison requests remain bounded when the case contains many long work quotes',async()=>{
 const {db,options,run}=setup();
 for(let i=0;i<20;i++){
  const id=`long-${i}`,quote=`קידוח אופקי ברחוב הרימון: 100 מטר, מחיר כולל 200000 ש"ח ללא מע"מ. ${'תנאי עבודה מפורטים. '.repeat(60)} ${i}`;
  db.tables.documents.push(document(id,quote,{category:'CONTRACT'}));
  options.facts[id]=[{kind:i%2?'PROPOSED_WORK':'BASELINE_WORK',quote,quantity:100,unit:'מטר',amountExclVat:200000}];
 }
 model.reset(options);await run();
 const prompts=model.calls.filter(prompt=>prompt.startsWith('WORK_CHANGE_COMPARE'));
 assert.ok(prompts.length>0);assert.ok(prompts.every(prompt=>prompt.length<=11000));
});
test('unknown citation IDs returned by the model cannot fabricate a source quote',async()=>{
 const {options,run}=setup();model.reset({...options,badQuoteId:true});
 const result=await run();assert.equal(result.review.facts.length,0);
 assert.ok(result.review.limitations.includes('fact_quote_unverified'));
});
test('simultaneous requests share the same in-flight source analysis',async()=>{
 const {options,run}=setup();model.reset(options);
 const results=await Promise.all([run(),run()]);
 assert.equal(model.calls.filter(prompt=>prompt.includes('WORK_CHANGE_INPUT')).length,3);
 assert.deepEqual(results[0].review,results[1].review);
});

test('a short related letter is read through its annexes and late commercial terms',async()=>{
 const {db,options,run}=setup();
 const source=db.tables.documents.find(doc=>doc.id==='offer');
 source.extracted_text=proposal+'\n'+('תיעוד נלווה. '.repeat(450))+'\nנספח אחרון: אחריות המזמין לאספקת מים ודרכי גישה.';
 model.reset(options);await run();
 const input=model.calls.filter(prompt=>prompt.includes('WORK_CHANGE_INPUT')&&prompt.includes('"sourceId":"offer"')).join('\n');
 assert.match(input,/נספח אחרון/);
});

test('unverified measurements are explained without attempting financial work comparisons',async()=>{
 const {options,run}=setup();options.facts.old[0].quantity=361;
 model.reset(options);const result=await run();
 assert.equal(model.calls.filter(prompt=>prompt.startsWith('WORK_CHANGE_COMPARE')).length,0);
 assert.ok(result.review.limitations.includes('work_comparison_missing'));
});

test('a work fact with an unverified financial field is not sent as an established baseline',async()=>{
 const {options,run}=setup();options.facts.old[0].amountExclVat=999999;
 model.reset(options);const result=await run();
 assert.equal(model.calls.filter(prompt=>prompt.startsWith('WORK_CHANGE_COMPARE')).length,0);
 assert.ok(result.review.limitations.includes('work_comparison_missing'));
});

test('scope review uses structured rows with locked sides and keeps an unknown financial result',async()=>{
 const {db,options,run}=setup();
 db.tables.contradictions[0].target_contract_doc_id='old';
 db.tables.documents.find(doc=>doc.id==='old').extracted_text=baseline+'\n62.04.0002 דחיקת צנרת GRP מתוך פיר\nמטר 100 2000 200000';
 db.tables.documents.find(doc=>doc.id==='offer').extracted_text='הצעת מחיר לקידוח אופקי ברחוב הרימון\n'+proposal+'\n71.02.0002 קידוח אופקי ומשיכת צינורות\nמטר 80 3000 240000';
 options.scopeMatches=[{baselineIds:['T1'],proposalIds:['T2'],basisIds:['R1'],composition:'DIFFERENT'}];
 model.reset(options);const result=await run();
 assert.equal(result.review.scopeComparisons.length,1);
 assert.deepEqual(result.review.scopeComparisons[0].baselineIds,['T1']);
 assert.deepEqual(result.review.scopeComparisons[0].proposalIds,['T2']);
 assert.equal(result.review.scopeComparisons[0].arithmeticDeltaExclVat,null);
 assert.equal(db.writes.length,0);
 const count=model.calls.length,again=await run();
 assert.equal(again.cached,true);assert.equal(model.calls.length,count);
});

test('new scope context reuses unchanged source jobs and analyses only the changed combination',async()=>{
 const {db,options,run}=setup();
 db.tables.contradictions[0].target_contract_doc_id='old';
 db.tables.documents.find(doc=>doc.id==='old').extracted_text=baseline+'\n62.04.0002 דחיקת צנרת GRP מתוך פיר\nמטר 100 2000 200000';
 db.tables.documents.find(doc=>doc.id==='offer').extracted_text='הצעת מחיר לקידוח אופקי ברחוב הרימון\n'+proposal+'\n71.02.0002 קידוח אופקי ומשיכת צינורות\nמטר 80 3000 240000';
 options.scopeMatches=[{baselineIds:['T1'],proposalIds:['T2'],basisIds:['R1'],composition:'DIFFERENT'}];
 model.reset(options);await run();const count=model.calls.length;
 db.tables.contradictions[0].evidence_data.issue_owner_notes=[{origin:'OWNER_NOTE',text:'יש לבדוק את אספקת הצנרת בנפרד.'}];
 const result=await run(),newCalls=model.calls.slice(count);
 assert.equal(result.cached,false);
 assert.equal(newCalls.filter(prompt=>prompt.startsWith('WORK_CHANGE_SOURCE_FACTS')).length,0);
 assert.equal(newCalls.filter(prompt=>prompt.startsWith('WORK_CHANGE_SCOPE_COMPARE')).length,1);
 assert.equal(result.review.scopeComparisons.length,1);
});
