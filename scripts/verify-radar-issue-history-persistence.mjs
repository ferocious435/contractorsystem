import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { completeDocx } from './fixtures/docx-reading-verification.mjs';
import './radar-point-1-3-harness.mjs';
import { registerHooks } from 'node:module';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { refreshSavedIssueHistories } = await import('../src/utils/radar-issue-history-server.ts');
hook.deregister();

function database(rows, documents) {
  const writes = [];
  return { writes, from(table) {
    assert.ok(['contradictions', 'documents', 'reference_documents', 'reference_document_incorporations', 'reference_document_chunks'].includes(table), `History must not touch ${table}`);
    const predicates = [], query = {
      select() { return query; },
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      neq(key, value) { predicates.push(row => row[key] !== value); return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      or() { return query; }, order() { return query; }, range() { return query; },
      update(patch) { query.patch = patch; return query; },
      then(resolve, reject) {
        const matches = (table === 'contradictions' ? rows : table === 'documents' ? documents : []).filter(row => predicates.every(predicate => predicate(row)));
        if (query.patch) for (const row of matches) {
          assert.equal(table, 'contradictions', 'Reference and document sources are read-only');
          assert.deepEqual(Object.keys(query.patch), ['evidence_data'], 'No status, finance or source mutation');
          writes.push({ id: row.id, patch: structuredClone(query.patch) });
          Object.assign(row, structuredClone(query.patch));
        }
        return Promise.resolve({ data: structuredClone(matches), error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}

test('a new verified message updates an existing issue without a new finding, model call or change to financial work', async () => {
  const rows = [{ id: 'mtm', project_id: 'project', status: 'OPEN', title: 'קידוח MTM ברחוב יהלום', pricing_status: 'PRICED',
    evidence_data: { work_quote: 'קידוח MTM ברחוב יהלום', manual_result: 'keep', amount: 123,
      issue_owner_notes: [{ id: 'owner-signing', origin: 'OWNER_NOTE', aspect: 'SIGNATURE', state: 'SIGNED', date: null, text: 'Подписано позднее.' }] } },
    { id: 'other', project_id: 'project', status: 'OPEN', title: 'ניקוז', evidence_data: { manual_result: 'keep' } },
    { id: 'archived', project_id: 'project', status: 'ARCHIVED', title: 'MTM', evidence_data: { amount: 456 } },
    { id: 'excluded', project_id: 'project', status: 'OPEN', title: 'MTM', evidence_data: { review_disposition: { type: 'INVALID_AUTOMATIC_FINDING' } } }];
  const untouched = structuredClone(rows.slice(1));
  const documents = [{ ...completeDocx, ocr_status: 'COMPLETED', id: 'first', project_id: 'project', title: 'ישיבה.docx', extracted_text: 'תאריך: 01.01.2025\nקידוח MTM ברחוב יהלום אושר לביצוע.' }];
  const beforeDocuments = structuredClone(documents), db = database(rows, documents);
  assert.deepEqual(await refreshSavedIssueHistories(db, 'project'), { updated: 1 });
  assert.equal(rows[0].evidence_data.issue_history.aspects.METHOD.state, 'APPROVED');
  documents.push({ ...completeDocx, ocr_status: 'COMPLETED', id: 'new-signature', project_id: 'project', title: 'מכתב.docx',
    extracted_text: 'נכון למועד מכתבנו זה, 24.06.2025, טרם חתמתם על מסמך מעבר לשיטת קידוח מיקרוטאנלינג ברחוב יהלום.' });
  const addedDocuments = structuredClone(documents);
  assert.deepEqual(await refreshSavedIssueHistories(db, 'project'), { updated: 1 });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].evidence_data.issue_history.aspects.SIGNATURE.state, 'NOT_SIGNED');
  assert.equal(rows[0].evidence_data.issue_history.ownerNotes[0].state, 'SIGNED');
  assert.equal(rows[0].evidence_data.issue_history.closed, false);
  assert.equal(rows[0].evidence_data.amount, 123);
  assert.equal(rows[0].evidence_data.manual_result, 'keep');
  assert.equal(rows[0].pricing_status, 'PRICED');
  assert.equal(rows[0].status, 'OPEN');
  assert.deepEqual(rows.slice(1), untouched);
  assert.deepEqual(documents, addedDocuments);
  assert.deepEqual(documents.slice(0, 1), beforeDocuments);
  const writesBeforeRepeat = db.writes.length;
  assert.deepEqual(await refreshSavedIssueHistories(db, 'project'), { updated: 0 });
  assert.equal(db.writes.length, writesBeforeRepeat, 'An unchanged history causes no database write');
});

test('history refresh is performed before candidate filtering and the explicit action exits before scanning', () => {
  const route = fs.readFileSync('src/app/api/scan/route.ts', 'utf8');
  const action = route.slice(route.indexOf('if (body.revalidateSavedOnly === true)'), route.indexOf('if (background && !workDocId)'));
  assert.ok(action.includes('if (body.issueHistoryOnly === true)'));
  assert.ok(action.includes('historyUpdated: history.updated, scanned: 0'));
  assert.ok(!/generateScan|extract|ollama|scanProject/.test(action));
  const refresh = route.indexOf('await refreshSavedIssueHistories(supabase, projectId, issueHistoryDocuments)');
  assert.ok(refresh >= 0 && refresh < route.indexOf('const assessedPoints = dedupeScanFindings'));
  assert.ok(route.includes('const issueHistoryDocuments = [...contractDocs, ...projectWorkDocs]'));
});
