import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import './radar-point-1-3-harness.mjs';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const cleanup = await import('../src/utils/scan-finding-retention.ts');
const finance = await import('../src/utils/radar-issue-reconciliation-server.ts');
hook.deregister();

const quotes = ['נדרש לשנות את שיטת הקידוח ברחוב ספיר מדחיקת צנרת פיברגלס לקידוח HDD.',
  'ברחוב ספיר נדרש מעבר לקידוח HDD במקום דחיקת צנרת פיברגלס.'];
function database({ failId, concurrentId, invalidOld = false } = {}) {
  const state = {
    contradictions: quotes.map((quote, index) => ({ id: `finding-${index}`, project_id: 'project', title: 'שינוי שיטת קידוח ברחוב ספיר',
      xmin: '1',
      status: index && invalidOld ? 'ARCHIVED' : 'OPEN', scan_signature: `scan-${index}`,
      source_execution_doc_id: `document-${index}`, pricing_status: index && invalidOld ? 'PRICED' : 'PENDING',
      evidence_data: { work_quote: quote, ...(index && invalidOld ? { manual_review: { keep: 'human note' },
        archive_meta: { archived_at: 'keep' }, pricing_evaluation: { amount: 123 } } : { issue_owner_notes: [{ text: 'keep' }] }) } })),
    documents: quotes.map((quote, index) => ({ id: `document-${index}`, project_id: 'project', title: 'פרוטוקול.docx',
      extracted_text: index && invalidOld ? 'הגנת עמוד חשמל' : quote })),
    pricing_ledger: invalidOld ? [{ id: 'ledger', project_id: 'project', contradiction_id: 'finding-1', amount: 123 }] : [],
    vo_letter_items: invalidOld ? [{ id: 'item', ledger_item_id: 'ledger', letter_id: 'letter' }] : [],
    vo_letters: invalidOld ? [{ id: 'letter', project_id: 'project', subject: 'keep', content: 'unchanged letter' }] : [],
    document_scan_state: [{ project_id: 'project', scan_signature: 'scan-1', findings_count: 1 }],
  }, writes = [];
  state.contradictions.push({ id: 'other-project', project_id: 'someone-else', source_execution_doc_id: 'document-0',
    evidence_data: { work_quote: quotes[0] } });
  return { state, writes, from(table) {
    assert.ok(Object.hasOwn(state, table), `Unexpected table ${table}`);
    const filters = []; let patch, range = [0, 499];
    const query = { select() { return query; }, order() { return query; }, range(start, end) { range = [start, end]; return query; },
      eq(key, value) { assert.notEqual(key, 'evidence_data', 'Do not send a full saved history in the URL'); filters.push(row => row[key] === value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      neq(key, value) { filters.push(row => row[key] !== value); return query; },
      update(value) { patch = value; return query; },
      then(resolve, reject) {
        try {
          const matches = state[table].filter(row => filters.every(filter => filter(row))).slice(range[0], range[1] + 1);
          if (patch && failId && matches.some(row => row.id === failId)) return Promise.resolve({ data: null, error: { message: 'history save failed' } }).then(resolve, reject);
          if (patch && concurrentId && matches.some(row => row.id === concurrentId)) return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          if (patch) for (const row of matches) {
            if (table === 'contradictions') assert.deepEqual(Object.keys(patch), ['evidence_data']);
            else { assert.equal(table, 'document_scan_state'); assert.deepEqual(Object.keys(patch).sort(), ['findings_count', 'updated_at']); }
            assert.equal(row.project_id, 'project');
            writes.push(row.id); Object.assign(row, structuredClone(patch));
            if (table === 'contradictions') row.xmin = String(Number(row.xmin) + 1);
          }
          return Promise.resolve({ data: structuredClone(matches), error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    }; return query;
  } };
}

test('reconciliation preview does not write; apply keeps all records and saves history before duplicate markers', async () => {
  const db = database(), before = structuredClone(db.state);
  const preview = await cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: 'finding-0' });
  assert.equal(preview.plans.length, 1);
  assert.deepEqual(db.state, before);
  const applied = await cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: 'finding-0', apply: true });
  assert.equal(applied.updated, 2);
  assert.equal(applied.duplicates, 1);
  assert.equal(db.writes[0], applied.plans[0].canonicalId);
  assert.equal(db.state.contradictions.length, before.contradictions.length);
  assert.equal(db.state.document_scan_state[0].findings_count, 0);
  assert.deepEqual(db.state.documents, before.documents);
  assert.deepEqual(db.state.contradictions.at(-1), before.contradictions.at(-1));
  const first = structuredClone(db.state);
  const repeated = await cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: 'finding-0', apply: true });
  assert.equal(repeated.updated, 0);
  assert.deepEqual(db.state, first);
});

