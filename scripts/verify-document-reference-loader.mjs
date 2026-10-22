import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const loader = await import('../src/utils/document-reference-authority-server.ts');
const authority = await import('../src/utils/document-reference-authority.ts');
hook.deregister();

function database(tables) {
  const calls = [];
  return { calls, from(table) {
    const filters = [];
    let range = [0, 999];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push((row) => row[key] === value); return query; },
      neq(key, value) { filters.push((row) => row[key] !== value); return query; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
      or(filter) {
        const project = filter.match(/project_id\.eq\.([^,]+)/)?.[1];
        assert.ok(project, `unexpected scope ${filter}`);
        filters.push((row) => row.project_id == null || row.project_id === project);
        return query;
      },
      order() { return query; },
      range(from, to) { range = [from, to]; return query; },
      then(resolve, reject) {
        calls.push({ table, range });
        const data = tables[table];
        assert.ok(data, `unexpected table ${table}`);
        return Promise.resolve({ data: data.filter((row) => filters.every((filter) => filter(row))).slice(range[0], range[1] + 1), error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}

const contract = { id: 'contract', project_id: 'p', title: 'מפרט מיוחד', category: 'CONTRACT',
  extracted_text: 'על עבודות הניקוז יחול פרק 57 של המפרט הכללי מהדורת 2023.' };
const reference = { id: 'blue', project_id: 'p', reference_type: 'BLUE_BOOK', title: 'המפרט הכללי', status: 'READY' };
const page = (index) => ({ id: `page-${index}`, reference_document_id: 'blue', chunk_type: 'PAGE', ordinal: index,
  page_from: index, text: 'פרק 57\nמהדורת 2023\nעבודות צנרת וניקוז.', section_code: '999', metadata: {} });
const tables = (overrides = {}) => ({ documents: [contract], reference_documents: [reference],
  reference_document_incorporations: [], reference_document_chunks: [page(1)], ...overrides });

test('a draft or a PDF without verified page coverage cannot make a reference contractually binding', async () => {
  for (const document of [
    { ...contract, title: 'מפרט מיוחד - טיוטה.docx', ocr_status: 'COMPLETED' },
    { ...contract, title: 'מפרט מיוחד.pdf', ocr_status: 'COMPLETED' },
  ]) {
    const result = await loader.loadProjectReferenceAuthority({ supabase: database(tables({ documents: [document] })), projectId: 'p' });
    assert.notEqual(authority.resolveDocumentReferenceAuthority(result.graph, {
      targetDocumentId: 'blue', sectionCode: '57', edition: '2023', requireEdition: true,
    }).applicability, 'CONFIRMED');
    assert.ok(result.graph.issues.some((issue) => issue.reason === 'project_source_not_ready'));
  }
});

test('a complete PDF retains its incorporation proof after all its pages were read', async () => {
  const document = { ...contract, title: 'מפרט מיוחד.pdf', ocr_status: 'COMPLETED',
    parsed_json: { source_reading: { version: 'page-coverage-v1', complete: true,
      totalPages: 1, readPages: [1], unreadablePages: [] } } };
  const result = await loader.loadProjectReferenceAuthority({ supabase: database(tables({ documents: [document] })), projectId: 'p' });
  assert.equal(authority.resolveDocumentReferenceAuthority(result.graph, {
    targetDocumentId: 'blue', sectionCode: '57', edition: '2023', requireEdition: true,
  }).applicability, 'CONFIRMED');
});

test('a reference from a readable contract cannot use an unread PDF as an intermediate binding source', async () => {
  const root = { ...contract, id: 'root', title: 'הסכם.txt', extracted_text: 'על העבודה יחול נספח תנאים.' };
  const unread = { ...contract, title: 'נספח תנאים.pdf', ocr_status: 'COMPLETED' };
  const result = await loader.loadProjectReferenceAuthority({ supabase: database(tables({ documents: [root, unread] })), projectId: 'p' });
  assert.notEqual(authority.resolveDocumentReferenceAuthority(result.graph, {
    targetDocumentId: 'blue', sectionCode: '57', edition: '2023', requireEdition: true,
  }).applicability, 'CONFIRMED');
});

test('the production loader reads all pages, respects project scope and excludes work evidence as roots', async () => {
  const wrongProject = { ...reference, id: 'foreign', project_id: 'other' };
  const work = { ...contract, id: 'letter', title: 'מכתב לחוזה', category: 'EXECUTION' };
  const db = database(tables({ documents: [contract, work], reference_documents: [reference, wrongProject],
    reference_document_chunks: Array.from({ length: 501 }, (_, i) => page(i + 1)) }));
  const result = await loader.loadProjectReferenceAuthority({ supabase: db, projectId: 'p' });
  assert.equal(result.graph.documents.find((row) => row.id === 'blue').clauses.length, 501);
  assert.equal(result.graph.documents.some((row) => row.id === 'foreign'), false);
  assert.equal(result.graph.documents.some((row) => row.id === 'letter' && row.role === 'PROJECT_CONTRACT'), false);
  assert.equal(db.calls.filter((call) => call.table === 'reference_document_chunks').length, 2);
  assert.equal(result.graph.documents.find((row) => row.id === 'blue').clauses[0].sectionCode, '57');
});

test('a stale declared source ID is mapped to its library copy without making that copy a project root', async () => {
  const stub = { id: 'shelf-stub', project_id: 'p', title: 'חוזה-מדף-3210.pdf', category: 'CONTRACT',
    parsed_json: { category: 'REFERENCE', is_reference: true }, extracted_text: '3210 ספריית ייחוס' };
  const shelf = { id: 'shelf', source_document_id: 'shelf-stub', project_id: 'p', title: 'חוזה מדף 3210', reference_type: 'SHELF_CONTRACT_3210', status: 'READY' };
  const quote = 'על עבודות הניקוז יחול פרק 57 של המפרט הכללי מהדורת 2023.';
  const db = database(tables({ documents: [stub], reference_documents: [reference, shelf],
    reference_document_chunks: [page(1), { ...page(2), reference_document_id: 'shelf', text: quote }],
    reference_document_incorporations: [{ project_id: 'p', reference_document_id: 'blue', incorporated_by_document_id: 'shelf-stub', quote, status: 'CONFIRMED' }] }));
  const result = await loader.loadProjectReferenceAuthority({ supabase: db, projectId: 'p' });
  assert.equal(result.graph.documents.find((row) => row.id === 'shelf').role, 'REFERENCE');
  assert.notEqual(authority.resolveDocumentReferenceAuthority(result.graph, {
    targetDocumentId: 'blue', sectionCode: '57', edition: '2023', requireEdition: true,
  }).applicability, 'CONFIRMED');
});

test('an incomplete document preview cannot establish authority when no complete pages exist', async () => {
  const db = database(tables({ reference_document_chunks: [{ ...page(0), chunk_type: 'DOCUMENT', metadata: { truncated: true } }] }));
  const result = await loader.loadProjectReferenceAuthority({ supabase: db, projectId: 'p' });
  assert.equal(result.graph.documents.find((row) => row.id === 'blue').clauses.length, 0);
  assert.ok(result.graph.issues.some((issue) => issue.reason === 'reference_text_unavailable'));
});

test('changing the binding project text changes the authority signature', async () => {
  const first = await loader.loadProjectReferenceAuthority({ supabase: database(tables()), projectId: 'p' });
  const changed = { ...contract, extracted_text: contract.extracted_text.replace('2023', '2026') };
  const second = await loader.loadProjectReferenceAuthority({ supabase: database(tables({ documents: [changed] })), projectId: 'p' });
  assert.notEqual(first.signature, second.signature);
});

test('initial comparisons reuse the reference index but immediately respect changed project contract text', async () => {
  const db = database(tables());
  const first = await loader.loadProjectBoundReferenceDocuments({ supabase: db, projectId: 'p', documents: [contract] });
  assert.equal(first.length, 1);
  const reads = db.calls.filter((call) => call.table === 'reference_document_chunks').length;
  const second = await loader.loadProjectBoundReferenceDocuments({ supabase: db, projectId: 'p', documents: [contract] });
  assert.equal(second.length, 1);
  assert.equal(db.calls.filter((call) => call.table === 'reference_document_chunks').length, reads);
  const changed = { ...contract, extracted_text: contract.extracted_text.replace('2023', '2026') };
  assert.equal((await loader.loadProjectBoundReferenceDocuments({ supabase: db, projectId: 'p', documents: [changed] })).length, 0);
});
