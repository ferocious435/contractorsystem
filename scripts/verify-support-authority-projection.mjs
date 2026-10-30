import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// Only database I/O and model I/O are replaced. The enrichment, source loader,
// readiness, authority graph and output validation remain the production code.
const modelUrl = 'data:text/javascript,' + encodeURIComponent(`
  let response = null; export let calls = 0;
  export function reset(value = null) { response = value; calls = 0; }
  export function getComparisonAiIdentity() { return { kind: 'codex', provider: 'Codex', model: 'fixture' }; }
  export async function generateComparisonText() {
    calls++; if (response === null) throw new Error('Unexpected model call'); return response;
  }
`);
const model = await import(modelUrl);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/server/ai/comparison.server') return { url: modelUrl, shortCircuit: true };
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../src/${specifier.slice(2)}${specifier.endsWith('.json')?'':'.ts'}`, import.meta.url).href, context);
  try { return nextResolve(specifier, context); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/u.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { enrichProjectFindingsWithSupportSources } = await import('../src/utils/support-source-enrichment-server.ts');
const { loadProjectReferenceAuthority } = await import('../src/utils/document-reference-authority-server.ts');
const { supportSourceSignature } = await import('../src/utils/support-source-enrichment.ts');
hook.deregister();
const execution={projectId:'30000000-0000-4000-8000-000000000003',signal:new AbortController().signal,checkActive:async()=>{}};

const reading = { version: 'page-coverage-v1', complete: true, totalPages: 1, readPages: [1], unreadablePages: [] };
const contract = { id: 'contract', project_id: 'p', title: 'מפרט מיוחד.pdf', category: 'CONTRACT', doc_type: 'SPECS',
  ocr_status: 'COMPLETED', storage_path: '/private/base.pdf', extracted_text_hash: 'contract-hash',
  extracted_text: 'על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023.', parsed_json: { source_reading: reading } };
const reference = { id: 'blue', project_id: 'p', title: 'המפרט הכללי', reference_type: 'BLUE_BOOK',
  authority_scope: 'PROJECT', status: 'READY', text_hash: 'reference-hash', source_document_id: null };
const page = { id: 'page', reference_document_id: 'blue', chunk_type: 'PAGE', ordinal: 1, page_from: 1,
  section_code: '57', text: 'פרק 57\nמהדורת 2023\nמילוי חול מצומנט בתעלות.' };
function tables(overrides = {}) {
  return structuredClone({ documents: [contract], contradictions: [], reference_documents: [reference],
    reference_document_chunks: [page], reference_document_incorporations: [], pricelists: [], pricelist_items: [], ...overrides });
}

function database(data, { allowWrites = false } = {}) {
  const reads = [], writes = [];
  return { reads, writes, from(table) {
    assert.ok(Object.hasOwn(data, table), `Unexpected table ${table}`);
    const filters = [], ordering = [];
    let columns = '*', bounds = [0, Infinity], update = null, one = false;
    const query = {
      select(value = '*') { columns = value; reads.push({ table, columns }); return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      neq(key, value) { filters.push(row => row[key] !== value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      not(key, operator, value) { assert.equal(operator, 'is'); filters.push(row => row[key] != value); return query; },
      or(value) {
        const alternatives = value.split(',').map(part => {
          const match = part.match(/^(\w+)\.(eq|is|ilike)\.(.+)$/);
          assert.ok(match, `Unsupported filter ${part}`);
          const [, key, op, wanted] = match;
          if (op === 'is') return row => row[key] == null;
          if (op === 'ilike') return row => String(row[key] || '').includes(wanted.replaceAll('%', ''));
          return row => String(row[key]) === wanted;
        });
        filters.push(row => alternatives.some(f => f(row))); return query;
      },
      order(key) { ordering.push(key); return query; },
      range(first, last) { bounds = [first, last]; return query; },
      limit(count) { bounds[1] = count - 1; return query; },
      update(value) { assert.ok(allowWrites, 'Unexpected database write'); update = structuredClone(value); return query; },
      maybeSingle() { one = true; return query; },
      insert() { throw new Error('Unexpected database insertion'); },
      then(resolve, reject) {
        const rows = data[table].filter(row => filters.every(f => f(row))).toSorted((a, b) => {
          for (const key of ordering) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1; } return 0;
        }).slice(bounds[0], bounds[1] + 1);
        if (update) writes.push({ table, ids: rows.map(row => row.id), value: update });
        const selected = update ? null : rows.map(row => columns === '*' ? structuredClone(row)
          : Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key] ?? null])));
        return Promise.resolve({ data: one ? selected?.[0] ?? null : selected, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}

test('enrichment and ordinary loading retain the same contract authority after column projection', async () => {
  model.reset();
  const data = tables();
  const db = database(data);
  const normal = await loadProjectReferenceAuthority({ supabase: database(data), projectId: 'p' });
  const result = await enrichProjectFindingsWithSupportSources({execution,  supabase: db, projectId: 'p' });
  assert.equal(normal.graph.documents.filter(row => row.role === 'PROJECT_CONTRACT').length, 1);
  assert.equal(result.sourceSignature, supportSourceSignature([normal.signature, ['blue', 'reference-hash', 'READY']]));
  const selected = db.reads.find(row => row.table === 'documents').columns.split(',').map(key => key.trim());
  for (const field of ['ocr_status', 'storage_path', 'doc_type', 'extracted_text_hash']) assert.ok(selected.includes(field), `Missing ${field}`);
  assert.equal(result.total, 0);
  assert.equal(model.calls, 0);
  assert.equal(db.writes.length, 0);
});

const finding = { id: 'finding', project_id: 'p', title: 'מילוי חול מצומנט', description: 'נדרש בירור החומר',
  category: 'שינוי/חריג', status: 'OPEN', strategy_advice: 'לבדוק את החומר', scan_signature: 'fixture-scan',
  evidence_data: { work_quote: 'מילוי חול מצומנט בתעלות', contract_quote: 'מילוי תעלות' } };
const modelResponse = JSON.stringify({ impact_summary: 'נדרש בירור החומר', recommended_action: 'לבדוק את החומר', reference_ids: ['R1'], price_item_ids: [] });

for (const type of ['INVALID_AUTOMATIC_FINDING', 'DUPLICATE']) {
  test(`a ${type} finding cannot receive a new support analysis`, async () => {
    model.reset(modelResponse);
    const data = tables({ contradictions: [{ ...finding, evidence_data: { ...finding.evidence_data, review_disposition: { type } } }] });
    const db = database(data, { allowWrites: true });
    const result = await enrichProjectFindingsWithSupportSources({execution,  supabase: db, projectId: 'p' });
    assert.equal(result.total, 0);
    assert.equal(db.writes.length, 0);
    assert.equal(model.calls, 0);
  });
}

test('a contractually excluded reference cannot enter the model recommendation or stored support evidence', async () => {
  model.reset(modelResponse);
  const data = tables({ documents: [{ ...contract, extracted_text: 'פרק 57 של המפרט הכללי לא יחול על העבודה.' }], contradictions: [finding] });
  const db = database(data, { allowWrites: true });
  const result = await enrichProjectFindingsWithSupportSources({execution,  supabase: db, projectId: 'p' });
  assert.equal(result.failed, 0);
  assert.equal(db.writes.length, 1);
  assert.deepEqual(db.writes[0].value.evidence_data.support_analysis.reference_evidence, []);
  assert.equal(model.calls, 0);
});

test('unverified model prose cannot cancel a contract in the published recommendation',async()=>{
  const fabricated='UNPROVED_CONTRACT_CANCELLATION';
  model.reset(JSON.stringify({impact_summary:fabricated,recommended_action:fabricated,reference_ids:['R1'],price_item_ids:[]}));
  const db=database(tables({contradictions:[finding]}),{allowWrites:true});
  const result=await enrichProjectFindingsWithSupportSources({execution, supabase:db,projectId:'p'});
  assert.equal(result.failed,0); assert.equal(model.calls,1);
  const stored=db.writes[0].value.evidence_data.support_analysis;
  assert.equal(stored.reference_evidence.length,1);
  assert.equal(JSON.stringify(stored).includes(fabricated),false);
  assert.deepEqual(stored.price_evidence,[]);
});

for (const path of ['library', 'fallback']) {
  test(`an unmapped ${path} excerpt cannot bypass a scoped contract exclusion`, async () => {
    model.reset(modelResponse);
    const restrictions = { ...contract, extracted_text: 'פרק 57 של המפרט הכללי לא יחול על העבודה.\nעל העבודה יחול פרק 51 של המפרט הכללי מהדורת 2014.' };
    const unmappedText = 'מילוי חול מצומנט בתעלות ללא כותרת פרק מאומתת.';
    const fallback = { id: 'fallback-book', project_id: 'p', title: 'הספר הכחול.txt', category: 'REFERENCE',
      parsed_json: { reference_family: 'BLUE_BOOK' }, extracted_text_hash: 'fallback-hash', extracted_text: unmappedText };
    const data = tables({ documents: path === 'fallback' ? [restrictions, fallback] : [restrictions],
      contradictions: [finding],
      reference_documents: path === 'fallback' ? [] : [reference],
      reference_document_chunks: path === 'fallback' ? [] : [{ ...page, text: unmappedText }] });
    const db = database(data, { allowWrites: true });
    const result = await enrichProjectFindingsWithSupportSources({execution,  supabase: db, projectId: 'p' });
    assert.equal(result.failed, 0);
    assert.equal(model.calls, 0, 'An unknown scope cannot be asserted to lie outside the exclusion');
    assert.deepEqual(db.writes[0].value.evidence_data.support_analysis.reference_evidence, []);
  });
}
