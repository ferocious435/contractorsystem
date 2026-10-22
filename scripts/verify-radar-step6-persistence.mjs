import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
let service;
try { service = await import('../src/utils/radar-saved-finding-review-server.ts'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
hook.deregister();
const workText = 'המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.';
const baseText = 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.';
function database() {
  const state = { contradictions: [{ id: 'finding', xmin: '1', project_id: 'project', scan_signature: 'scan',
    title: 'דרישת חומר לעטיפת הצינור', description: workText, category: 'סתירה', severity: 'HIGH', strategy_advice: 'בדוק את דרישות המילוי',
    status: 'OPEN', source_execution_doc_id: 'work', target_contract_doc_id: 'base', evidence_data: { work_quote: workText, contract_quote: baseText } }],
    documents: [{ id: 'work', project_id: 'project', extracted_text: workText }, { id: 'base', project_id: 'project', category: 'CONTRACT', extracted_text: baseText }],
    document_scan_state: [{ project_id: 'project', scan_signature: 'scan', findings_count: 1 }],
    pricing_ledger: [], vo_letters: [], vo_letter_items: [] };
  const writes = [];
  return { state, writes, from(table) {
    const filters = []; let patch, bounds = [0, 499];
    const q = { select() { return q; }, order() { return q; }, range(a,b) { bounds=[a,b]; return q; },
      in(k,vs) { filters.push(r => vs.includes(r[k])); return q; }, eq(k,v) { filters.push(r=>r[k]===v); return q; },
      neq(k,v) { if(k==='status'&&!['OPEN','IGNORED','MOVED_TO_PRICING','AUTO_RESOLVED','ARCHIVED'].includes(v))throw new Error('invalid input value for enum contradiction_status'); filters.push(r=>r[k]!==v); return q; }, update(p) { patch=p; return q; },
      then(resolve,reject) { try {
        assert.ok(Object.hasOwn(state,table), table);
        const rows=state[table].filter(r=>filters.every(f=>f(r))).slice(bounds[0],bounds[1]+1);
        if(patch) for(const r of rows) { assert.ok(['contradictions','document_scan_state'].includes(table));
          writes.push({table,id:r.id}); Object.assign(r,structuredClone(patch)); if(table==='contradictions')r.xmin=String(Number(r.xmin)+1); }
        return Promise.resolve({data:structuredClone(rows),error:null}).then(resolve,reject);
      } catch(e) { return Promise.reject(e).then(resolve,reject); } },
    }; return q;
  } };
}
const run = (...args) => { assert.ok(service, 'product must provide a preview before applying saved finding changes'); return service.reviewSavedRadarFindings(...args); };
test('saved review preview is read only; apply is scoped and a repeated apply produces no UPDATE', async () => {
  const db=database(), before=structuredClone(db.state);
  const preview=await run(db,'project',{findingIds:['finding']});
  assert.equal(preview.plans[0].outcome,'CONFIRMED');
  assert.deepEqual(db.state,before); assert.deepEqual(db.writes,[]);
  const applied=await run(db,'project',{findingIds:['finding'],apply:true,reviewToken:preview.reviewToken});
  assert.equal(applied.updated,1); assert.equal(db.state.contradictions[0].status,'OPEN');
  const first=structuredClone(db.state), count=db.writes.length;
  const repeat=await run(db,'project',{findingIds:['finding']});
  assert.equal((await run(db,'project',{findingIds:['finding'],apply:true,reviewToken:repeat.reviewToken})).updated,0);
  assert.deepEqual(db.state,first); assert.equal(db.writes.length,count);
  assert.deepEqual(db.state.documents,before.documents);
});
test('a changed source or finding makes the reviewed proposal stale before any write', async () => {
  for(const changed of ['documents','contradictions']) {
    const db=database(), preview=await run(db,'project',{findingIds:['finding']});
    if(changed==='documents')db.state.documents[0].extracted_text+='\nעדכון חדש'; else db.state.contradictions[0].xmin='2';
    const before=structuredClone(db.state);
    await assert.rejects(run(db,'project',{findingIds:['finding'],apply:true,reviewToken:preview.reviewToken}),/changed|stale/i);
    assert.deepEqual(db.state,before); assert.deepEqual(db.writes,[]);
  }
});
test('unknown or foreign target is rejected instead of reviewing a wider scope', async () => {
  const db=database();
  await assert.rejects(run(db,'project',{findingIds:['foreign']}),/not found/i);
  assert.deepEqual(db.writes,[]);
});
test('default saved review leaves unrelated resolved and archived project history outside its scope',async()=>{
  const db=database();
  for(const status of ['AUTO_RESOLVED','IGNORED','ARCHIVED'])db.state.contradictions.push({...structuredClone(db.state.contradictions[0]),id:status,status});
  const preview=await run(db,'project');
  assert.deepEqual(preview.findingIds,['finding']);
  assert.deepEqual(db.writes,[]);
});
test('the review summary does not count excluded records with incomplete reading as open questions',async()=>{
  const db=database(),base=db.state.documents.find(d=>d.id==='base');
  db.state.documents.push({id:'unread',project_id:'project',title:'unread.pdf',storage_path:'unread.pdf',ocr_status:'COMPLETED',parsed_json:{},extracted_text:base.extracted_text});
  db.state.contradictions.push({...structuredClone(db.state.contradictions[0]),id:'excluded',source_execution_doc_id:'unread',
    evidence_data:{work_quote:base.extracted_text,contract_quote:base.extracted_text,review_disposition:{type:'INVALID_AUTOMATIC_FINDING'}}});
  const result=await run(db,'project');
  assert.equal(result.confirmed,1);assert.equal(result.excluded,1);assert.equal(result.requiresReview,0);
});
