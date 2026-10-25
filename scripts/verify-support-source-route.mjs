import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const nextServerUrl = pathToFileURL(require.resolve('next/server')).href;
const serverFixtureUrl = 'data:text/javascript,' + encodeURIComponent(
  'let client; export const setClient = value => { client = value; }; export const createClient = async () => client;',
);
const { setClient } = await import(serverFixtureUrl);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/utils/supabase/server') return { url: serverFixtureUrl, shortCircuit: true };
  if (specifier === 'next/server') return nextResolve(nextServerUrl, context);
  return nextResolve(specifier.startsWith('@/')
    ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { GET } = await import('../src/app/api/scan/support-sources/route.ts');
const { loadProjectReferenceAuthority } = await import('../src/utils/document-reference-authority-server.ts');
const { buildDocumentReferenceCheckReport } = await import('../src/utils/document-reference-authority.ts');
hook.deregister();

const reading = { version: 'page-coverage-v1', complete: true, totalPages: 1, readPages: [1], unreadablePages: [] };
const contract = { id: 'contract', project_id: 'p', title: 'מפרט מיוחד.pdf', category: 'CONTRACT', doc_type: 'SPECS',
  extracted_text: 'על עבודות הניקוז יחול פרק 57 של המפרט הכללי מהדורת 2023. לפי תקן ישראלי 1142.',
  parsed_json: { source_reading: reading }, ocr_status: 'COMPLETED', storage_path: '/private/contracts/base.pdf' };
const reference = { id: 'blue', project_id: 'p', title: 'המפרט הכללי', reference_type: 'BLUE_BOOK',
  authority_scope: 'PROJECT', status: 'READY', page_count: 1, source_document_id: null, text_hash: 'fixture-hash' };
const page = { id: 'page-1', reference_document_id: 'blue', chunk_type: 'PAGE', ordinal: 1, page_from: 1,
  section_code: '57', text: 'פרק 57\nמהדורת 2023\nעבודות צנרת וניקוז.' };
const owner = { id: 'owner', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };

function tables(overrides = {}) {
  return structuredClone({
    projects: [{ id: 'p' }],
    documents: [contract, { ...contract, id: 'foreign-document', project_id: 'other' },
      { ...contract, id: 'work-letter', category: 'EXECUTION' }],
    reference_documents: [reference, { ...reference, id: 'foreign-reference', project_id: 'other' }],
    reference_document_chunks: [page], reference_document_incorporations: [],
    pricelists: [{ id: 'price', project_id: 'p', name: 'Fixture price list', is_global: false,
      source_type: 'HOUSING_MINISTRY', version_label: '2025.02', publisher: 'Fixture', parse_status: 'READY' }],
    ...overrides,
  });
}

// Only the external database is replaced. The real route, ownership check,
// source-readiness rules, authority graph and report builder all execute.
function database(data, { user = owner, errorTable = null } = {}) {
  return { auth: { getUser: async () => ({ data: { user }, error: null }) }, from(table) {
    assert.ok(Object.hasOwn(data, table), `Unexpected table: ${table}`);
    const filters = [];
    const ordering = [];
    let columns = '*';
    let range = [0, 999];
    function rows() {
      if (table === errorTable) return { data: null, error: { message: 'Fixture database read failed' } };
      const selected = data[table].filter(row => filters.every(filter => filter(row))).toSorted((a, b) => {
        for (const key of ordering) {
          if (a[key] < b[key]) return -1;
          if (a[key] > b[key]) return 1;
        }
        return 0;
      }).slice(range[0], range[1] + 1);
      return { data: selected.map(row => columns === '*' ? structuredClone(row)
        : Object.fromEntries(columns.split(',').map(column => column.trim()).map(key => [key, row[key] ?? null]))), error: null };
    }
    const query = {
      select(value = '*') { columns = value; return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      neq(key, value) { filters.push(row => row[key] !== value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      or(value) {
        const choices = value.split(',').map(part => {
          const match = part.match(/^(\w+)\.(eq|is)\.(.+)$/);
          assert.ok(match, `Unexpected scope filter: ${part}`);
          const [, key, operator, wanted] = match;
          return operator === 'is' && wanted === 'null' ? row => row[key] == null : row => String(row[key]) === wanted;
        });
        filters.push(row => choices.some(choice => choice(row)));
        return query;
      },
      order(key) { ordering.push(key); return query; },
      range(first, last) { range = [first, last]; return query; },
      async maybeSingle() { const result = rows(); return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve, reject) { return Promise.resolve(rows()).then(resolve, reject); },
    };
    return query;
  } };
}

async function responseFor(data = tables(), options = {}, project = 'p') {
  setClient(database(data, options));
  const response = await GET(new NextRequest('http://localhost/api/scan/support-sources'
    + (project === null ? '' : '?projectId=' + project)));
  return { status: response.status, body: await response.json() };
}

test('the report keeps a fully read PDF as a contract source and exposes its missing standard', async () => {
  const { status, body } = await responseFor();
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.referenceChecks.projectContractDocuments, 1);
  assert.equal(body.referenceChecks.references.length, 1);
  assert.equal(body.referenceChecks.references[0].id, 'blue');
  assert.equal(body.referenceChecks.missingRequiredDocuments.length, 1);
  assert.match(body.referenceChecks.missingRequiredDocuments[0].targetLabel, /1142/);
  assert.equal(body.referenceChecks.eligibleComparisonPages, 1);
  assert.equal(body.priceLists.length, 1);
});

test('the report agrees with normal loading of the same complete source rows', async () => {
  const data = tables();
  const { body } = await responseFor(data);
  const full = await loadProjectReferenceAuthority({ supabase: database(data), projectId: 'p' });
  const report = buildDocumentReferenceCheckReport(full.graph);
  assert.equal(report.projectContractDocuments, 1);
  assert.equal(body.referenceChecks.sourceSignature, full.signature);
  for (const key of ['projectContractDocuments', 'checkedLinks', 'references', 'missingRequiredDocuments', 'issues', 'precedenceEvidence']) {
    assert.deepEqual(body.referenceChecks[key], report[key], `Different ${key} through the report path`);
  }
});

test('the route distinguishes the default book basis from an unverified reference page', async () => {
  const { body } = await responseFor(tables({ documents: [{ ...contract, extracted_text: 'עבודות פיתוח בפרויקט.' }],
    reference_document_chunks: [{ ...page, text: 'תוכן שמספר הפרק ומהדורתו אינם ידועים.' }] }));
  assert.equal(body.referenceChecks.references[0].applicability, 'CONFIRMED');
  assert.equal(body.referenceChecks.references[0].reason, 'system_default_reference');
  assert.equal(body.referenceChecks.eligibleComparisonPages, 0);
});

test('the route keeps a scoped project exclusion with its exact source evidence', async () => {
  const quote = 'פרק 57 של המפרט הכללי לא יחול על העבודה.';
  const { body } = await responseFor(tables({ documents: [{ ...contract, extracted_text: quote }] }));
  assert.equal(body.referenceChecks.references[0].applicability, 'CONFIRMED');
  assert.equal(body.referenceChecks.references[0].contractEvidence[0].quote, quote);
  assert.equal(body.referenceChecks.eligibleComparisonPages, 0);
});

test('an unread or draft PDF cannot silently cancel the default reference base', async () => {
  for (const document of [{ ...contract, parsed_json: {} }, { ...contract, title: 'טיוטה.pdf' }]) {
    const { body } = await responseFor(tables({ documents: [{ ...document, extracted_text: 'המפרט הכללי לא יחול על העבודה.' }] }));
    assert.equal(body.referenceChecks.references[0].applicability, 'CONFIRMED');
    assert.equal(body.referenceChecks.eligibleComparisonPages, 0);
    assert.equal(body.referenceChecks.projectContractDocuments, 0);
  }
});

test('a PDF identified by its storage path cannot bypass incomplete page coverage', async () => {
  const document = { ...contract, title: 'מפרט מיוחד', parsed_json: { source_reading: {
    ...reading, complete: false, totalPages: 2, readPages: [1], unreadablePages: [2],
  } } };
  const { body } = await responseFor(tables({ documents: [document] }));
  assert.equal(body.referenceChecks.projectContractDocuments, 0);
  assert.equal(body.referenceChecks.eligibleComparisonPages, 0);
  assert.ok(body.referenceChecks.issues.some(issue => issue.reason === 'project_source_not_ready'));
});

test('missing status, missing coverage and draft markers never become binding roots', async () => {
  for (const document of [
    { ...contract, ocr_status: null },
    { ...contract, parsed_json: {} },
    { ...contract, title: 'מפרט מיוחד - טיוטה.pdf' },
  ]) {
    const { body } = await responseFor(tables({ documents: [document] }));
    assert.equal(body.referenceChecks.projectContractDocuments, 0);
    assert.equal(body.referenceChecks.eligibleComparisonPages, 0);
    assert.ok(body.referenceChecks.issues.some(issue => issue.reason === 'project_source_not_ready'));
  }
});

test('restoring a readable contract does not admit a different chapter edition', async () => {
  const { body } = await responseFor(tables({ reference_document_chunks: [{ ...page,
    text: 'פרק 57\nמהדורת 2026\nעבודות צנרת וניקוז.',
  }] }));
  assert.equal(body.referenceChecks.projectContractDocuments, 1);
  assert.equal(body.referenceChecks.eligibleComparisonPages, 0);
});

test('additional server reading fields are not added to the public payload', async () => {
  const { body } = await responseFor();
  const payload = JSON.stringify(body);
  assert.ok(!payload.includes('"storage_path"'));
  assert.ok(!payload.includes('"extracted_text"'));
  assert.ok(!payload.includes('/private/contracts/base.pdf'));
});

test('invalid, unauthenticated and unowned requests cannot obtain a successful report', async () => {
  for (const [options, project, expected] of [
    [{}, null, 400], [{ user: null }, 'p', 401], [{}, 'other', 403],
  ]) {
    const { status, body } = await responseFor(tables(), options, project);
    assert.equal(status, expected);
    assert.equal(body.success, false);
    assert.equal(body.referenceChecks, undefined);
  }
});

test('a failed document query is an error rather than an empty successful report', async (context) => {
  context.mock.method(console, 'error', () => {});
  const { status, body } = await responseFor(tables(), { errorTable: 'documents' });
  assert.equal(status, 500);
  assert.equal(body.success, false);
  assert.equal(body.referenceChecks, undefined);
});
