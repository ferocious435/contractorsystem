import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {queueFixture,savedProfile} from './codex-runtime/queue-fixtures.mjs';
import {createAiWorker} from '../src/server/ai/worker.server.ts';
import {buildScanMemorySignature} from '../src/utils/document-scan-memory.ts';
const adapter=existsSync(new URL('../src/server/ai/comparison.server.ts',import.meta.url))?await import('../src/server/ai/comparison.server.ts'):{};
const reuse=existsSync(new URL('../src/utils/ai-analysis-reuse.ts',import.meta.url))?await import('../src/utils/ai-analysis-reuse.ts'):{};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const oldIdentity={kind:'ollama',provider:'Local AI',model:'previous-observed-fixture'},identity={kind:'codex',provider:'Codex',model:savedProfile.model};
const doc={id:'20000000-0000-4000-8000-000000000002',title:'הנחיה.pdf',extracted_text:'יש לתאם את העבודה עם המפקח.',content_hash:'a'.repeat(64),ocr_status:'COMPLETED',parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:1,readPages:[1],unreadablePages:[]}}};
const context={projectId:'30000000-0000-4000-8000-000000000003',documents:[doc],relatedDocuments:[],relations:[],rulesVersion:'accepted-rules-v1'};
const material={format:'json-identity',before:{promptVersion:'old-source-v1'},after:{query:'לתאם את העבודה',sourceId:doc.id,text:doc.extracted_text}};
const input=()=>({context:structuredClone(context),material:structuredClone(material),historicalContextHash:reuse.analysisContextFingerprint?.(context)});
const verified=value=>value&&typeof value==='object'&&value.sourceId===doc.id&&value.quote===doc.extracted_text;

test('comparison calls require a live trusted parent execution, including metadata identity',async()=>{
  assert.equal(typeof adapter.generateComparisonText,'function');assert.equal(typeof adapter.getComparisonAiIdentity,'function');
  await assert.rejects(adapter.generateComparisonText('business request',{profile:savedProfile,generate:async()=>{throw Error('must not run');}}),error=>error.code==='AI_EXECUTION_REQUIRED');
  assert.throws(()=>adapter.getComparisonAiIdentity({profile:savedProfile}),error=>error.code==='AI_EXECUTION_REQUIRED');
});

test('two nested comparisons share one parent queue and its manually frozen profile',async()=>{
  assert.equal(typeof adapter.generateComparisonText,'function');let captured=null;const fx=queueFixture({onGenerate:async input=>{assert.deepEqual(input.outputSchema,{type:'object',additionalProperties:false,properties:{answer:{type:'string'}},required:['answer']});await new Promise(resolve=>setImmediate(resolve));return '{"answer":"checked"}';}});
  const format={type:'object',additionalProperties:false,properties:{answer:{type:'string'}},required:['answer']};
  fx.handler={validate:raw=>raw,async execute(_payload,execution){captured=execution;assert.deepEqual(adapter.getComparisonAiIdentity(execution),identity);const outputs=await Promise.all([adapter.generateComparisonText('first',execution,{responseFormat:format}),adapter.generateComparisonText('second',execution,{responseFormat:format})]);return {result:outputs,effects:[]};}};
  await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal(fx.rows.size,1);assert.equal([...fx.rows.values()][0].state,'SUCCEEDED');assert.equal(fx.modelTurns,2);assert.equal(fx.maxParallel,1);assert.throws(()=>adapter.getComparisonAiIdentity(captured),error=>error.code==='AI_EXECUTION_REQUIRED');
});

test('a comparison without a supplied schema returns checked plain text from a fixed envelope',async()=>{
  assert.equal(typeof adapter.generateComparisonText,'function');const fx=queueFixture({onGenerate:async input=>{assert.deepEqual(input.outputSchema.required,['text']);return '{"text":"{\\"findings\\":[]}"}';}});
  fx.handler={validate:raw=>raw,async execute(_payload,execution){return {result:await adapter.generateComparisonText('Return findings JSON',execution),effects:[]};}};
  await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal([...fx.rows.values()][0].result,'{"findings":[]}');
});

