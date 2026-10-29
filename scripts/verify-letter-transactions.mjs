import './redesign/load-ui.mjs';
import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {runLettersSql,jsonSql,verifyTestTarget} from './letters-db.mjs';
import {createSyntheticLetterClient,seedLettersTestData,syntheticIds as id} from './fixtures/letter-rpc-test-adapter.mjs';
const client=createSyntheticLetterClient();
const fixture=JSON.parse(readFileSync(new URL('./fixtures/letter-financial-cases.json',import.meta.url),'utf8'));
const auth={role:'authenticated',userId:id.userA};
const quoteWork='לבצע צינור בקוטר 200';
const quoteContract='לבצע צינור בקוטר 100';
beforeEach(()=>seedLettersTestData());
const preview=(items=[id.rowA,id.rowB,id.rowC],docType='general',c=client)=>c.rpc('preview_letter_draft',{p_project_id:id.projectA,p_doc_type:docType,p_item_ids:items});
function saveInput(previewValue,patch={}){return {p_project_id:id.projectA,p_client_draft_id:randomUUID(),p_expected_revision:0,p_operation_id:randomUUID(),p_subject:'Synthetic letter',p_recipient_name:'Synthetic recipient',p_doc_type:'general',p_content:'טקסט לבדיקה בלבד',p_item_ids:[id.rowA,id.rowB,id.rowC],p_expected_sources:previewValue.sourceRevisions,...patch};}
const save=input=>client.rpc('save_letter_draft',input);
const sent=(saved,patch={})=>client.rpc('mark_letter_sent',{p_project_id:id.projectA,p_letter_id:saved.letterId,p_expected_revision:saved.revision,p_operation_id:randomUUID(),...patch});
async function savedDraft(){const p=await preview();assert.equal(p.error,null);const input=saveInput(p.data);const result=await save(input);assert.equal(result.error,null);return {saved:result.data,input};}
const state=()=>jsonSql("select jsonb_build_object('letters',(select jsonb_agg(to_jsonb(t) order by id) from public.vo_letters t),'links',(select jsonb_agg(to_jsonb(t) order by id) from public.vo_letter_items t),'ledger',(select jsonb_agg(to_jsonb(t) order by id) from public.pricing_ledger t));");