test('priced_wrong_source_is_flagged_not_deleted: financial rows, letter and manual history are unchanged', async () => {
  const db = database({ invalidOld: true }), before = structuredClone(db.state);
  const result = await cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: 'finding-0', apply: true });
  assert.equal(result.invalid, 1);
  const old = db.state.contradictions.find(row => row.id === 'finding-1'), previous = before.contradictions.find(row => row.id === 'finding-1');
  assert.equal(old.evidence_data.review_disposition.type, 'INVALID_AUTOMATIC_FINDING');
  assert.equal(old.evidence_data.review_disposition.canonical_id, 'finding-0');
  assert.equal(old.evidence_data.source_verification.work_quote_matched, false);
  for (const key of ['status', 'pricing_status', 'source_execution_doc_id']) assert.equal(old[key], previous[key]);
  for (const key of ['manual_review', 'archive_meta', 'pricing_evaluation', 'work_quote']) assert.deepEqual(old.evidence_data[key], previous.evidence_data[key]);
  for (const key of ['pricing_ledger', 'vo_letter_items', 'vo_letters', 'documents']) assert.deepEqual(db.state[key], before[key]);
  const primary = db.state.contradictions.find(row => row.id === 'finding-0');
  assert.deepEqual(primary.evidence_data.issue_owner_notes, before.contradictions[0].evidence_data.issue_owner_notes);
  assert.deepEqual(primary.evidence_data.issue_reconciliation.financialLinks, [{ findingId: 'finding-1', ledgerId: 'ledger', letterIds: ['letter'] }]);
});

test('history write failure or concurrent change leaves every child record unmarked', async () => {
  for (const options of [{ failId: 'finding-0' }, { concurrentId: 'finding-0' }]) {
    const db = database(options), before = structuredClone(db.state);
    await assert.rejects(cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: 'finding-0', apply: true }), /history save failed|changed during reconciliation/);
    assert.deepEqual(db.state, before);
    assert.deepEqual(db.writes, []);
  }
});

test('unknown or foreign issue cannot reconcile records from another project', async () => {
  const db = database(), before = structuredClone(db.state);
  await assert.rejects(cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: 'other-project', apply: true }), /not found/);
  assert.deepEqual(db.state, before);
});

test('when the primary source becomes invalid, a surviving checked copy can become visible primary', async () => {
  const db = database();
  const first = await cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: 'finding-0', apply: true });
  const oldPrimary = first.plans[0].canonicalId;
  const document = db.state.documents.find(item => item.id === db.state.contradictions.find(row => row.id === oldPrimary).source_execution_doc_id);
  document.extracted_text = 'Changed source; former quote is absent.';
  const second = await cleanup.reconcileSavedIssueRecords(db, 'project', { seedId: oldPrimary, apply: true });
  assert.notEqual(second.plans[0].canonicalId, oldPrimary);
  const primary = db.state.contradictions.find(row => row.id === second.plans[0].canonicalId);
  assert.equal(primary.evidence_data.review_disposition, undefined);
  assert.equal(primary.evidence_data.issue_link, undefined);
});

test('financial reads keep all pages and never reveal a letter belonging to a different project', async () => {
  const db = database({ invalidOld: true });
  db.state.pricing_ledger.push(...Array.from({ length: 501 }, (_, index) => ({ id: `extra-${index}`, project_id: 'project', contradiction_id: 'finding-1' })));
  db.state.vo_letters.push({ id: 'foreign-letter', project_id: 'someone-else', content: 'private' });
  db.state.vo_letter_items.push({ id: 'foreign-item', ledger_item_id: 'ledger', letter_id: 'foreign-letter' });
  const result = await finance.loadIssueFinancialRecords(db, 'project', ['finding-1']);
  assert.equal(result.ledger.length, 502);
  assert.deepEqual(result.letters.map(row => row.id), ['letter']);
  assert.equal(result.links[0].letterIds.includes('foreign-letter'), false);
  assert.deepEqual(db.writes, []);
});