test('an accepted historical opaque key is recovered for identical complete inputs without a model call',()=>{
  assert.equal(typeof reuse.reusableAnalysisKeys,'function');assert.equal(typeof reuse.findReusableAnalysis,'function');const packet=input(),oldKey=hash({...material.before,identity:oldIdentity,...material.after}),saved={sourceId:doc.id,quote:doc.extracted_text};const store={[oldKey]:saved};let modelCalls=0;
  const result=reuse.findReusableAnalysis(store,packet,identity,[oldIdentity],verified);if(result===null)modelCalls++;assert.deepEqual(result,saved);assert.equal(modelCalls,0);assert.ok(reuse.reusableAnalysisKeys(packet,identity,[oldIdentity]).includes(oldKey));
});

test('related documents, later approval, source text, rule changes and missing historical proof prevent stale reuse',()=>{
  assert.equal(typeof reuse.reusableAnalysisKeys,'function');const oldKey=hash({...material.before,identity:oldIdentity,...material.after});
  for(const mutate of [packet=>packet.context.relatedDocuments.push({...doc,id:'later',extracted_text:'הנושא נסגר בהסכמה מאוחרת.'}),packet=>packet.context.relations.push({from:doc.id,to:'later',relation:'CLOSED'}),packet=>packet.context.rulesVersion='new-rules',packet=>packet.context.documents[0].extracted_text='יש לבצע הוראה אחרת.',packet=>packet.historicalContextHash=null]){const packet=input();mutate(packet);assert.ok(!reuse.reusableAnalysisKeys(packet,identity,[oldIdentity]).includes(oldKey));}
});

test('PDFs without demonstrated page coverage, drafts and fragments never qualify for reuse',()=>{
  assert.equal(typeof reuse.reusableAnalysisKeys,'function');for(const change of [{parsed_json:null},{parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:2,readPages:[1],unreadablePages:[]}}},{title:'טיוטה.pdf'},{extracted_text:'קטע מתוך מסמך\nיש לתאם את העבודה.'}]){const packet=input();Object.assign(packet.context.documents[0],change);assert.deepEqual(reuse.reusableAnalysisKeys(packet,identity,[oldIdentity]),[]);}
});

test('a changed runtime profile retains a newly saved accepted analysis and always revalidates its quotation',()=>{
  assert.equal(typeof reuse.reusableAnalysisKeys,'function');const packet=input(),keys=reuse.reusableAnalysisKeys(packet,oldIdentity,[]),checked={sourceId:doc.id,quote:doc.extracted_text};const store={[keys[0]]:{version:'verified-analysis-v1',contextHash:packet.historicalContextHash,value:checked}};
  assert.deepEqual(reuse.findReusableAnalysis(store,packet,identity,[oldIdentity],verified),checked);store[keys[0]].value.quote='цитата, которой нет в документе';assert.equal(reuse.findReusableAnalysis(store,packet,identity,[oldIdentity],verified),null);
});

test('legacy scan signatures preserve their exact historical encoding without changing the context checks',()=>{
  assert.equal(typeof reuse.reusableAnalysisKeys,'function');const packet=input(),fields={engineVersion:'scan-v1',projectId:context.projectId,contractFingerprint:'contract',workFingerprint:'work',relatedWorkFingerprint:'related'};packet.material={format:'scan-memory',fields};const expected=buildScanMemorySignature({...fields,aiIdentity:oldIdentity.provider+':'+oldIdentity.model});assert.ok(reuse.reusableAnalysisKeys(packet,identity,[oldIdentity]).includes(expected));
});

test('a legacy key cannot qualify from a matching file name/date alone or an invented cache shape',()=>{
  assert.equal(typeof reuse.findReusableAnalysis,'function');const packet=input(),oldKey=hash({...material.before,identity:oldIdentity,...material.after});assert.equal(reuse.findReusableAnalysis({[oldKey]:{sourceId:doc.id,quote:'invented'}},packet,identity,[oldIdentity],verified),null);
  packet.context.documents[0].content_hash='b'.repeat(64);assert.equal(reuse.findReusableAnalysis({[oldKey]:{sourceId:doc.id,quote:doc.extracted_text}},packet,identity,[oldIdentity],verified),null);
});