test('actual SQL preview sums individual money and preserves requested order and duplicate handling',async()=>{
 const result=await preview([id.rowB,id.rowA,id.rowC,id.rowB]);assert.equal(result.error,null);
 assert.deepEqual(result.data.snapshot.totals,{net:.09,vat:.03,gross:.12});
 assert.deepEqual(result.data.snapshot.items.map(item=>item.ledgerItemId),[id.rowB,id.rowA,id.rowC]);
 assert.equal(result.data.snapshot.items[0].sources[0].basis,'MANUAL');
});
test('same JSON money cases pass real PostgreSQL and the TypeScript calculator',async()=>{
 const {prepareLetterFinancialSnapshot}=await import('../src/utils/letter-financials.ts');
 for(const item of fixture.cases){const row={id:id.rowA,type:'PENDING_VO',quantity:item.quantity,unit_price_excl_vat:item.unitPrice,vat_rate:item.vatRate,evidence_data:{individual_pricing_terms:{version:'individual-pricing-v1',basis:'MANUAL',includes_adjustments:true,quantity:item.quantity,unit_price_excl_vat:item.unitPrice,vat_rate:item.vatRate,note:'all terms included'}}};
  const sql=jsonSql("select public.letter_individual_pricing(:'row'::jsonb);",{...auth,params:{row:JSON.stringify(row)}});
  assert.deepEqual({net:sql.net,vat:sql.vat,gross:sql.gross},item.expected,item.id);
  assert.deepEqual(prepareLetterFinancialSnapshot([row]).snapshot.totals,item.expected,item.id);
 }
});
test('save is one DRAFT and retry is idempotent; ledger is unchanged until manual sent',async()=>{
 const {saved,input}=await savedDraft();assert.equal(saved.status,'DRAFT');assert.equal(saved.revision,1);assert.equal(saved.sentMarkedAt,null);
 const retry=await save(input);assert.equal(retry.error,null);assert.deepEqual(retry.data,saved);
 assert.equal(state().letters.length,2);assert.ok(state().ledger.every(row=>row.type==='PENDING_VO'));
 const operation=randomUUID();const marked=await sent(saved,{p_operation_id:operation});assert.equal(marked.error,null);
 assert.equal(marked.data.status,'SENT');assert.equal(marked.data.revision,2);assert.ok(marked.data.sentMarkedAt);
 assert.deepEqual(marked.data.snapshot,saved.snapshot);
 const repeated=await sent(saved,{p_operation_id:operation});assert.deepEqual(repeated,marked);
});
test('revision conflicts, stale repeats and changed operation payload preserve the newer text',async()=>{
 const {saved,input}=await savedDraft();
 assert.equal((await save({...input,p_content:'different same operation'})).error?.code,'PT409');
 const edit={...input,p_expected_revision:1,p_operation_id:randomUUID(),p_content:'עריכה שמורה'};
 const updated=await save(edit);assert.equal(updated.error,null);assert.equal(updated.data.letterId,saved.letterId);assert.equal(updated.data.revision,2);
 const before=state();for(const request of [input,{...edit,p_operation_id:randomUUID()}])assert.equal((await save(request)).error?.code,'PT409');
 assert.deepEqual(state(),before);
});
test('foreign owner, anon and foreign row fail without any write',async()=>{
 const before=state();
 assert.equal((await preview(undefined,'general',createSyntheticLetterClient({userId:id.userB}))).error?.code,'42501');
 assert.equal((await preview(undefined,'general',createSyntheticLetterClient({userId:null}))).error?.code,'42501');
 assert.equal((await preview([id.rowA,id.foreign])).error?.code,'PT422');assert.deepEqual(state(),before);
});
test('changed price or changed evidence quote conflicts with a saved snapshot',async()=>{
 const {saved,input}=await savedDraft();
 runLettersSql(`update public.pricing_ledger set description='changed selection' where id='${id.rowA}';`);
 const before=state();assert.equal((await sent(saved)).error?.code,'PT409');assert.equal((await save({...input,p_expected_revision:1,p_operation_id:randomUUID()})).error?.code,'PT409');assert.deepEqual(state(),before);
 const p=await preview([id.official],'official_vo');assert.equal(p.error,null);
 const official=await save(saveInput(p.data,{p_item_ids:[id.official],p_doc_type:'official_vo'}));assert.equal(official.error,null);
 runLettersSql(`update public.contradictions set evidence_data=jsonb_set(evidence_data,'{work_quote}','"changed quote"') where id='${id.finding}';`);
 assert.equal((await sent(official.data)).error?.code,'PT409');
});
test('two overlapping drafts cannot mark the same work sent twice',async()=>{
 const one=await savedDraft(),two=await savedDraft();assert.equal((await sent(one.saved)).error,null);
 const before=state();assert.equal((await sent(two.saved)).error?.code,'PT409');assert.deepEqual(state(),before);
});
test('official evidence uses real sources and ignores untrusted official content',async()=>{
 const p=await preview([id.official],'official_vo');assert.equal(p.error,null);
 assert.ok(p.data.snapshot.items[0].sources.every(source=>source.status==='VERIFIED'));
 const result=await save(saveInput(p.data,{p_item_ids:[id.official],p_doc_type:'official_vo',p_content:'FORGED CLIENT CONTENT'}));assert.equal(result.error,null);
 const content=state().letters.find(letter=>letter.id===result.data.letterId).content;assert.ok(content.includes(quoteWork));assert.ok(!content.includes('FORGED CLIENT CONTENT'));
 runLettersSql(`update public.documents set extracted_text='unrelated text' where id='${id.work}';`);
 assert.equal((await preview([id.official],'official_vo')).error?.code,'PT422');
});
test('injected failure after header insert or relationship insert rolls back the entire save',async()=>{
 const p=await preview();assert.equal(p.error,null);
 for(const table of ['vo_letters','vo_letter_items']){
  runLettersSql(`create function public.test_fail_letter_write() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_FAILURE'; end; $$; create trigger test_write_failure after insert on public.${table} for each row execute function public.test_fail_letter_write();`);
  try{const before=state();assert.ok((await save(saveInput(p.data))).error);assert.deepEqual(state(),before);}
  finally{runLettersSql(`drop trigger test_write_failure on public.${table};drop function public.test_fail_letter_write();`);}
 }
});
test('injected failure midway through sent rolls back status and every ledger transition',async()=>{
 const {saved}=await savedDraft();
 runLettersSql(`create function public.test_fail_letter_sent() returns trigger language plpgsql as $$ begin if new.id='${id.rowC}'::uuid then raise exception 'SYNTHETIC_FAILURE'; end if; return new; end; $$;create trigger test_sent_failure after update on public.pricing_ledger for each row execute function public.test_fail_letter_sent();`);
 try{const before=state();assert.ok((await sent(saved)).error);assert.deepEqual(state(),before);}
 finally{runLettersSql('drop trigger test_sent_failure on public.pricing_ledger;drop function public.test_fail_letter_sent();');}
});
test('referenced ledger cannot be deleted and sent snapshots cannot be edited',async()=>{
 const {saved,input}=await savedDraft();assert.throws(()=>runLettersSql(`delete from public.pricing_ledger where id='${id.rowA}';`,auth),/23503/);
 assert.equal((await sent(saved)).error,null);assert.equal((await save({...input,p_expected_revision:2,p_operation_id:randomUUID()})).error?.code,'PT409');
});
test('legacy SENT keeps unknown fields and a legacy writer fails before insertion',()=>{
 const legacy=jsonSql(`select to_jsonb(t) from public.vo_letters t where id='${id.legacy}';`);
 assert.equal(legacy.content,'Historical text');assert.equal(legacy.status,'SENT');assert.equal(legacy.calculation_version,null);assert.equal(legacy.sent_marked_at,null);assert.equal(legacy.vat_amount,null);
 const before=state();assert.throws(()=>runLettersSql(`insert into public.vo_letters(project_id,letter_number,subject,status,content) values('${id.projectA}','BAD','old client','SENT','bad');`,auth));assert.deepEqual(state(),before);
});
test('harness refuses an unlabelled target before executing SQL',()=>assert.throws(()=>verifyTestTarget('not-this-test-container')));
test('unknown or unsafe money and unresolved source terms are rejected inside SQL itself',()=>{
 for(const patch of [{quantity:null},{unit_price_excl_vat:null},{vat_rate:null},{total_price_excl_vat:9},
  {quantity:1e200,unit_price_excl_vat:1e200},{unit_price_excl_vat:1e14},{evidence_data:{}}]){
  const row={id:id.rowA,type:'PENDING_VO',quantity:1,unit_price_excl_vat:.03,vat_rate:.18,
   evidence_data:{individual_pricing_terms:{version:'individual-pricing-v1',basis:'MANUAL',includes_adjustments:true,quantity:1,unit_price_excl_vat:.03,vat_rate:.18}},...patch};
  assert.throws(()=>jsonSql("select public.letter_individual_pricing(:'row'::jsonb);",{...auth,params:{row:JSON.stringify(row)}}));
 }
});
test('official PDF without page coverage and a technical exclusion cannot become verified',async()=>{
 runLettersSql(`update public.documents set title='Synthetic work.pdf',parsed_json='{}' where id='${id.work}';`);
 assert.equal((await preview([id.official],'official_vo')).error?.code,'PT422');
 runLettersSql(`update public.documents set title='Synthetic work.txt' where id='${id.work}';update public.contradictions set evidence_data=jsonb_set(evidence_data,'{review_disposition}','{"type":"DUPLICATE"}') where id='${id.finding}';`);
 assert.equal((await preview([id.official],'official_vo')).error?.code,'PT422');
});
test('direct table writes cannot forge a snapshot or edit a sent document',async()=>{
 const {saved}=await savedDraft();
 assert.throws(()=>runLettersSql(`update public.vo_letters set total_amount_incl_vat=99 where id='${saved.letterId}';`,auth));
 assert.equal((await sent(saved)).error,null);
 assert.throws(()=>runLettersSql(`update public.vo_letters set content='changed sent' where id='${saved.letterId}';`,auth));
});
test('changed actual price invalidates the old preview as a conflict even when terms become stale',async()=>{
 const {saved,input}=await savedDraft();
 runLettersSql(`update public.pricing_ledger set unit_price_excl_vat=.04 where id='${id.rowA}';`);
 const before=state();
 assert.equal((await save({...input,p_expected_revision:1,p_operation_id:randomUUID()})).error?.code,'PT409');
 assert.equal((await sent(saved)).error?.code,'PT409');assert.deepEqual(state(),before);
});
test('a saved source-based price without an available document never invents a manual confirmation',async()=>{
 runLettersSql(`update public.pricing_ledger set evidence_data='{"pricing_approval":{"quantity":1,"effective_unit_price_excl_vat":0.03,"total_excl_vat":0.03},"pricing_evaluation":{"scope_review":{"version":"price-scope-v1","status":"FULL","requiresReview":false,"issues":[],"uncoveredRequirementIds":[],"lines":[{"coefficients":[]}]}}}' where id='${id.rowA}';`);
 const p=await preview([id.rowA]);assert.equal(p.error,null);
 const source=p.data.snapshot.items[0].sources[0];
 assert.equal(source.basis,'DOCUMENT');assert.equal(source.manualNote,null);assert.equal(source.status,'REQUIRES_VERIFICATION');
});
test('failure after replacing existing draft links restores the previous revision and all relationships',async()=>{
 const {input}=await savedDraft();
 runLettersSql(`create function public.test_fail_letter_update() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_UPDATE_FAILURE';end;$$;create trigger test_update_failure after insert on public.vo_letter_items for each row execute function public.test_fail_letter_update();`);
 try{const before=state();assert.ok((await save({...input,p_expected_revision:1,p_operation_id:randomUUID(),p_content:'edit lost'})).error);assert.deepEqual(state(),before);}
 finally{runLettersSql('drop trigger test_update_failure on public.vo_letter_items;drop function public.test_fail_letter_update();');}
});
test('simultaneous database writers accept exactly one edit of a revision',async()=>{
 const {input}=await savedDraft();
 const run=request=>new Promise((resolve,reject)=>{
  const script="import{readFileSync}from'node:fs';import{createSyntheticLetterClient}from'./scripts/fixtures/letter-rpc-test-adapter.mjs';console.log(JSON.stringify(await createSyntheticLetterClient().rpc('save_letter_draft',JSON.parse(readFileSync(0,'utf8')))));";
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true});let out='',err='';
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);
  child.on('exit',code=>code?reject(Error(err)):resolve(JSON.parse(out)));child.stdin.end(JSON.stringify(request));
 });
 const results=await Promise.all(['one','two'].map(p_content=>run({...input,p_expected_revision:1,p_operation_id:randomUUID(),p_content})));
 assert.equal(results.filter(result=>result.data?.revision===2).length,1);
 assert.equal(results.filter(result=>result.error?.code==='PT409').length,1);
});
test('unknown or disguised official document types cannot bypass SQL admission',async()=>{
 for(const type of ['official_vo ','OFFICIAL_VO','unknown'])assert.equal((await preview([id.rowA],type)).error?.code,'PT422');
});
test('SQL source readability matches deterministic document checks on short, draft and incomplete sources',async()=>{
 const {assessDocumentSourceReadiness}=await import('../src/utils/document-source-readiness.ts');
 const docs=[{title:'source.txt',extracted_text:'לבצע צינור',ocr_status:'COMPLETED'},
  {title:'source.txt',extracted_text:'source.pdf'},{title:'source.txt',extracted_text:'N-100'},
  {title:'source.txt',extracted_text:'Page 1 of 2'},{title:'source draft',extracted_text:'לבצע צינור'},
  {title:'source.txt',extracted_text:'Draft - for review only\nלבצע צינור'},
  {title:'source.txt',extracted_text:'fragment of a longer document\nלבצע צינור'},
  {title:'source.pdf',extracted_text:'לבצע צינור',ocr_status:'COMPLETED'},
  {title:'source.pdf',extracted_text:'לבצע צינור',ocr_status:'COMPLETED',parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:0,readPages:[],unreadablePages:[]}}},
  {title:'source.pdf',extracted_text:'לבצע צינור',ocr_status:'COMPLETED',parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:2,readPages:[1,2],unreadablePages:[]}}},
  {title:'source.pdf',extracted_text:'לבצע צינור',ocr_status:'COMPLETED',parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:2,readPages:[1],unreadablePages:[2]}}},
  {title:'source.docx',extracted_text:'לבצע צינור',ocr_status:'COMPLETED',parsed_json:{source_reading:{version:'docx-image-coverage-v1',complete:true,sourceHash:'a'.repeat(64),expectedImageReferences:0,images:[],issues:[]}}},
 ];
 for(const doc of docs){const actual=jsonSql("select to_jsonb(public.letter_document_readable(:'document'::jsonb));",{...auth,params:{document:JSON.stringify(doc)}});
  assert.equal(actual,assessDocumentSourceReadiness(doc).canCompare,JSON.stringify(doc));}
});
